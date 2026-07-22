// GET /api/contracts/:id/review
// PATCH /api/contracts/:id/review
// 获取合同审核结果 + 更新审核结论

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  errorResponse,
  successResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { listModelInvocationsForContract } from '@/lib/ai/model-invocations'
import {
  buildPublishedResolutionOptions,
  buildSourceAnchor,
  sanitizeCustomerFacingText,
  shouldExposeRiskSourceAnchor,
  type ReviewRiskLike,
} from '@/lib/contracts/review-workbench'
import { loadReviewBundleSnapshot } from '@/lib/contracts/review-workbench-server'
import { ensureContractPageMap } from '@/lib/documents/source-render-server'
import { contractSourceFormatFromFilename } from '@/lib/documents/source-format'

// GET - 获取审核结果
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params

    // Keep job polling independent from source rendering and the large ReviewRun
    // payload. Authorization only needs the contract identity here.
    if (req.nextUrl.searchParams.get('view') === 'status') {
      const { data: authorizedContract, error: authorizationError } = await supabaseAdmin
        .from('contracts')
        .select('id')
        .eq('id', id)
        .eq('org_id', orgId)
        .maybeSingle()
      if (authorizationError || !authorizedContract) {
        return errorResponse(createApiError('NOT_FOUND', '合同不存在'))
      }
      const { data: latestBatch, error: latestBatchError } = await supabaseAdmin
        .from('contract_review_submission_batches')
        .select('id,source_review_id,new_review_id,analysis_job_id,review_style,status,conflict_report,created_at,completed_at')
        .eq('contract_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (latestBatchError) {
        return errorResponse(createApiError('DB_ERROR', '获取重新审核状态失败'))
      }
      const { data: analysisJob, error: analysisJobError } = latestBatch?.analysis_job_id
        ? await supabaseAdmin
          .from('contract_analysis_jobs')
          .select('id,status,attempts,provider,degraded,last_error,created_at,started_at,completed_at')
          .eq('id', latestBatch.analysis_job_id)
          .maybeSingle()
        : { data: null, error: null }
      if (analysisJobError) {
        return errorResponse(createApiError('DB_ERROR', '获取分析任务状态失败'))
      }
      return successResponse({
        latestSubmissionBatch: latestBatch ? {
          ...latestBatch,
          analysis_job: analysisJob,
        } : null,
      })
    }

    // 1. 获取合同基本信息（包含结论字段）
    const { data: contract, error: contractError } = await supabaseAdmin
      .from('contracts')
      .select('id, org_id, filename, parsed_text, mime_type, storage_path, status, conclusion, contract_reviews(*)')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (contractError || !contract) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在'))
    }

    const contractReviews = Array.isArray(contract.contract_reviews)
      ? [...contract.contract_reviews].sort((a: { created_at?: string }, b: { created_at?: string }) => {
        const left = a.created_at ? new Date(a.created_at).getTime() : 0
        const right = b.created_at ? new Date(b.created_at).getTime() : 0
        return right - left
      })
      : []

    const parsedText = contract.parsed_text || ''
    let pageMap: Awaited<ReturnType<typeof ensureContractPageMap>> | null = null
    let sourcePreviewError: string | null = null
    if (!contract.storage_path) {
      sourcePreviewError = '合同源文件缺失，无法生成页级预览'
    } else {
      try {
        pageMap = await ensureContractPageMap({
          id: contract.id,
          filename: contract.filename,
          mime_type: contract.mime_type,
          storage_path: contract.storage_path,
          parsed_text: parsedText,
        })
      } catch (renderError) {
        sourcePreviewError = renderError instanceof Error
          ? `源文件页级预览生成失败：${renderError.message}`
          : '源文件页级预览生成失败，请重试'
      }
    }

    // 2. 风险事实按 ReviewRun 分组，只展示最近一组，避免历史重复卡片污染工作台。
    const { data: allRiskCards, error: riskError } = await supabaseAdmin
      .from('contract_risk_cards')
      .select('id,contract_id,review_id,level,title,description,suggestion,clause_ref,position_start,position_end,detected_by,confidence,status,rule_id,rule_code,rule_version,evidence,created_at')
      .eq('contract_id', id)
      .order('created_at', { ascending: false })

    if (riskError) {
      return errorResponse(createApiError('DB_ERROR', '获取风险卡片失败'))
    }

    const latestReview = contractReviews[0] as {
      id: string
      status?: string | null
      review_trigger?: string | null
      parent_review_id?: string | null
      source_storage_path?: string | null
      source_hash?: string | null
      source_text_hash?: string | null
      skill_bundle_id?: string | null
      rule_version?: number | null
    } | undefined
    const useDecisionSourceReview = latestReview?.review_trigger === 'decision_batch'
      && latestReview.parent_review_id
      && ['PARSING', 'ANALYZING', 'FAILED'].includes(latestReview.status || '')
    const candidateRiskReviewId = useDecisionSourceReview
      ? latestReview.parent_review_id
      : latestReview?.status === 'COMPLETED' ? latestReview.id : null
    const candidateRiskReview = contractReviews.find((review: { id?: string }) => review.id === candidateRiskReviewId) as {
      status?: string | null
      source_storage_path?: string | null
      source_hash?: string | null
      source_text_hash?: string | null
      skill_bundle_id?: string | null
      rule_version?: number | null
    } | undefined
    const sourceReviewMatchesCurrent = Boolean(
      candidateRiskReviewId
      && candidateRiskReview
      && candidateRiskReview.status === 'COMPLETED'
      && pageMap
      && candidateRiskReview.source_storage_path === contract.storage_path
      && candidateRiskReview.source_hash === pageMap.source_hash
      && candidateRiskReview.source_text_hash === pageMap.source_text_hash
    )
    const riskReviewId = sourceReviewMatchesCurrent ? candidateRiskReviewId : null
    const sourceReviewStale = Boolean(candidateRiskReviewId && !sourceReviewMatchesCurrent)

    const riskCards = (allRiskCards || [])
      .filter((card: { review_id?: string | null }) => riskReviewId ? card.review_id === riskReviewId : false)
      .sort((left: { level: string; created_at: string }, right: { level: string; created_at: string }) => {
        const order: Record<string, number> = { red: 0, yellow: 1, white: 2, green: 3 }
        return (order[left.level] ?? 4) - (order[right.level] ?? 4)
          || new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
      })

    const [bundle, decisionsResult, batchResult] = await Promise.all([
      candidateRiskReview?.skill_bundle_id && candidateRiskReview.rule_version
        ? loadReviewBundleSnapshot(orgId, candidateRiskReview.skill_bundle_id, candidateRiskReview.rule_version)
        : Promise.resolve(null),
      riskReviewId
        ? supabaseAdmin
          .from('contract_review_decision_drafts')
          .select('*')
          .eq('review_id', riskReviewId)
          .eq('created_by', user.id)
        : Promise.resolve({ data: [], error: null }),
      supabaseAdmin
        .from('contract_review_submission_batches')
        .select('id,source_review_id,new_review_id,analysis_job_id,review_style,status,conflict_report,created_at,completed_at')
        .eq('contract_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    if (decisionsResult.error) {
      return errorResponse(createApiError('DB_ERROR', '获取决策草稿失败'))
    }
    if (batchResult.error) {
      return errorResponse(createApiError('DB_ERROR', '获取重新审核批次失败'))
    }

    const { data: analysisJob } = batchResult.data?.analysis_job_id
      ? await supabaseAdmin
        .from('contract_analysis_jobs')
        .select('id,status,attempts,provider,degraded,last_error,created_at,started_at,completed_at')
        .eq('id', batchResult.data.analysis_job_id)
        .maybeSingle()
      : { data: null }

    const enrichedRiskCards = riskCards.map((card) => {
      const evidence = card.evidence && typeof card.evidence === 'object'
        ? card.evidence as Record<string, unknown>
        : {}
      const risk = {
        ...card,
        rule_snapshot_id: typeof evidence.rule_snapshot_id === 'string' ? evidence.rule_snapshot_id : null,
      } as ReviewRiskLike
      const sourceAnchor = shouldExposeRiskSourceAnchor(risk, evidence)
        ? buildSourceAnchor(parsedText, risk, pageMap?.pages || [])
        : null
      const decisionReview = evidence.decision_review && typeof evidence.decision_review === 'object'
        ? evidence.decision_review as Record<string, unknown>
        : {}
      const reviewOutcome = typeof decisionReview.outcome === 'string' ? decisionReview.outcome : null
      return {
        ...card,
        rule_snapshot_id: risk.rule_snapshot_id,
        review_outcome: reviewOutcome,
        outcome_reason: typeof decisionReview.reason === 'string' ? decisionReview.reason : null,
        resolved_by_batch: reviewOutcome === 'resolved',
        evidence_scope: typeof evidence.evidence_scope === 'string' ? evidence.evidence_scope : null,
        customer_output_eligible: evidence.customer_output_eligible !== false,
        source_anchor: sourceAnchor,
        evidence_anchors: sourceAnchor ? [sourceAnchor] : [],
        resolution_options: bundle ? buildPublishedResolutionOptions(risk, bundle.rules) : [],
      }
    })

    // 3. 统计信息
    const stats = {
      total: enrichedRiskCards.length,
      red: enrichedRiskCards.filter((c) => c.level === 'red').length,
      yellow: enrichedRiskCards.filter((c) => c.level === 'yellow').length,
      green: enrichedRiskCards.filter((c) => c.level === 'green').length,
      open: enrichedRiskCards.filter((c) => c.status === 'open').length,
    }

    const modelInvocations = await listModelInvocationsForContract({
      contractId: id,
      reviewId: contractReviews[0]?.id,
      limit: 20,
    })

    return successResponse({
      ...contract,
      parsed_text: undefined,
      has_source_preview: Boolean(contract.storage_path && contractSourceFormatFromFilename(contract.filename)),
      riskCards: enrichedRiskCards,
      stats,
      latestReview: latestReview || null,
      riskReviewId,
      decisionDrafts: (decisionsResult.data || []).map((draft) => ({
        ...draft,
        customer_comment: sanitizeCustomerFacingText(draft.customer_comment) || null,
        comment_preview: sanitizeCustomerFacingText(draft.comment_preview) || null,
        revision_text: sanitizeCustomerFacingText(draft.revision_text) || null,
      })),
      latestSubmissionBatch: batchResult.data ? {
        ...batchResult.data,
        analysis_job: analysisJob,
      } : null,
      publishedRuleBundle: bundle ? {
        id: bundle.id,
        version: bundle.version,
        published_at: bundle.published_at,
        rule_count: bundle.rules.length,
      } : null,
      sourcePageMap: pageMap ? {
        page_count: pageMap.page_count,
        locator: pageMap.locator,
        source_hash: pageMap.source_hash,
        source_text_hash: pageMap.source_text_hash,
      } : {
        page_count: null,
        locator: 'provisional',
        source_hash: null,
        source_text_hash: null,
      },
      sourcePreviewError,
      sourceReviewStale,
      reviewStyles: [
        { id: 'lenient', label: '宽松', description: '合作优先，仅阻断明确红线，对应 CONSERVATIVE 运行策略。' },
        { id: 'balanced', label: '均衡', description: '按发布规则的推荐等级执行。' },
        { id: 'strict', label: '严格', description: '强势保护己方，偏离项优先升级，对应 AGGRESSIVE 运行策略。' },
      ],
      modelInvocations,
    })
  })
}

