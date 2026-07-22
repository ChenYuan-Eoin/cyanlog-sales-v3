import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { createApiError } from '@/lib/api/errors'
import { errorResponse, successResponse } from '@/lib/api/common'
import type { AuthUser } from '@/lib/auth'
import {
  buildDecisionNotes,
  buildPublishedResolutionOptions,
  buildSourceAnchor,
  decisionWorkflowState,
  shouldExposeRiskSourceAnchor,
  type ReviewRiskLike,
} from '@/lib/contracts/review-workbench'
import { loadReviewBundleSnapshot } from '@/lib/contracts/review-workbench-server'
import { ensureContractPageMap } from '@/lib/documents/source-render-server'
import { contractSourceFormatFromFilename } from '@/lib/documents/source-format'

const normalizedPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
})

const manualAnchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('point'), page: z.number().int().min(1), point: normalizedPointSchema }),
  z.object({
    kind: z.literal('region'),
    page: z.number().int().min(1),
    region: normalizedPointSchema.extend({ width: z.number().gt(0).max(1), height: z.number().gt(0).max(1) })
      .refine((region) => region.x + region.width <= 1 && region.y + region.height <= 1, '人工区域超出页面范围'),
  }),
])

const sourceIdentitySchema = z.object({
  storage_path: z.string().min(1),
  source_hash: z.string().regex(/^[0-9a-f]{64}$/),
  source_text_hash: z.string().regex(/^[0-9a-f]{64}$/),
})

