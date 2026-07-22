import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { processContractAnalysisJob, readContractAnalysisTerminalState, type ContractAnalysisJobRecord } from '@/lib/contract-analysis'
import { getAIRuntimeReadiness, resolvePreferredProviderId } from '@/lib/ai/failover'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { getRequestId, logRouteDone, logRouteFailure, logRouteStart } from '@/lib/observability'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'
import { verifyContractReviewSource } from '@/lib/documents/source-render-server'

// 统一错误响应
function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

function isAmbiguousRpcTransportError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as Record<string, unknown>
  const code = typeof record.code === 'string' ? record.code.trim() : ''
  if (/^(?:ECONNRESET|ECONNABORTED|ETIMEDOUT|EPIPE)$/i.test(code) || /^08[0-9A-Z]{3}$/.test(code)) return true
  if (code) return false
  const message = typeof record.message === 'string' ? record.message : String(error)
  return /response\s*(?:was\s*)?lost|failed to fetch|fetch failed|network|timed?\s*out|timeout|socket|connection reset|econnreset|econnaborted/i.test(message)
}

const analyzeRequestSchema = z.object({
  strategy: z.enum(['AGGRESSIVE', 'BALANCED', 'CONSERVATIVE']).optional(),
  strategy_id: z.string().uuid().optional(),
  preferredProvider: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  model_provider: z.string().min(1).optional(),
  force: z.boolean().optional(),
  reanalyze: z.boolean().optional(),
})

