import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { createApiError } from '@/lib/api/errors'
import { errorResponse, successResponse } from '@/lib/api/common'
import type { AuthUser } from '@/lib/auth'
import {
  inspectDecisionConflicts,
  type DecisionDraftLike,
  type ReviewRiskLike,
} from '@/lib/contracts/review-workbench'
import { loadReviewBundleSnapshot } from '@/lib/contracts/review-workbench-server'
import { ensureContractPageMap } from '@/lib/documents/source-render-server'
import {
  processContractAnalysisJob,
  readContractAnalysisTerminalState,
  type ContractAnalysisJobRecord,
} from '@/lib/contract-analysis'

const submitSchema = z.object({
  review_id: z.string().uuid(),
  review_style: z.enum(['lenient', 'balanced', 'strict']).default('balanced'),
  source_identity: z.object({
    storage_path: z.string().min(1),
    source_hash: z.string().regex(/^[0-9a-f]{64}$/),
    source_text_hash: z.string().regex(/^[0-9a-f]{64}$/),
  }),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id: contractId } = await params
    const parsed = submitSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return errorResponse(createApiError('VALIDATION_ERROR', parsed.error.issues.map((issue) => issue.message).join(', ')))
    }

    const { data: authorizedContract, error: authorizationError } = await supabaseAdmin
      .from('contracts')
      .select('id')
      .eq('id', contractId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (authorizationError || !authorizedContract) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在或无权访问'))
    }

    const { error: staleSetupError } = await supabaseAdmin.rpc('expire_stale_contract_review_setups', {
      p_stale_after: '15 minutes',
      p_contract_id: contractId,
    })
    if (staleSetupError) {
      return errorResponse(createApiError('DB_ERROR', '无法核对或回收历史复审准备态，已停止本次提交'))
    }

    const [contractResult, riskResult, draftResult] = await Promise.all([
      supabaseAdmin
        .from('contracts')
        .select('id,status,filename,mime_type,storage_path,parsed_text')
        .eq('id', contractId)
        .eq('org_id', orgId)
        .maybeSingle(),
      supabaseAdmin
        .from('contract_risk_cards')
        .select('id,level,title,description,suggestion,clause_ref,position_start,position_end,rule_code')
        .eq('contract_id', contractId)
        .eq('review_id', parsed.data.review_id)
        .eq('status', 'open'),
      supabaseAdmin
        .from('contract_review_decision_drafts')
        .select('*')
        .eq('contract_id', contractId)
        .eq('review_id', parsed.data.review_id)
        .eq('created_by', user.id)
        .eq('status', 'draft_selected'),
    ])

    if (contractResult.error || !contractResult.data) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在或无权访问'))
    }
    if (riskResult.error || draftResult.error) {
      return errorResponse(createApiError('DB_ERROR', '读取风险或决策草稿失败'))
    }
    if (contractResult.data.status === 'PARSING' || contractResult.data.status === 'ANALYZING') {
      return errorResponse(createApiError('BUSINESS_RULE_VIOLATION', '合同正在审核中，请等待当前 ReviewRun 完成'), 409)
    }
    if (!contractResult.data.storage_path) {
      return errorResponse(createApiError('BUSINESS_RULE_VIOLATION', '合同源文件缺失，不能提交可审计复审'), 409)
    }

    const risks = (riskResult.data || []) as ReviewRiskLike[]
    if (risks.length === 0) {
      return errorResponse(createApiError('BUSINESS_RULE_VIOLATION', '当前 ReviewRun 已无待处理风险，无需再次提交复审', {
        code: 'NO_OPEN_RISKS',
      }), 409)
    }
    const openRiskIds = new Set(risks.map((risk) => risk.id))
    const currentDraftRows = (draftResult.data || []).filter((draft) => openRiskIds.has(draft.risk_id))

    const pageMap = await ensureContractPageMap({
      id: contractResult.data.id,
      filename: contractResult.data.filename,
      mime_type: contractResult.data.mime_type,
      storage_path: contractResult.data.storage_path,
      parsed_text: contractResult.data.parsed_text,
    }).catch(() => null)
    if (!pageMap?.source_hash || !pageMap.source_text_hash) {
      return errorResponse(createApiError('BUSINESS_RULE_VIOLATION', '当前源文件缺少可审计字节或解析文本哈希，不能提交复审'), 409)
    }
    const sourceIdentity = {
      storage_path: contractResult.data.storage_path,
      source_hash: pageMap.source_hash,
      source_text_hash: pageMap.source_text_hash,
    }
    if (
      parsed.data.source_identity.storage_path !== sourceIdentity.storage_path
      || parsed.data.source_identity.source_hash !== sourceIdentity.source_hash
      || parsed.data.source_identity.source_text_hash !== sourceIdentity.source_text_hash
    ) {
      return errorResponse(createApiError('CONFLICT', '页面加载后合同源文件已变化，请刷新后重新提交'), 409)
    }

    const { data: sourceReview, error: sourceReviewError } = await supabaseAdmin
      .from('contract_reviews')
      .select('id,status,source_storage_path,source_hash,source_text_hash,skill_bundle_id,rule_version')
      .eq('id', parsed.data.review_id)
      .eq('contract_id', contractId)
      .maybeSingle()
    if (
      sourceReviewError
      || !sourceReview
      || sourceReview.status !== 'COMPLETED'
      || sourceReview.source_storage_path !== sourceIdentity.storage_path
      || sourceReview.source_hash !== sourceIdentity.source_hash
      || sourceReview.source_text_hash !== sourceIdentity.source_text_hash
    ) {
      return errorResponse(createApiError('CONFLICT', '该 ReviewRun 未完成、已过期或不属于当前源文件，请刷新后重试'), 409)
    }
    if (!sourceReview.skill_bundle_id || !sourceReview.rule_version) {
      return errorResponse(createApiError('CONFLICT', '该 ReviewRun 缺少冻结规则包身份，不能批量提交'), 409)
    }
    const bundle = await loadReviewBundleSnapshot(orgId, sourceReview.skill_bundle_id, sourceReview.rule_version)
    if (!bundle) {
      return errorResponse(createApiError('CONFLICT', '该 ReviewRun 对应的历史规则包已不可用，不能改用当前规则提交'), 409)
    }
    if (bundle.execution_contract !== 'legacy_risk_v1') {
      return errorResponse(createApiError(
        'BUSINESS_RULE_VIOLATION',
        'facts_v1 候选审核尚未开放决策复审；已停止提交，避免回落到 legacy severity 链',
        { code: 'FACTS_V1_DECISION_REVIEW_NOT_READY' },
      ), 409)
    }

    const drafts = currentDraftRows.map((draft) => ({
      ...draft,
      risk_title: risks.find((risk) => risk.id === draft.risk_id)?.title,
    })) as DecisionDraftLike[]
    if (currentDraftRows.some((draft) => (
      draft.source_storage_path !== sourceIdentity.storage_path
      || draft.source_hash !== sourceIdentity.source_hash
      || draft.source_text_hash !== sourceIdentity.source_text_hash
    ))) {
      return errorResponse(createApiError('CONFLICT', '存在绑定旧源文件或旧解析文本的决策草稿，请刷新并重新确认'), 409)
    }
    const conflicts = inspectDecisionConflicts(risks, drafts)

    const { data: currentSource, error: currentSourceError } = await supabaseAdmin
      .from('contracts')
      .select('id,filename,mime_type,storage_path,parsed_text')
      .eq('id', contractId)
      .eq('org_id', orgId)
      .maybeSingle()
    const currentPageMap = currentSource?.storage_path
      ? await ensureContractPageMap({
        id: currentSource.id,
        filename: currentSource.filename,
        mime_type: currentSource.mime_type,
        storage_path: currentSource.storage_path,
        parsed_text: currentSource.parsed_text,
      }, { forceSourceVerification: true }).catch(() => null)
      : null
    if (
      currentSourceError
      || currentSource?.storage_path !== sourceIdentity.storage_path
      || currentSource?.filename !== contractResult.data.filename
      || currentSource?.mime_type !== contractResult.data.mime_type
      || currentPageMap?.source_hash !== sourceIdentity.source_hash
      || currentPageMap?.source_text_hash !== sourceIdentity.source_text_hash
    ) {
      return errorResponse(createApiError('CONFLICT', '提交期间合同源文件或解析文本已变化，请刷新后重新确认'), 409)
    }

    if (conflicts.length > 0) {
      const { data: conflictBatch, error: conflictBatchError } = await supabaseAdmin
        .from('contract_review_submission_batches')
        .insert({
          org_id: orgId,
          contract_id: contractId,
          source_review_id: parsed.data.review_id,
          submitted_by: user.id,
          review_style: parsed.data.review_style,
          status: 'conflict',
          decision_snapshot: drafts,
          conflict_report: conflicts,
          rule_bundle_id: bundle.id,
          rule_bundle_version: bundle.version,
          source_storage_path: sourceIdentity.storage_path,
          source_hash: sourceIdentity.source_hash,
          source_text_hash: sourceIdentity.source_text_hash,
          completed_at: new Date().toISOString(),
        })
        .select('id')
        .single()
      if (conflictBatchError || !conflictBatch) {
        if (conflictBatchError?.code === '23514' || conflictBatchError?.code === '55000') {
          return errorResponse(createApiError('CONFLICT', '记录冲突前合同源文件或审核状态已变化，请刷新后重试'), 409)
        }
        return errorResponse(createApiError('DB_ERROR', '记录提交冲突失败'))
      }
      return errorResponse(createApiError('BUSINESS_RULE_VIOLATION', '提交前冲突检查未通过', {
        batch_id: conflictBatch.id,
        conflicts,
      }), 409)
    }

    const { data: setupRows, error: setupError } = await supabaseAdmin.rpc(
      'start_contract_review_decision_batch',
      {
        p_org_id: orgId,
        p_contract_id: contractId,
        p_source_review_id: parsed.data.review_id,
        p_submitted_by: user.id,
        p_review_style: parsed.data.review_style,
        p_decision_snapshot: drafts,
        p_rule_bundle_id: bundle.id,
        p_rule_bundle_version: bundle.version,
        p_model_policy_id: bundle.model_policy_id,
        p_rule_snapshot_ids: bundle.rule_snapshot_ids,
        p_rule_set_snapshot_ids: bundle.rule_set_snapshot_ids,
        p_source_storage_path: sourceIdentity.storage_path,
        p_source_hash: sourceIdentity.source_hash,
        p_source_text_hash: sourceIdentity.source_text_hash,
      }
    )
    const setup = Array.isArray(setupRows) ? setupRows[0] : setupRows
    if (setupError?.code === '23505' || setupError?.code === '23514' || setupError?.code === '55000' || setupError?.code === '40001') {
      return errorResponse(createApiError('CONFLICT', '合同或决策在提交期间发生变化，请刷新后重试'), 409)
    }
    if (setupError || !setup?.batch_id || !setup.review_id || !setup.job_id) {
      return errorResponse(createApiError('DB_ERROR', '无法原子创建复审批次、ReviewRun 与分析任务'))
    }

    // Fast path: consume this exact queued job through the same lease-fenced
    // processor used by the durable worker. A high-frequency worker remains the
    // release fallback for request loss/timeouts; this path removes avoidable
    // wait time without creating a second execution implementation.
    const now = new Date().toISOString()
    const job: ContractAnalysisJobRecord = {
      id: setup.job_id,
      contract_id: contractId,
      review_id: setup.review_id,
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
    let executionStatus: 'queued' | 'running' | 'completed' | 'failed' = 'queued'
    let processingError: string | null = null
    try {
      await processContractAnalysisJob(job)
      executionStatus = 'completed'
    } catch (processingFailure) {
      processingError = processingFailure instanceof Error ? processingFailure.message : String(processingFailure)
      const terminalState = await readContractAnalysisTerminalState(job)
      if (terminalState === 'completed') executionStatus = 'completed'
      else if (terminalState === 'failed') executionStatus = 'failed'
      else if (terminalState === 'active') executionStatus = job.status === 'running' ? 'running' : 'queued'
      else {
        return errorResponse(createApiError('INTERNAL_ERROR', '复审批次出现不一致终态，已停止自动补偿'), 500)
      }
    }
    return successResponse({
      batch_id: setup.batch_id,
      review_id: setup.review_id,
      job_id: setup.job_id,
      status: executionStatus,
      processing_error: executionStatus === 'completed' ? null : processingError,
      conflicts: [],
    }, undefined, 202)
  })
}