const decisionSchema = z.object({
  resolution_strategy_id: z.string().min(1).nullable(),
  negotiation_result: z.enum(['customer_agreed', 'customer_feedback', 'exception_requested']).nullable(),
  feedback: z.string().max(4000).nullable().optional(),
  expected_version: z.number().int().min(0),
  source_anchor_override: manualAnchorSchema.nullable().optional(),
  source_identity: sourceIdentitySchema,
})

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; riskId: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id: contractId, riskId } = await params
    const parsed = decisionSchema.safeParse(await req.json().catch(() => ({})))

    if (!parsed.success) {
      return errorResponse(createApiError('VALIDATION_ERROR', parsed.error.issues.map((issue) => issue.message).join(', ')))
    }

    const [{ data: contract, error: contractError }, { data: risk, error: riskError }] = await Promise.all([
      supabaseAdmin
        .from('contracts')
        .select('id,org_id,filename,mime_type,storage_path,parsed_text')
        .eq('id', contractId)
        .eq('org_id', orgId)
        .maybeSingle(),
      supabaseAdmin
        .from('contract_risk_cards')
        .select('id,contract_id,review_id,level,title,description,suggestion,clause_ref,position_start,position_end,rule_code,evidence,status')
        .eq('id', riskId)
        .eq('contract_id', contractId)
        .maybeSingle(),
    ])

    if (contractError || !contract || riskError || !risk?.review_id) {
      return errorResponse(createApiError('NOT_FOUND', '合同风险不存在或无权访问'))
    }
    if (risk.status !== 'open') {
      return errorResponse(createApiError('CONFLICT', '该风险已通过复审或不再开放，不能继续修改决策'), 409)
    }
    const evidence = risk.evidence && typeof risk.evidence === 'object'
      ? risk.evidence as Record<string, unknown>
      : {}
    const boundRisk = {
      ...risk,
      rule_snapshot_id: typeof evidence.rule_snapshot_id === 'string' ? evidence.rule_snapshot_id : null,
    } as ReviewRiskLike
    if (!shouldExposeRiskSourceAnchor(boundRisk, evidence)) {
      return errorResponse(createApiError(
        'BUSINESS_RULE_VIOLATION',
        '该风险是文档级覆盖结论，未绑定原文；不能设置页码、保存为原文决策或进入源文件批注导出'
      ), 422)
    }
    const pageMap = contract.storage_path
      ? await ensureContractPageMap({
        id: contract.id,
        filename: contract.filename,
        mime_type: contract.mime_type,
        storage_path: contract.storage_path,
        parsed_text: contract.parsed_text,
      }).catch(() => null)
      : null
    if (!contract.storage_path || !pageMap?.source_hash || !pageMap.source_text_hash) {
      return errorResponse(createApiError('INTERNAL_ERROR', '当前源文件缺少可审计身份，不能保存处理策略'), 503)
    }
    if (
      parsed.data.source_identity.storage_path !== contract.storage_path
      || parsed.data.source_identity.source_hash !== pageMap.source_hash
      || parsed.data.source_identity.source_text_hash !== pageMap.source_text_hash
    ) {
      return errorResponse(createApiError('CONFLICT', '页面加载后合同源文件已变化，请刷新后重新定位'), 409)
    }
    const { data: sourceReview, error: sourceReviewError } = await supabaseAdmin
      .from('contract_reviews')
      .select('id,status,source_storage_path,source_hash,source_text_hash,skill_bundle_id,rule_version')
      .eq('id', risk.review_id)
      .eq('contract_id', contractId)
      .maybeSingle()
    if (
      sourceReviewError
      || !sourceReview
      || sourceReview.status !== 'COMPLETED'
      || sourceReview.source_storage_path !== contract.storage_path
      || sourceReview.source_hash !== pageMap.source_hash
      || sourceReview.source_text_hash !== pageMap.source_text_hash
    ) {
      return errorResponse(createApiError('CONFLICT', '该风险所属 ReviewRun 未绑定当前源文件，必须先重新审核当前文件'), 409)
    }
    if (!sourceReview.skill_bundle_id || !sourceReview.rule_version) {
      return errorResponse(createApiError('CONFLICT', '该 ReviewRun 缺少冻结规则包身份，不能继续处理'), 409)
    }
    const bundle = await loadReviewBundleSnapshot(orgId, sourceReview.skill_bundle_id, sourceReview.rule_version)
    if (!bundle) {
      return errorResponse(createApiError('CONFLICT', '该 ReviewRun 对应的历史规则包已不可用，不能改用当前规则解释历史风险'), 409)
    }
    const options = buildPublishedResolutionOptions(boundRisk, bundle.rules)
    const selectedOption = parsed.data.resolution_strategy_id
      ? options.find((option) => option.id === parsed.data.resolution_strategy_id) || null
      : null

    if (parsed.data.resolution_strategy_id && !selectedOption) {
      return errorResponse(createApiError('BUSINESS_RULE_VIOLATION', '所选策略不属于该 ReviewRun 冻结的规则版本'), 409)
    }
    if (parsed.data.negotiation_result === 'customer_agreed' && !selectedOption) {
      return errorResponse(createApiError('BUSINESS_RULE_VIOLATION', '客户同意必须绑定该 ReviewRun 冻结的法务策略'), 409)
    }
    if (
      parsed.data.negotiation_result === 'customer_agreed'
      && selectedOption
      && !selectedOption.revision_text?.trim()
      && !selectedOption.comment_template?.trim()
    ) {
      return errorResponse(createApiError(
        'BUSINESS_RULE_VIOLATION',
        '该历史发布策略缺少客户侧批注模板或受控替换文本，不能进入客户文件。请在配置中心补齐并发布新版本。'
      ), 409)
    }
    const manualAnchor = parsed.data.source_anchor_override
    if (manualAnchor && contractSourceFormatFromFilename(contract.filename) !== 'pdf') {
      return errorResponse(createApiError('BUSINESS_RULE_VIOLATION', '人工页面位置批注当前仅用于 PDF；Word 原生批注必须绑定原文文本'), 422)
    }
    if (manualAnchor && pageMap?.page_count && manualAnchor.page > pageMap.page_count) {
      return errorResponse(createApiError('VALIDATION_ERROR', `人工批注页码超出范围，共 ${pageMap.page_count} 页`))
    }
    const generatedAnchor = buildSourceAnchor(contract.parsed_text || '', boundRisk, pageMap?.pages || [])
    if (!manualAnchor && (!generatedAnchor.exact_text || generatedAnchor.end <= generatedAnchor.start)) {
      return errorResponse(createApiError(
        'BUSINESS_RULE_VIOLATION',
        contractSourceFormatFromFilename(contract.filename) === 'pdf'
          ? '该风险尚未定位到唯一原文；请先在 PDF 上设置人工点位或区域，再保存决策'
          : '该风险尚未定位到唯一 Word 原文，不能生成原生批注或提交决策；请重新审核并要求返回逐字原文引用'
      ), 422)
    }
    const sourceAnchor = manualAnchor ? {
      ...generatedAnchor,
      page: manualAnchor.page,
      locator: 'rendered' as const,
      precision: 'page' as const,
      boxes: manualAnchor.kind === 'region' ? [{
        left: manualAnchor.region.x * 100,
        top: manualAnchor.region.y * 100,
        width: manualAnchor.region.width * 100,
        height: manualAnchor.region.height * 100,
      }] : [],
      anchor_kind: manualAnchor.kind,
      ...(manualAnchor.kind === 'point' ? { point: manualAnchor.point } : { region: manualAnchor.region }),
    } : generatedAnchor
    const notes = buildDecisionNotes({
      risk: boundRisk,
      decisionKind: parsed.data.negotiation_result,
      option: selectedOption,
      feedback: parsed.data.feedback,
    })
    const exactSourceAnchor = (
      sourceAnchor.locator === 'rendered'
      || sourceAnchor.precision === 'source_exact'
    )
      && sourceAnchor.end > sourceAnchor.start
    const revisionText = parsed.data.negotiation_result === 'customer_agreed'
      && selectedOption?.change_mode === 'tracked_revision'
      && selectedOption.revision_text
      && exactSourceAnchor
      ? selectedOption.revision_text
      : null
    const translationInputSnapshot = {
      source_evidence: {
        clause_ref: sourceAnchor.clause_ref,
        excerpt: sourceAnchor.excerpt,
        exact_text: sourceAnchor.exact_text,
        page: sourceAnchor.page,
        anchor_kind: 'anchor_kind' in sourceAnchor ? sourceAnchor.anchor_kind : 'text',
      },
      published_option_snapshot: selectedOption,
      legal_template_snapshot: selectedOption ? {
        customer_comment: selectedOption.comment_template,
        revision_text: selectedOption.revision_text,
      } : null,
      negotiation_result: parsed.data.negotiation_result,
      internal_feedback: parsed.data.feedback?.trim() || null,
    }
    const now = new Date().toISOString()

    const { data: existing } = await supabaseAdmin
      .from('contract_review_decision_drafts')
      .select('id,status,optimistic_version')
      .eq('review_id', risk.review_id)
      .eq('risk_id', riskId)
      .eq('created_by', user.id)
      .maybeSingle()

    if (existing && existing.status !== 'draft_selected') {
      return errorResponse(createApiError('CONFLICT', '该决策已提交复审，不能从旧页面重新打开；请刷新查看最新 ReviewRun'), 409)
    }
    if ((existing?.optimistic_version || 0) !== parsed.data.expected_version) {
      return errorResponse(createApiError('CONFLICT', '决策草稿已被其他会话更新，请刷新后重试', {
        current_version: existing?.optimistic_version || 0,
      }), 409)
    }

    const row = {
      org_id: orgId,
      contract_id: contractId,
      review_id: risk.review_id,
      risk_id: riskId,
      created_by: user.id,
      status: 'draft_selected',
      decision_kind: parsed.data.negotiation_result,
      selected_option_id: selectedOption?.id || null,
      selected_option_snapshot: selectedOption,
      resolution_strategy_id: selectedOption?.id || null,
      resolution_strategy_snapshot: selectedOption,
      negotiation_result: parsed.data.negotiation_result,
      feedback: parsed.data.feedback?.trim() || null,
      internal_note: notes.internal_note,
      customer_comment: revisionText ? null : notes.customer_comment,
      revision_text: revisionText,
      translation_input_snapshot: translationInputSnapshot,
      comment_preview: revisionText ? null : notes.customer_comment,
      source_anchor: sourceAnchor,
      source_storage_path: contract.storage_path,
      source_hash: pageMap.source_hash,
      source_text_hash: pageMap.source_text_hash,
      evidence_anchors: [sourceAnchor],
      workflow_state: decisionWorkflowState({
        risk_id: riskId,
        resolution_strategy_id: selectedOption?.id || null,
        negotiation_result: parsed.data.negotiation_result,
        feedback: parsed.data.feedback,
      }),
      rule_bundle_id: bundle.id,
      rule_bundle_version: bundle.version,
      submission_batch_id: null,
      submitted_at: null,
      optimistic_version: (existing?.optimistic_version || 0) + 1,
      updated_at: now,
    }

    const { data: currentContract, error: currentContractError } = await supabaseAdmin
      .from('contracts')
      .select('id,filename,mime_type,storage_path,parsed_text')
      .eq('id', contractId)
      .eq('org_id', orgId)
      .maybeSingle()
    const currentPageMap = currentContract?.storage_path
      ? await ensureContractPageMap({
        id: currentContract.id,
        filename: currentContract.filename,
        mime_type: currentContract.mime_type,
        storage_path: currentContract.storage_path,
        parsed_text: currentContract.parsed_text,
      }).catch(() => null)
      : null
    if (
      currentContractError
      || currentContract?.storage_path !== contract.storage_path
      || currentContract?.filename !== contract.filename
      || currentContract?.mime_type !== contract.mime_type
      || currentPageMap?.source_hash !== pageMap.source_hash
      || currentPageMap?.source_text_hash !== pageMap.source_text_hash
    ) {
      return errorResponse(createApiError('CONFLICT', '保存期间合同源文件已变化，请刷新后重新定位'), 409)
    }

    const { data: savedRows, error } = await supabaseAdmin.rpc('save_contract_review_decision_draft', {
      p_org_id: orgId,
      p_contract_id: contractId,
      p_review_id: risk.review_id,
      p_risk_id: riskId,
      p_created_by: user.id,
      p_expected_version: parsed.data.expected_version,
      p_draft: row,
    })
    const saved = Array.isArray(savedRows) ? savedRows[0] : savedRows

    if (error) {
      if (['55000', '23514', '40001', '40P01', '23505'].includes(error.code || '')) {
        return errorResponse(createApiError('CONFLICT', '当前风险、ReviewRun 或源文件已变化，请刷新查看最新状态'), 409)
      }
      return errorResponse(createApiError('DB_ERROR', '保存决策草稿失败'))
    }
    if (!saved) {
      return errorResponse(createApiError('CONFLICT', '决策草稿发生并发更新，请刷新后重试'), 409)
    }

    return successResponse({
      ...saved,
      saved_at: now,
    })
  })
}