// PATCH - 更新审核结论（通过/驳回/转交）
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const { conclusion, conclusion_reason } = body

    // 1. 验证结论值
    const validConclusions = ['APPROVED', 'REJECTED', 'ESCALATED']
    if (!validConclusions.includes(conclusion)) {
      return errorResponse(
        createApiError('VALIDATION_ERROR', `无效的结论值: ${conclusion}，必须选择通过/驳回/转交`)
      )
    }

    // 2. 检查合同是否存在
    const { data: existing, error: checkError } = await supabaseAdmin
      .from('contracts')
      .select('id, status, conclusion')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle()

    if (checkError || !existing) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在'))
    }

    // 3. 防止重复操作
    if (existing.conclusion && existing.conclusion !== 'PENDING') {
      return errorResponse(
        createApiError('VALIDATION_ERROR', `合同已${existing.conclusion === 'APPROVED' ? '通过' : existing.conclusion === 'REJECTED' ? '驳回' : '转交'}，不可重复操作`)
      )
    }

    // 4. 更新合同结论
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('contracts')
      .update({
        conclusion,
        conclusion_reason: conclusion_reason || null,
        concluded_at: new Date().toISOString(),
        concluded_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .or('conclusion.is.null,conclusion.eq.PENDING')
      .select()
      .maybeSingle()

    if (updateError || !updated) {
      return errorResponse(createApiError('CONFLICT', '审核结论已被其他会话更新，请刷新后重试'), 409)
    }

    // 5. 写入审计日志
    await supabaseAdmin.from('contract_rule_audit_logs').insert({
      rule_id: null,  // 无关联规则
      rule_set_id: null,
      action: `conclusion_${conclusion.toLowerCase()}`,
      before_value: { conclusion: existing.conclusion },
      after_value: { conclusion, reason: conclusion_reason },
      changed_by: user.id,
      change_note: conclusion_reason || `${conclusion} 操作`,
    })

    return successResponse({
      message: conclusion === 'APPROVED'
        ? '审核通过'
        : conclusion === 'REJECTED'
          ? '已驳回'
          : '已转交',
      contract: updated,
    })
  })
}