// POST /api/contracts/:id/analyze - 触发合同审核（需登录）
export async function POST(
  req: NextRequest,
  { params }: AsyncRouteParams
) {
  const startedAt = Date.now()
  const requestId = getRequestId(req)
  const route = '/api/contracts/[id]/analyze'
  let routeId = ''

  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    routeId = await resolveIdParam(params)
    const id = routeId
    logRouteStart({
      route,
      requestId,
      userId: user.id,
      details: { contractId: id },
    })

    if (!id) {
      return errorResponse('合同ID必填', 400, 'MISSING_ID')
    }

    const parsedBody = analyzeRequestSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsedBody.success) {
      return errorResponse(parsedBody.error.issues.map((issue) => issue.message).join(', '), 400, 'INVALID_REQUEST')
    }
    const body = parsedBody.data
    const forceReanalysis = body.force === true || body.reanalyze === true

    // 使用行级锁检查合同状态（防止并发重复审核）
    const { data: contract, error: contractError } = await supabaseAdmin
      .from('contracts')
      .select('id,status,filename,mime_type,storage_path,parsed_text,created_by')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle()

    if (contractError) {
      await logRouteFailure(
        req,
        {
          route,
          requestId,
          userId: user.id,
          details: { contractId: id },
        },
        startedAt,
        contractError,
        {
          phase: 'fetch_contract_for_analyze',
        }
      )
      return errorResponse('查询合同失败', 500, 'DB_ERROR')
    }

    if (!contract) {
      return errorResponse('合同不存在或无权访问', 404, 'NOT_FOUND')
    }

    const requestedPreferredProvider = body.preferredProvider || body.provider || body.model_provider
    let preferredProvider: string | undefined
    if (requestedPreferredProvider) {
      const readiness = await getAIRuntimeReadiness(orgId, {
        tool: 'contract_review',
        capability: 'contract_review',
      })
      preferredProvider = resolvePreferredProviderId(readiness, requestedPreferredProvider)
      if (!preferredProvider) {
        return errorResponse('指定的模型实例不存在或未发布', 400, 'INVALID_PROVIDER')
      }
    }

    // 状态检查：默认只有 PENDING 或 FAILED 可审核；复审必须显式传 force/reanalyze。
    if (contract.status !== 'PENDING' && contract.status !== 'FAILED') {
      // 检查是否已有进行中的审核
      if (contract.status === 'PARSING' || contract.status === 'ANALYZING') {
        return errorResponse('合同正在审核中，请勿重复提交', 409, 'ALREADY_IN_PROGRESS')
      }
      if (contract.status === 'COMPLETED' && !forceReanalysis) {
        return errorResponse('合同已审核完成，如需重新审核请先重置状态', 409, 'ALREADY_COMPLETED')
      }
      if (contract.status !== 'COMPLETED') {
        return errorResponse('合同当前状态无法审核', 400, 'INVALID_STATUS')
      }
    }

    let strategyId: string | undefined
    if (body.strategy_id) {
      const { data: strategyData, error: strategyError } = await supabaseAdmin
        .from('review_strategies')
        .select('id,code')
        .eq('id', body.strategy_id)
        .or(`org_id.is.null,org_id.eq.${orgId}`)
        .maybeSingle()
      if (strategyError || !strategyData || !['AGGRESSIVE', 'BALANCED', 'CONSERVATIVE'].includes(strategyData.code)) {
        return errorResponse('指定的审核策略不存在、不属于当前组织或代码无效', 400, 'INVALID_STRATEGY')
      }
      strategyId = strategyData.id
    } else if (body.strategy) {
      const { data: strategyData, error: strategyError } = await supabaseAdmin
        .from('review_strategies')
        .select('id,code')
        .eq('code', body.strategy)
        .or(`org_id.is.null,org_id.eq.${orgId}`)
        .limit(1)
        .maybeSingle()
      if (strategyError || !strategyData) {
        return errorResponse('指定的审核策略未发布或不属于当前组织', 400, 'INVALID_STRATEGY')
      }
      strategyId = strategyData.id
    }

    if (!contract.storage_path || !contract.filename || !contract.parsed_text?.trim()) {
      return errorResponse('当前源文件尚无可验证解析文本；扫描件可继续做人工 PDF 批注，但不能沿用旧文本启动 AI 审核', 409, 'SOURCE_TEXT_NOT_VERIFIED')
    }
    let sourcePageMap: Awaited<ReturnType<typeof verifyContractReviewSource>>
    try {
      sourcePageMap = await verifyContractReviewSource({
        id: contract.id,
        filename: contract.filename,
        mime_type: contract.mime_type,
        storage_path: contract.storage_path,
        parsed_text: contract.parsed_text,
      })
    } catch (sourceError) {
      return errorResponse(
        sourceError instanceof Error ? `源文件身份验证失败：${sourceError.message}` : '源文件身份验证失败',
        409,
        'SOURCE_IDENTITY_UNAVAILABLE'
      )
    }
    if (!sourcePageMap.source_hash || !sourcePageMap.source_text_hash) {
      return errorResponse('解析文本无法与当前源文件对应；已停止 AI 审核，避免把旧文本绑定到新文件', 409, 'SOURCE_TEXT_NOT_VERIFIED')
    }

    // 检查24小时内是否有审核记录（简单幂等性控制）
    const { data: recentReview } = await supabaseAdmin
      .from('contract_reviews')
      .select('id, created_at, status')
      .eq('contract_id', id)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (recentReview && (recentReview.status === 'PARSING' || recentReview.status === 'ANALYZING')) {
      return errorResponse('24小时内已有进行中的审核任务', 409, 'RECENT_REVIEW_EXISTS')
    }

    // This UUID identifies this exact database setup attempt. Recovery must never
    // adopt another concurrent request merely because contract/source happen to match.
    const analysisStartRequestId = randomUUID()
    const { data: setupRows, error: setupError } = await supabaseAdmin.rpc('start_contract_analysis_job', {
      p_org_id: orgId,
      p_contract_id: id,
      p_requested_by: user.id,
      p_start_request_id: analysisStartRequestId,
      p_expected_contract_status: contract.status,
      p_strategy_id: strategyId || null,
      p_source_storage_path: contract.storage_path,
      p_source_hash: sourcePageMap.source_hash,
      p_source_text_hash: sourcePageMap.source_text_hash,
      p_preferred_provider: preferredProvider || null,
    })
    const setup = (Array.isArray(setupRows) ? setupRows[0] : setupRows) as {
      review_id?: string
      job_id?: string
    } | null
    if (setupError || !setup?.review_id || !setup.job_id) {
      const shouldAttemptRecovery = !setupError || isAmbiguousRpcTransportError(setupError)
      if (shouldAttemptRecovery) {
        const { data: recoveredRows, error: recoveryError } = await supabaseAdmin.rpc('recover_contract_analysis_start', {
          p_org_id: orgId,
          p_contract_id: id,
          p_requested_by: user.id,
          p_start_request_id: analysisStartRequestId,
          p_strategy_id: strategyId || null,
          p_source_storage_path: contract.storage_path,
          p_source_hash: sourcePageMap.source_hash,
          p_source_text_hash: sourcePageMap.source_text_hash,
          p_preferred_provider: preferredProvider || null,
        })
        const recovered = (Array.isArray(recoveredRows) ? recoveredRows[0] : recoveredRows) as {
          review_id?: string
          job_id?: string
          job_status?: string
          review_status?: string
        } | null
        if (!recoveryError && recovered?.review_id && recovered.job_id) {
          const recoveredTerminal = recovered.job_status === 'completed' || recovered.job_status === 'failed'
          return NextResponse.json({
            jobId: recovered.job_id,
            reviewId: recovered.review_id,
            status: recovered.review_status || 'PARSING',
            jobStatus: recovered.job_status || 'queued',
            message: recovered.job_status === 'failed'
              ? '审核任务已按本次唯一请求恢复，且已记录失败终态'
              : recovered.job_status === 'completed'
                ? '审核任务已按本次唯一请求恢复，且已完成'
                : '审核任务已按本次唯一请求恢复；队列或已持有租约的 Worker 将继续处理',
            preferredProvider,
            forceReanalysis,
          }, { status: recoveredTerminal ? 200 : 202 })
        }
      }
      await logRouteFailure(
        req,
        {
          route,
          requestId,
          userId: user.id,
          details: { contractId: id },
        },
        startedAt,
        setupError || new Error('Atomic analysis setup returned no identifiers'),
        {
          phase: 'start_contract_analysis_job',
        }
      )
      return errorResponse('审核任务原子创建失败，合同状态可能已变化', 409, 'CONCURRENT_UPDATE')
    }
    const review = { id: setup.review_id }
    const now = new Date().toISOString()
    const job: ContractAnalysisJobRecord = {
      id: setup.job_id,
      contract_id: id,
      review_id: review.id,
      requested_by: user.id,
      status: 'queued',
      attempts: 0,
      provider: null,
      degraded: false,
      last_error: null,
      locked_at: null,
      lock_token: null,
      locked_by: null,
      started_at: null,
      completed_at: null,
      created_at: now,
      updated_at: now,
    }
    let responseStatus: 'PARSING' | 'COMPLETED' | 'FAILED' = 'PARSING'
    let responseMessage = '审核任务已创建'
    let processingError: string | undefined

    try {
      // 即时请求和队列恢复必须复用同一条可恢复、带租约的结构化执行链。
      await processContractAnalysisJob(job)
      responseStatus = 'COMPLETED'
      responseMessage = '结构化审核已完成'
    } catch (fallbackError) {
      processingError = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
      const terminalState = await readContractAnalysisTerminalState(job)
      if (terminalState === 'completed') {
        responseStatus = 'COMPLETED'
        responseMessage = '结构化审核已完成'
        processingError = undefined
      } else if (terminalState === 'failed') {
        responseStatus = 'FAILED'
        responseMessage = '审核处理失败，任务状态已记录'
      } else if (terminalState === 'inconsistent') {
        throw new Error('审核任务出现不一致终态，已停止失败补偿', { cause: fallbackError })
      } else {
        // Another durable worker may have claimed this exact queued job first.
        // Never use a stale local/no-lease record to fail or overwrite its run.
        responseStatus = 'PARSING'
        responseMessage = '审核任务已由队列接管'
        processingError = undefined
      }
    }

    logRouteDone(
      {
        route,
        requestId,
        userId: user.id,
        details: { contractId: id },
      },
      startedAt,
      {
        reviewId: review.id,
        jobId: job.id,
        finalStatus: responseStatus,
        forceReanalysis,
        preferredProvider,
      }
    )

    return NextResponse.json({
      jobId: job.id,
      reviewId: review.id,
      status: responseStatus,
      message: responseMessage,
      processingError,
      preferredProvider,
      forceReanalysis,
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    await logRouteFailure(
      req,
      {
        route,
        requestId,
        details: { contractId: routeId },
      },
      startedAt,
      error
    )
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
