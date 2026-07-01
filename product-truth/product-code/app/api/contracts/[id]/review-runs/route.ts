import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  enqueueContractAnalysisJob,
  formatAnalysisError,
  markContractAnalysisCompleted,
  markContractAnalysisFailed,
  markContractAnalysisRunning,
  runStructuredAnalysis,
  saveStructuredReport,
  type ReviewOptions,
} from '@/lib/contract-analysis'
import { requireAuth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getDefaultOrgId, listAccessibleUserIds } from '@/lib/scoped-access'
import { getRequestId, logRouteDone, logRouteFailure, logRouteStart } from '@/lib/observability'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'

const reviewRunSchema = z.object({
  trigger_event: z.enum([
    'manual_rerun',
    'ask_responded',
    'customer_feedback',
    'rule_policy_updated',
  ]).default('manual_rerun'),
  strategy: z.enum(['AGGRESSIVE', 'BALANCED', 'CONSERVATIVE']).optional(),
  strategy_id: z.string().trim().min(1).optional(),
})

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function POST(
  req: NextRequest,
  { params }: AsyncRouteParams
) {
  const startedAt = Date.now()
  const requestId = getRequestId(req)
  const route = '/api/contracts/[id]/review-runs'
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

    const parsed = reviewRunSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return errorResponse('再审核参数无效', 400, 'INVALID_REVIEW_RUN_OPTIONS')
    }
    const options = parsed.data

    const { data: contract, error: contractError } = await supabaseAdmin
      .from('contracts')
      .select('id, status, created_by, org_id')
      .eq('id', id)
      .eq('org_id', orgId)
      .in('created_by', accessibleUserIds)
      .maybeSingle()

    if (contractError) {
      return errorResponse('查询合同失败', 500, 'DB_ERROR')
    }
    if (!contract) {
      return errorResponse('合同不存在或无权访问', 404, 'NOT_FOUND')
    }
    if (contract.status === 'PARSING' || contract.status === 'ANALYZING') {
      return errorResponse('合同正在审核中，请勿重复提交', 409, 'ALREADY_IN_PROGRESS')
    }
    if (!['PENDING', 'FAILED', 'COMPLETED'].includes(String(contract.status))) {
      return errorResponse('合同当前状态无法创建再审核', 400, 'INVALID_STATUS')
    }

    const { data: parentReview } = await supabaseAdmin
      .from('contract_reviews')
      .select('id')
      .eq('contract_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data: updatedContract, error: updateError } = await supabaseAdmin
      .from('contracts')
      .update({ status: 'PARSING', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('org_id', orgId)
      .eq('status', contract.status)
      .select('id')
      .maybeSingle()

    if (updateError || !updatedContract) {
      return errorResponse('状态更新失败，可能并发操作', 409, 'CONCURRENT_UPDATE')
    }

    const { data: review, error: reviewError } = await supabaseAdmin
      .from('contract_reviews')
      .insert({
        contract_id: id,
        status: 'PARSING',
        started_at: new Date().toISOString(),
        review_trigger: options.trigger_event,
        parent_review_id: parentReview?.id || null,
      })
      .select()
      .single()

    if (reviewError) {
      await supabaseAdmin
        .from('contracts')
        .update({ status: contract.status })
        .eq('id', id)
        .eq('org_id', orgId)
      return errorResponse('创建审核运行失败', 500, 'REVIEW_RUN_CREATE_FAILED')
    }

    const job = await enqueueContractAnalysisJob(id, review.id, user.id)
    let responseStatus: 'PARSING' | 'COMPLETED' | 'FAILED' = 'PARSING'
    let responseMessage = '再审核任务已创建'
    let processingError: string | undefined

    let reviewOptions: ReviewOptions | undefined
    let strategyId: string | undefined
    if (options.strategy_id) {
      strategyId = options.strategy_id
    } else if (options.strategy) {
      const { data: strategyData } = await supabaseAdmin
        .from('review_strategies')
        .select('id, code')
        .or(`org_id.is.null,org_id.eq.${orgId}`)
        .eq('code', options.strategy)
        .limit(1)
        .maybeSingle()
      if (strategyData) strategyId = strategyData.id
      reviewOptions = { strategyCode: options.strategy }
    }

    try {
      await markContractAnalysisRunning(job)
      const structuredReport = await runStructuredAnalysis(id, {
        ...reviewOptions,
        reviewId: review.id,
        requestedBy: user.id,
        reviewTrigger: options.trigger_event,
      })
      await saveStructuredReport(review.id, id, structuredReport, strategyId)
      await markContractAnalysisCompleted(job, structuredReport.result)
      responseStatus = 'COMPLETED'
      responseMessage = '再审核已完成'
    } catch (error) {
      processingError = formatAnalysisError(error)
      await markContractAnalysisFailed(job, error)
      responseStatus = 'FAILED'
      responseMessage = '再审核处理失败，任务状态已记录'
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
        parentReviewId: parentReview?.id || null,
        triggerEvent: options.trigger_event,
        finalStatus: responseStatus,
      }
    )

    return NextResponse.json({
      jobId: job.id,
      reviewId: review.id,
      parentReviewId: parentReview?.id || null,
      triggerEvent: options.trigger_event,
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
