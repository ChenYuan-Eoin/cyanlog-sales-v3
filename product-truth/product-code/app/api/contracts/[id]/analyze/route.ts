import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { enqueueContractAnalysisJob, runStructuredAnalysis, saveStructuredReport, markContractAnalysisRunning, markContractAnalysisCompleted, markContractAnalysisFailed, formatAnalysisError, type ReviewOptions } from '@/lib/contract-analysis'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId, listAccessibleUserIds } from '@/lib/scoped-access'
import { getRequestId, logRouteDone, logRouteFailure, logRouteStart } from '@/lib/observability'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'

const analyzeOptionsSchema = z.object({
  strategy: z.enum(['AGGRESSIVE', 'BALANCED', 'CONSERVATIVE']).optional(),
  strategy_id: z.string().trim().min(1).optional(),
})

// 统一错误响应
function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

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
    const { userIds: accessibleUserIds } = await listAccessibleUserIds(user.id, orgId)
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

    const optionsParse = analyzeOptionsSchema.safeParse(await req.json().catch(() => ({})))
    if (!optionsParse.success) {
      return errorResponse('审核策略参数无效', 400, 'INVALID_REVIEW_OPTIONS')
    }
    const analyzeOptions = optionsParse.data

    // 使用行级锁检查合同状态（防止并发重复审核）
    const { data: contract, error: contractError } = await supabaseAdmin
      .from('contracts')
      .select('id, status, storage_path, created_by, org_id')
      .eq('id', id)
      .eq('org_id', orgId)
      .in('created_by', accessibleUserIds)
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

    // 状态检查：只有PENDING或FAILED才能重新审核
    if (contract.status !== 'PENDING' && contract.status !== 'FAILED') {
      // 检查是否已有进行中的审核
      if (contract.status === 'PARSING' || contract.status === 'ANALYZING') {
        return errorResponse('合同正在审核中，请勿重复提交', 409, 'ALREADY_IN_PROGRESS')
      }
      if (contract.status === 'COMPLETED') {
        return errorResponse('合同已审核完成，如需重新审核请先重置状态', 409, 'ALREADY_COMPLETED')
      }
      return errorResponse('合同当前状态无法审核', 400, 'INVALID_STATUS')
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

    // 更新合同状态为解析中（乐观锁）
    const { error: updateError } = await supabaseAdmin
      .from('contracts')
      .update({ status: 'PARSING', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('org_id', orgId)
      .eq('status', contract.status) // 乐观锁：只有状态未变才更新

    if (updateError) {
      await logRouteFailure(
        req,
        {
          route,
          requestId,
          userId: user.id,
          details: { contractId: id },
        },
        startedAt,
        updateError,
        {
          phase: 'set_contract_parsing',
        }
      )
      return errorResponse('状态更新失败，可能并发操作', 409, 'CONCURRENT_UPDATE')
    }

    // 创建审核记录
    const { data: review, error: reviewError } = await supabaseAdmin
      .from('contract_reviews')
      .insert({
        contract_id: id,
        status: 'PARSING',
        started_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (reviewError) {
      // 回滚合同状态
      await supabaseAdmin
        .from('contracts')
        .update({ status: contract.status })
        .eq('id', id)
        .eq('org_id', orgId)

      await logRouteFailure(
        req,
        {
          route,
          requestId,
          userId: user.id,
          details: { contractId: id },
        },
        startedAt,
        reviewError,
        {
          phase: 'create_contract_review',
        }
      )
      return errorResponse('创建审核记录失败', 500, 'REVIEW_CREATE_FAILED')
    }

    const job = await enqueueContractAnalysisJob(id, review.id, user.id)
    let responseStatus: 'PARSING' | 'COMPLETED' | 'FAILED' = 'PARSING'
    let responseMessage = '审核任务已创建'
    let processingError: string | undefined

    let reviewOptions: ReviewOptions | undefined
    let strategyId: string | undefined
    if (analyzeOptions.strategy_id) {
      strategyId = analyzeOptions.strategy_id
    } else if (analyzeOptions.strategy) {
      // 根据 code 查找 strategy
      const { data: strategyData } = await supabaseAdmin
        .from('review_strategies')
        .select('id, code')
        .or(`org_id.is.null,org_id.eq.${orgId}`)
        .eq('code', analyzeOptions.strategy)
        .limit(1)
        .maybeSingle()
      if (strategyData) strategyId = strategyData.id
      reviewOptions = { strategyCode: analyzeOptions.strategy }
    }

    try {
      // 改用结构化分析（保留 AI 模型和规则引擎不改动）
      await markContractAnalysisRunning(job)
      const structuredReport = await runStructuredAnalysis(id, reviewOptions)
      await saveStructuredReport(review.id, id, structuredReport, strategyId)
      await markContractAnalysisCompleted(job, structuredReport.result)
      responseStatus = 'COMPLETED'
      responseMessage = '结构化审核已完成'
    } catch (fallbackError) {
      processingError = formatAnalysisError(fallbackError)
      await markContractAnalysisFailed(job, fallbackError)
      responseStatus = 'FAILED'
      responseMessage = '审核处理失败，任务状态已记录'
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
      }
    )

    return NextResponse.json({
      jobId: job.id,
      reviewId: review.id,
      status: responseStatus,
      message: responseMessage,
      processingError,
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
