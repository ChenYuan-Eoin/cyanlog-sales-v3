import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  ContractAnalysisLeaseError,
  enqueueContractAnalysisJob,
  formatAnalysisError,
  markContractAnalysisFailed,
  markContractAnalysisRunning,
  runStructuredAnalysis,
  saveStructuredReport,
} from '@/lib/contract-analysis'
import { requireAuth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import {
  canAccessContractAction,
  listFreshAccessibleUserIds,
} from '@/lib/scoped-access'
import { getRequestId, logRouteDone, logRouteFailure, logRouteStart } from '@/lib/observability'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'
import {
  loadCurrentReviewSourceIdentity,
  ReviewSourceIdentityError,
} from '@/lib/contracts/review-source-identity'

const reviewRunSchema = z.object({
  trigger_event: z.enum([
    'manual_rerun',
    'ask_responded',
    'customer_feedback',
    'customer_version_received',
    'rule_policy_updated',
  ]).default('manual_rerun'),
  comparison_id: z.string().uuid().optional(),
}).strict()

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

function hasFormalReviewGateFailure(reasons: string[]) {
  return reasons.some((reason) => (
    reason === 'skill_bundle_not_published'
    || reason === 'skill_bundle_not_current'
    || reason === 'rule_translation_gate_missing'
    || reason === 'rule_translation_not_ready'
    || reason === 'ruleset_document_gate_missing'
    || reason === 'ruleset_document_not_ready'
    || reason === 'skill_eval_missing'
    || reason === 'skill_eval_not_run'
    || reason === 'skill_eval_not_passed'
    || reason === 'skill_bundle_not_formally_ready'
    || reason === 'skill_not_applied'
    || reason === 'skill_bundle_load_failed'
    || reason === 'rule_engine_no_rules_applied'
  ))
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
    const {
      orgId,
      assignments,
      userIds: accessibleUserIds,
    } = await listFreshAccessibleUserIds(user.id)
    if (!canAccessContractAction(assignments, orgId, 'review')) {
      return errorResponse('没有发起合同复审的权限', 403, 'FORBIDDEN')
    }
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
      .select('id, status, storage_path, current_version_id, created_by, org_id')
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
    if (!contract.current_version_id) {
      return errorResponse('当前合同还没有可审核的源文件版本', 409, 'SOURCE_VERSION_MISSING')
    }
    if (contract.status === 'PARSING' || contract.status === 'ANALYZING') {
      return errorResponse('合同正在审核中，请勿重复提交', 409, 'ALREADY_IN_PROGRESS')
    }
    if (!['PENDING', 'FAILED', 'COMPLETED'].includes(String(contract.status))) {
      return errorResponse('合同当前状态无法创建再审核', 400, 'INVALID_STATUS')
    }

    let sourceIdentity
    try {
      sourceIdentity = await loadCurrentReviewSourceIdentity(id, contract.storage_path)
    } catch (error) {
      if (error instanceof ReviewSourceIdentityError) {
        return errorResponse(error.message, 409, error.code)
      }
      throw error
    }

    const { data: parentReview } = await supabaseAdmin
      .from('contract_reviews')
      .select('id')
      .eq('contract_id', id)
      .eq('contract_version_id', contract.current_version_id)
      .eq('source_storage_path', sourceIdentity.source_storage_path)
      .eq('source_hash', sourceIdentity.source_hash)
      .eq('source_text_hash', sourceIdentity.source_text_hash)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!parentReview?.id) {
      return errorResponse(
        '当前文件还没有审核记录，请先发起当前版本的首次审核',
        409,
        'CURRENT_REVIEW_MISSING',
      )
    }

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
        contract_version_id: contract.current_version_id,
        status: 'PARSING',
        started_at: new Date().toISOString(),
        review_trigger: 'direct',
        parent_review_id: parentReview?.id || null,
        ...sourceIdentity,
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
    let responseStatus: 'PARSING' | 'COMPLETED' | 'DEGRADED' | 'FAILED' = 'PARSING'
    let responseMessage = '再审核任务已创建'
    let processingError: string | undefined
    let degradationReasons: string[] = []

    try {
      await markContractAnalysisRunning(job)
      const structuredReport = await runStructuredAnalysis(id, {
        reviewId: review.id,
        requestedBy: user.id,
        reviewTrigger: 'direct',
        reviewEvent: options.trigger_event,
      })
      await markContractAnalysisRunning(job)
      await saveStructuredReport(job, structuredReport)
      degradationReasons = structuredReport.result.degradationReasons || []
      responseStatus = structuredReport.result.degraded ? 'DEGRADED' : 'COMPLETED'
      responseMessage = structuredReport.result.degraded
        ? hasFormalReviewGateFailure(degradationReasons)
          ? '再审核已降级：配置中心规则发布或 SkillBundle 未通过正式门，不能作为正式审核完成'
          : '再审核已完成，但存在降级或未绑定项，需要人工复核'
        : '再审核已完成'
    } catch (error) {
      if (error instanceof ContractAnalysisLeaseError) throw error
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
        comparisonId: options.comparison_id || null,
        finalStatus: responseStatus,
      }
    )

    return NextResponse.json({
      jobId: job.id,
      reviewId: review.id,
      parentReviewId: parentReview?.id || null,
      triggerEvent: options.trigger_event,
      comparisonId: options.comparison_id || null,
      status: responseStatus,
      message: responseMessage,
      degraded: responseStatus === 'DEGRADED',
      degradationReasons: responseStatus === 'DEGRADED' ? degradationReasons : undefined,
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
    if (error instanceof ContractAnalysisLeaseError) {
      if (error.code === 'ANALYSIS_LEASE_LOST') {
        return errorResponse(
          '再审核任务已由新的执行者接管，本次旧执行已停止，请刷新查看当前状态',
          409,
          error.code,
        )
      }
      return errorResponse(
        '再审核任务状态未能安全写入，系统已停止继续发布结果',
        500,
        error.code,
      )
    }
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
