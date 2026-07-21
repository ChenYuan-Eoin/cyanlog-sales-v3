import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  claimContractAnalysisJobById,
  ContractAnalysisLeaseError,
  formatAnalysisError,
  markContractAnalysisFailed,
  markContractAnalysisRunning,
  runStructuredAnalysis,
  saveStructuredReport,
} from '@/lib/contract-analysis'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import {
  canAccessContractAction,
  listFreshAccessibleUserIds,
} from '@/lib/scoped-access'
import { getRequestId, logRouteDone, logRouteFailure, logRouteStart } from '@/lib/observability'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'

const analyzeOptionsSchema = z.object({
  expected_upload_id: z.string().trim().uuid().optional(),
  expected_file_sha256: z.string()
    .trim()
    .regex(/^[0-9a-fA-F]{64}$/)
    .transform((value) => value.toLowerCase())
    .optional(),
}).strict()

type InitialReviewSetup = {
  review_id?: string
  job_id?: string
  review_status?: string
  job_status?: string
  should_process?: boolean
  recovered?: boolean
}

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

function firstRow<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value
}

function setupErrorResponse(error: { code?: string; message?: string } | null) {
  if (error?.code === 'P0002') {
    return errorResponse('合同不存在或无权访问', 404, 'NOT_FOUND')
  }
  if (error?.code === '23514') {
    return errorResponse(
      '源文件仍在准备中；正文、文件身份和定位信息全部就绪后才能发起审核',
      409,
      'SOURCE_NOT_READY',
    )
  }
  if (
    error?.code === '40001'
    || error?.code === '40P01'
    || error?.code === '55000'
    || error?.code === '23505'
  ) {
    return errorResponse(
      '文件版本或审核状态刚刚发生变化，请刷新后从当前步骤继续',
      409,
      'CONCURRENT_UPDATE',
    )
  }
  return errorResponse('审核任务创建失败，源文件和版本记录已保留', 500, 'REVIEW_SETUP_FAILED')
}

function responseStatus(setup: InitialReviewSetup) {
  const reviewStatus = String(setup.review_status || '').toUpperCase()
  const jobStatus = String(setup.job_status || '').toLowerCase()
  if (jobStatus === 'failed' || reviewStatus === 'FAILED') return 'FAILED'
  if (jobStatus === 'completed') {
    return reviewStatus === 'DEGRADED' ? 'DEGRADED' : 'COMPLETED'
  }
  return 'PARSING'
}

// POST /api/contracts/:id/analyze - start or recover the one initial review
// for the contract's current source version. Business re-review uses
// /review-runs and never shares this idempotency identity.
export async function POST(req: NextRequest, { params }: AsyncRouteParams) {
  const startedAt = Date.now()
  const requestId = getRequestId(req)
  const route = '/api/contracts/[id]/analyze'
  let routeId = ''

  try {
    const user = await requireAuth(req)
    const {
      orgId,
      assignments,
      userIds: accessibleUserIds,
    } = await listFreshAccessibleUserIds(user.id)
    if (!canAccessContractAction(assignments, orgId, 'review')) {
      return errorResponse('没有发起合同审核的权限', 403, 'FORBIDDEN')
    }
    routeId = await resolveIdParam(params)
    const id = routeId

    logRouteStart({
      route,
      requestId,
      userId: user.id,
      details: { contractId: id },
    })

    if (!id) return errorResponse('合同ID必填', 400, 'MISSING_ID')

    const optionsParse = analyzeOptionsSchema.safeParse(await req.json().catch(() => ({})))
    if (!optionsParse.success) {
      return errorResponse('审核策略参数无效', 400, 'INVALID_REVIEW_OPTIONS')
    }
    const analyzeOptions = optionsParse.data

    const { data: contract, error: contractError } = await supabaseAdmin
      .from('contracts')
      .select('id, status, current_version_id, created_by, org_id')
      .eq('id', id)
      .eq('org_id', orgId)
      .in('created_by', accessibleUserIds)
      .maybeSingle()

    if (contractError) {
      await logRouteFailure(
        req,
        { route, requestId, userId: user.id, details: { contractId: id } },
        startedAt,
        contractError,
        { phase: 'fetch_contract_for_initial_review' },
      )
      return errorResponse('查询合同失败', 500, 'DB_ERROR')
    }
    if (!contract) return errorResponse('合同不存在或无权访问', 404, 'NOT_FOUND')
    if (!contract.current_version_id) {
      return errorResponse(
        '合同还没有完成源文件版本登记，请从文件准备步骤继续',
        409,
        'SOURCE_VERSION_MISSING',
      )
    }

    const { data: setupRows, error: setupError } = await supabaseAdmin
      .rpc('start_initial_contract_review_fenced', {
        p_org_id: orgId,
        p_contract_id: id,
        p_contract_version_id: contract.current_version_id,
        p_requested_by: user.id,
        p_expected_contract_status: contract.status,
        p_strategy_id: null,
        p_expected_upload_id: analyzeOptions.expected_upload_id ?? null,
        p_expected_file_sha256: analyzeOptions.expected_file_sha256 ?? null,
      })
    const setup = firstRow(setupRows as InitialReviewSetup[] | InitialReviewSetup | null)

    if (setupError || !setup?.review_id || !setup.job_id) {
      await logRouteFailure(
        req,
        { route, requestId, userId: user.id, details: { contractId: id } },
        startedAt,
        setupError || new Error('Initial review setup returned no identifiers'),
        { phase: 'start_initial_contract_review_fenced' },
      )
      return setupErrorResponse(setupError)
    }

    // Every caller may attempt a queued or stale-running lease. The database
    // grants it to exactly one caller, so an ambiguous response or abandoned
    // request can recover the same ReviewRun without executing a second one.
    const initialStatus = responseStatus(setup)
    const setupJobStatus = String(setup.job_status).toLowerCase()
    if (setupJobStatus !== 'queued' && setupJobStatus !== 'running') {
      return NextResponse.json({
        jobId: setup.job_id,
        reviewId: setup.review_id,
        status: initialStatus,
        message: initialStatus === 'FAILED'
          ? '审核未完成，请查看失败原因后从当前步骤重试'
          : initialStatus === 'COMPLETED' || initialStatus === 'DEGRADED'
            ? '该文件版本已有审核结果'
            : '审核正在进行中',
        recovered: true,
      }, { status: initialStatus === 'PARSING' ? 202 : 200 })
    }

    const lockToken = randomUUID()
    const job = await claimContractAnalysisJobById(
      setup.job_id,
      `initial-review:${requestId}`,
      lockToken,
    )
    if (!job) {
      return NextResponse.json({
        jobId: setup.job_id,
        reviewId: setup.review_id,
        status: 'PARSING',
        message: '审核任务已由另一个请求或队列接管',
        recovered: true,
      }, { status: 202 })
    }

    let finalStatus: 'COMPLETED' | 'DEGRADED' | 'FAILED' = 'COMPLETED'
    let message = '结构化审核已完成'
    let processingError: string | undefined
    let degradationReasons: string[] = []

    try {
      await markContractAnalysisRunning(job)
      const structuredReport = await runStructuredAnalysis(id, {
        reviewId: setup.review_id,
        requestedBy: user.id,
        reviewTrigger: 'initial_upload',
        reviewEvent: 'initial_generate',
      })
      // Revalidate the lease after the provider call and before any report
      // artifact is written. A replaced stale lease stops here with zero writes.
      await markContractAnalysisRunning(job)
      await saveStructuredReport(job, structuredReport)
      degradationReasons = structuredReport.result.degradationReasons || []
      finalStatus = structuredReport.result.degraded ? 'DEGRADED' : 'COMPLETED'
      message = structuredReport.result.degraded
        ? '审核已完成，但有明确降级项，需要人工复核'
        : '结构化审核已完成'
    } catch (processingFailure) {
      if (processingFailure instanceof ContractAnalysisLeaseError) {
        throw processingFailure
      }
      processingError = formatAnalysisError(processingFailure)
      await markContractAnalysisFailed(job, processingFailure)
      finalStatus = 'FAILED'
      message = '审核处理未完成；源文件、版本和本次审核记录已保留，可从失败步骤重试'
    }

    logRouteDone(
      { route, requestId, userId: user.id, details: { contractId: id } },
      startedAt,
      {
        reviewId: setup.review_id,
        jobId: setup.job_id,
        finalStatus,
        recovered: Boolean(setup.recovered),
      },
    )

    return NextResponse.json({
      jobId: setup.job_id,
      reviewId: setup.review_id,
      status: finalStatus,
      message,
      recovered: Boolean(setup.recovered),
      degraded: finalStatus === 'DEGRADED',
      degradationReasons: finalStatus === 'DEGRADED' ? degradationReasons : undefined,
      processingError,
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    await logRouteFailure(
      req,
      { route, requestId, details: { contractId: routeId } },
      startedAt,
      error,
    )
    if (error instanceof ContractAnalysisLeaseError) {
      if (error.code === 'ANALYSIS_LEASE_LOST') {
        return errorResponse(
          '审核任务已由新的执行者接管，本次旧执行已停止，请刷新查看当前状态',
          409,
          error.code,
        )
      }
      return errorResponse(
        '审核任务状态未能安全写入，系统已停止继续发布结果',
        500,
        error.code,
      )
    }
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
