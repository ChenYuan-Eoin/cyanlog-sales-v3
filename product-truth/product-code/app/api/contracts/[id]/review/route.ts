// GET /api/contracts/:id/review
// PATCH /api/contracts/:id/review
// 获取合同审核结果 + 更新审核结论

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import {
  errorResponse,
  successResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import {
  canAccessContractAction,
  getAccessibleContract,
  listFreshAccessibleUserIds,
} from '@/lib/scoped-access'
import {
  buildReviewRunEvidence,
  type ReviewEvidenceModelInvocation,
  type ReviewEvidenceModelPolicy,
  type ReviewEvidenceRuleSetSnapshot,
  type ReviewEvidenceRuntimePlanSnapshot,
  type ReviewEvidenceSkillBundle,
  type ReviewEvidenceSnapshot,
} from '@/lib/contracts/review-evidence'
import { buildNegotiationTasks } from '@/lib/contracts/negotiation-task'
import { canAccessAskByRoles } from '@/lib/ask/permissions'
import {
  resolveReviewRunSourceVersion,
  selectReviewRunForSourceVersion,
} from '@/lib/contracts/review-source-identity'
import {
  deriveContractSourceReadiness,
  type ContractSourcePageMapReference,
} from '@/lib/contracts/contract-source-readiness'

type ContractReviewRow = {
  id: string
  status?: string | null
  contract_version_id?: string | null
  source_storage_path?: string | null
  source_hash?: string | null
  source_text_hash?: string | null
  results?: unknown
  rule_version?: number | null
  skill_bundle_id?: string | null
  plan_snapshot_id?: string | null
  model_policy_id?: string | null
  rule_snapshot_ids?: string[] | null
  rule_set_snapshot_ids?: string[] | null
  rule_set_document_ids?: string[] | null
  model_invocation_ids?: string[] | null
  review_trigger?: string | null
  created_at?: string | null
  completed_at?: string | null
}

type ContractVersionRow = {
  id: string
  contract_id: string
  version_number: number
  source: 'original' | 'review_revision' | 'manual_revision'
  storage_path: string
  file_size: number | null
  mime_type: string | null
  file_url?: string | null
  parent_version_id: string | null
  change_summary: string | null
  review_id: string | null
  upload_id: string | null
  file_sha256: string | null
  text_sha256: string | null
  ingest_status: 'SOURCE_READY' | 'AWAITING_OCR' | 'AWAITING_CONVERSION' | 'FAILED' | null
  ingest_error: string | null
  created_at: string | null
}

type RiskCardRow = {
  id: string
  review_id?: string | null
  contract_id: string
  rule_id?: string | null
  rule_code?: string | null
  rule_version?: number | null
  level: 'red' | 'yellow' | 'green' | 'white'
  title: string
  description?: string | null
  suggestion?: string | null
  evidence?: unknown
  fix_action?: unknown
  status: string
  clause_ref?: string | null
  position_start?: number | null
  position_end?: number | null
  created_at?: string | null
}

type ContractAnalysisJobRow = {
  id?: string
  review_id?: string | null
  status?: string | null
  provider?: string | null
  degraded?: boolean | null
  last_error?: string | null
  started_at?: string | null
  completed_at?: string | null
}

type AnnotationRow = {
  id: string
  contract_id: string
  review_id?: string | null
  contract_version_id?: string | null
  start_offset: number
  end_offset: number
  selected_text: string | null
  comment: string
  category: string | null
  priority: string | null
  status: string
  author_id: string | null
  created_at: string | null
}

type AskResponseRow = {
  id: string
  responder_id: string
  responder_role: string
  responder_name: string
  response_text: string
  created_at: string | null
}

type AskTaskRow = {
  id: string
  review_id?: string | null
  contract_version_id?: string | null
  ask_code?: string | null
  risk_name?: string | null
  initial_level: 'red' | 'yellow' | 'green'
  question_type?: string | null
  required_roles?: string[] | null
  question_text: string
  qualified_std?: string | null
  status: 'pending' | 'responded' | 'closed'
  closed_reason?: string | null
  ask_responses?: AskResponseRow[] | null
}

type ReportVersionRow = {
  id: string
  review_id?: string | null
  contract_version_id?: string | null
  version: number
  trigger_event: string
  trigger_ask_id: string | null
  report_data: {
    summary?: {
      total?: number
      pending?: number
      responded?: number
      closed?: number
    }
  } | null
  report_file_url: string | null
  is_current: boolean
  created_at: string | null
}

const reviewConclusionSchema = z.object({
  conclusion: z.enum(['APPROVED', 'REJECTED', 'ESCALATED']),
  conclusion_reason: z.string().trim().max(1000, '原因不能超过 1000 字').optional().nullable(),
}).superRefine((data, context) => {
  if (data.conclusion !== 'APPROVED' && !data.conclusion_reason?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['conclusion_reason'],
      message: data.conclusion === 'REJECTED' ? '驳回原因必填' : '转交原因必填',
    })
  }
})

function nonEmptyStrings(values: string[] | null | undefined): string[] | null {
  if (!Array.isArray(values)) return null
  const normalized = values.filter((value) => typeof value === 'string' && value.trim().length > 0)
  return normalized.length > 0 ? normalized : null
}

function contractFileAccessUrl(contractId: string, storagePath: string | null | undefined) {
  if (!storagePath) return null
  return `/api/contracts/${contractId}/file?path=${encodeURIComponent(storagePath)}`
}

// GET - 获取审核结果
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params
    const view = req.nextUrl.searchParams.get('view')
    const summaryOnly = view === 'summary'
    const requestedReviewId = req.nextUrl.searchParams.get('review')?.trim() || null

    // 1. 获取合同基本信息（包含结论字段）
    const { contract, assignments } = await getAccessibleContract<{
      id: string
      contract_reviews?: Array<{ created_at?: string }>
      [key: string]: unknown
    }>(id, user.id, orgId, '*, contract_reviews(*)')

    if (!canAccessContractAction(assignments, orgId, 'view')) {
      return errorResponse(createApiError('FORBIDDEN', '没有查看合同审核结果的权限'))
    }

    if (!contract) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在'))
    }

    const reviews = ([...(contract.contract_reviews || [])] as ContractReviewRow[]).sort((left, right) =>
      new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime()
    )

    const [versionsResult, pageMapsResult] = await Promise.all([
      supabaseAdmin
        .from('contract_versions')
        .select('id, contract_id, version_number, source, storage_path, file_size, mime_type, parent_version_id, change_summary, review_id, upload_id, file_sha256, text_sha256, ingest_status, ingest_error, created_at')
        .eq('contract_id', id)
        .order('version_number', { ascending: false }),
      supabaseAdmin
        .from('contract_source_page_maps')
        .select('contract_version_id, storage_path, source_hash, source_text_hash, render_mode, locator, page_count, generated_at')
        .eq('contract_id', id),
    ])

    if (versionsResult.error || pageMapsResult.error) {
      return errorResponse(createApiError('DB_ERROR', '获取合同文件准备状态失败'))
    }

    const versions = await Promise.all(((versionsResult.data || []) as ContractVersionRow[]).map(async (version) => ({
      ...version,
      file_url: contractFileAccessUrl(id, version.storage_path),
    })))
    const outputVersions = versions.filter((version) => version.source === 'review_revision')
    const sourceVersions = versions.filter((version) => version.source !== 'review_revision')
    const currentVersionId = typeof contract.current_version_id === 'string'
      ? contract.current_version_id
      : null
    const currentVersion = sourceVersions.find((version) => version.id === currentVersionId) || null
    const sourceIdentity = deriveContractSourceReadiness({
      contractId: id,
      contractStoragePath: typeof contract.storage_path === 'string' ? contract.storage_path : null,
      currentVersionId,
      versions,
      pageMaps: (pageMapsResult.data || []) as ContractSourcePageMapReference[],
    })
    const currentReview = selectReviewRunForSourceVersion(reviews, currentVersion)

    let selectedReview = currentReview
    let reviewedVersion = currentVersion
    let reviewContext: 'current' | 'historical' | 'current_unreviewed' = currentReview
      ? 'current'
      : 'current_unreviewed'
    if (requestedReviewId) {
      const requestedReview = reviews.find((review) => review.id === requestedReviewId) || null
      const requestedVersion = requestedReview
        ? resolveReviewRunSourceVersion(requestedReview, sourceVersions)
        : null
      if (!requestedReview || !requestedVersion) {
        return errorResponse(createApiError('NOT_FOUND', '审核记录不存在，或其源文件身份无法验证'))
      }
      selectedReview = requestedReview
      reviewedVersion = requestedVersion
      reviewContext = currentReview?.id === requestedReview.id ? 'current' : 'historical'
    }

    const riskCardsResult = selectedReview
      ? await supabaseAdmin
        .from('contract_risk_cards')
        .select('*')
        .eq('contract_id', id)
        .eq('review_id', selectedReview.id)
        .order('level', { ascending: false })
        .order('created_at', { ascending: true })
      : { data: [] as RiskCardRow[], error: null }
    const { data: riskCards, error: riskError } = riskCardsResult

    if (riskError) {
      return errorResponse(createApiError('DB_ERROR', '获取风险卡片失败'))
    }

    const riskOrder: Record<string, number> = { red: 0, yellow: 1, green: 2, white: 3 }
    const orderedRiskCards = ([...(riskCards || [])] as RiskCardRow[]).sort((left, right) => (
      (riskOrder[left.level] ?? 9) - (riskOrder[right.level] ?? 9)
      || new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime()
    ))

    const emptyRows = <T,>() => Promise.resolve({ data: [] as T[], error: null })
    const reportVersionsRequest = summaryOnly || !selectedReview || !reviewedVersion
      ? emptyRows<ReportVersionRow>()
      : supabaseAdmin
        .from('report_versions')
        .select('id, review_id, contract_version_id, version, trigger_event, trigger_ask_id, report_data, report_file_url, is_current, created_at')
        .eq('contract_id', id)
        .eq('review_id', selectedReview.id)
        .eq('contract_version_id', reviewedVersion.id)
        .eq('binding_state', 'bound')
        .order('version', { ascending: false })
        .limit(5)
    const annotationsRequest = selectedReview && reviewedVersion
      ? supabaseAdmin
        .from('contract_annotations')
        .select('id, contract_id, review_id, contract_version_id, start_offset, end_offset, selected_text, comment, category, priority, status, author_id, created_at')
        .eq('contract_id', id)
        .eq('review_id', selectedReview.id)
        .eq('contract_version_id', reviewedVersion.id)
        .eq('binding_state', 'bound')
        .order('created_at', { ascending: true })
      : emptyRows<AnnotationRow>()
    const jobsRequest = selectedReview
      ? supabaseAdmin
        .from('contract_analysis_jobs')
        .select('*')
        .eq('contract_id', id)
        .eq('review_id', selectedReview.id)
        .order('created_at', { ascending: false })
      : emptyRows<ContractAnalysisJobRow>()
    const asksRequest = selectedReview && reviewedVersion
      ? supabaseAdmin
        .from('ask_items')
        .select(`
          id,
          ask_code,
          risk_name,
          initial_level,
          question_type,
          required_roles,
          question_text,
          qualified_std,
          status,
          closed_reason,
          ask_responses!ask_responses_ask_id_fkey (
            id,
            responder_id,
            responder_role,
            responder_name,
            response_text,
            created_at
          )
        `)
        .eq('contract_id', id)
        .eq('review_id', selectedReview.id)
        .eq('contract_version_id', reviewedVersion.id)
        .eq('binding_state', 'bound')
        .order('created_at', { ascending: true })
      : emptyRows<AskTaskRow>()

    const [
      annotationsResult,
      jobsResult,
      asksResult,
      reportVersionsResult,
    ] = await Promise.all([
      annotationsRequest,
      jobsRequest,
      asksRequest,
      reportVersionsRequest,
    ])

    if (annotationsResult.error) {
      return errorResponse(createApiError('DB_ERROR', '获取合同批注失败'))
    }

    if (jobsResult.error) {
      return errorResponse(createApiError('DB_ERROR', '获取审核任务失败'))
    }

    if (asksResult.error) {
      return errorResponse(createApiError('DB_ERROR', '获取谈判任务失败'))
    }

    if (reportVersionsResult.error) {
      return errorResponse(createApiError('DB_ERROR', '获取报告版本失败'))
    }

    const annotations = (annotationsResult.data || []) as AnnotationRow[]
    const jobs = (jobsResult.data || []) as ContractAnalysisJobRow[]
    const asks = ((asksResult.data || []) as AskTaskRow[])
      .filter((ask) => canAccessAskByRoles(ask.required_roles, assignments, orgId))
    const reportVersions = (reportVersionsResult.data || []) as ReportVersionRow[]
    const latestJob = jobs[0] || null

    let runtimePlanSnapshot: ReviewEvidenceRuntimePlanSnapshot = null
    if (selectedReview?.plan_snapshot_id) {
      const { data, error } = await supabaseAdmin
        .from('ai_runtime_plan_snapshots')
        .select('id, org_id, business_use_point_id, application_id, route_policy_id, snapshot, snapshot_sha256, created_at')
        .eq('id', selectedReview.plan_snapshot_id)
        .eq('org_id', orgId)
        .maybeSingle()

      if (error) {
        return errorResponse(createApiError('DB_ERROR', '获取 AI 运行计划快照失败'))
      }
      runtimePlanSnapshot = data as ReviewEvidenceRuntimePlanSnapshot
    }

    let reviewRun = buildReviewRunEvidence({
      latestReview: selectedReview,
      latestJob,
      currentVersion: reviewedVersion,
      risks: orderedRiskCards,
      snapshots: [],
      skillBundle: null,
      runtimePlanSnapshot,
      modelPolicy: null,
      modelInvocations: [],
      modelInvocationsLoaded: false,
    })

    if (!summaryOnly) {
      let skillBundle: ReviewEvidenceSkillBundle = null
      if (selectedReview?.skill_bundle_id) {
        const { data, error } = await supabaseAdmin
          .from('contract_skill_bundles')
          .select('id, version, rule_snapshot_ids, rule_set_snapshot_ids, template_snapshot_ids, document_snapshot_ids, model_policy_id, output_schema, eval_case_ids, release_meta, compiled_from, compiled_hash, status, published_at')
          .eq('id', selectedReview.skill_bundle_id)
          .eq('org_id', orgId)
          .maybeSingle()

        if (error) {
          return errorResponse(createApiError('DB_ERROR', '获取 SkillBundle 失败'))
        }
        skillBundle = data as ReviewEvidenceSkillBundle
      }

      // Historical evidence is resolved only from ids persisted by this ReviewRun.
      // Empty database arrays mean "not bound", so the immutable compiled bundle
      // is the only permitted fallback. Never scan today's rules or latest snapshots.
      const boundSnapshotIds = nonEmptyStrings(selectedReview?.rule_snapshot_ids)
        || nonEmptyStrings(skillBundle?.rule_snapshot_ids)
        || []
      const boundRuleSetSnapshotIds = nonEmptyStrings(selectedReview?.rule_set_snapshot_ids)
        || nonEmptyStrings(skillBundle?.rule_set_snapshot_ids)
        || []

      let snapshotRows: ReviewEvidenceSnapshot[] = []
      if (boundSnapshotIds.length > 0) {
        const { data, error } = await supabaseAdmin
          .from('contract_rule_snapshots')
          .select('id, rule_id, version, status, released_at, created_at, config_snapshot')
          .in('id', boundSnapshotIds)
          .eq('config_snapshot->>org_id', orgId)

        if (error) {
          return errorResponse(createApiError('DB_ERROR', '获取绑定规则快照失败'))
        }
        snapshotRows = (data || []) as ReviewEvidenceSnapshot[]
      }

      let ruleSetSnapshotRows: ReviewEvidenceRuleSetSnapshot[] = []
      if (boundRuleSetSnapshotIds.length > 0) {
        const { data, error } = await supabaseAdmin
          .from('contract_rule_set_snapshots')
          .select('id, org_id, rule_set_id, status, rule_snapshot_ids')
          .in('id', boundRuleSetSnapshotIds)

        if (error) {
          return errorResponse(createApiError('DB_ERROR', '获取绑定规则集快照失败'))
        }
        ruleSetSnapshotRows = (data || []) as ReviewEvidenceRuleSetSnapshot[]
      }

      let modelPolicy: ReviewEvidenceModelPolicy = null
      // WP02 ReviewRuns resolve from the immutable six-object plan. ModelPolicy
      // is queried only for historical runs which have no plan_snapshot_id.
      const modelPolicyId = selectedReview?.plan_snapshot_id
        ? null
        : selectedReview?.model_policy_id || skillBundle?.model_policy_id || null
      if (modelPolicyId) {
        const { data, error } = await supabaseAdmin
          .from('model_policies')
          .select('id, version, provider_chain, status, published_at')
          .eq('id', modelPolicyId)
          .maybeSingle()

        if (error) {
          return errorResponse(createApiError('DB_ERROR', '获取模型策略失败'))
        }
        modelPolicy = data as ReviewEvidenceModelPolicy
      }

      let modelInvocations: ReviewEvidenceModelInvocation[] = []
      const invocationSelection = 'id, plan_snapshot_id, business_use_point_id, application_id, route_policy_id, model_catalog_entry_id, provider_connection_id, attempt_no, provider, model, phase, status, degraded, fallback_reason, error_message, latency_ms, input_tokens, output_tokens, total_tokens, request_meta, response_meta, started_at, completed_at, created_at'

      if (selectedReview?.plan_snapshot_id && selectedReview.id) {
        const { data, error } = await supabaseAdmin
          .from('model_invocations')
          .select(invocationSelection)
          .eq('review_id', selectedReview.id)
          .eq('plan_snapshot_id', selectedReview.plan_snapshot_id)
          .eq('org_id', orgId)
          .order('attempt_no', { ascending: true })
          .order('created_at', { ascending: true })

        if (error) {
          return errorResponse(createApiError('DB_ERROR', '获取模型调用记录失败'))
        }
        modelInvocations = (data || []) as ReviewEvidenceModelInvocation[]
      } else if (selectedReview?.model_invocation_ids?.length) {
        const { data, error } = await supabaseAdmin
          .from('model_invocations')
          .select(invocationSelection)
          .in('id', selectedReview.model_invocation_ids)
          .eq('review_id', selectedReview.id)
          .eq('org_id', orgId)
          .order('created_at', { ascending: false })

        if (error) {
          return errorResponse(createApiError('DB_ERROR', '获取模型调用记录失败'))
        }
        modelInvocations = (data || []) as ReviewEvidenceModelInvocation[]
      } else if (selectedReview?.id) {
        const { data, error } = await supabaseAdmin
          .from('model_invocations')
          .select(invocationSelection)
          .eq('review_id', selectedReview.id)
          .eq('org_id', orgId)
          .order('created_at', { ascending: false })
          .limit(5)

        if (error) {
          return errorResponse(createApiError('DB_ERROR', '获取模型调用记录失败'))
        }
        modelInvocations = (data || []) as ReviewEvidenceModelInvocation[]
      }

      reviewRun = buildReviewRunEvidence({
        latestReview: selectedReview,
        latestJob,
        currentVersion: reviewedVersion,
        risks: orderedRiskCards,
        snapshots: snapshotRows,
        ruleSetSnapshots: ruleSetSnapshotRows,
        expectedOrgId: orgId,
        skillBundle,
        runtimePlanSnapshot,
        modelPolicy,
        modelInvocations,
        modelInvocationsLoaded: true,
      })
    }

    const riskFindings = orderedRiskCards.map((card) => ({
      id: card.id,
      rule_id: card.rule_id || null,
      rule_code: card.rule_code || null,
      rule_version: card.rule_version || null,
      severity: card.level,
      title: card.title,
      description: card.description || '',
      suggestion: card.suggestion || '',
      evidence: card.evidence || { snippets: [] },
      fix_action: card.fix_action || null,
      status: card.status,
      clause_ref: card.clause_ref || null,
      position: {
        start: card.position_start ?? null,
        end: card.position_end ?? null,
      },
    }))

    const negotiationTasks = buildNegotiationTasks({
      risks: orderedRiskCards,
      asks,
    })

    // 3. 统计信息
    const stats = {
      total: orderedRiskCards.length,
      red: orderedRiskCards.filter((c: { level: string }) => c.level === 'red').length,
      yellow: orderedRiskCards.filter((c: { level: string }) => c.level === 'yellow').length,
      green: orderedRiskCards.filter((c: { level: string }) => c.level === 'green').length,
      open: orderedRiskCards.filter((c: { status: string }) => c.status === 'open').length,
    }
    const reviewHistory = reviews.map((review) => {
      const sourceVersion = resolveReviewRunSourceVersion(review, sourceVersions)
      return {
        id: review.id,
        status: review.status || 'PENDING',
        contract_version_id: review.contract_version_id || null,
        source_storage_path: review.source_storage_path || null,
        source_hash: review.source_hash || null,
        source_text_hash: review.source_text_hash || null,
        source_version_number: sourceVersion?.version_number || null,
        source_identity_verified: Boolean(sourceVersion),
        is_current: currentReview?.id === review.id,
        created_at: review.created_at || null,
        completed_at: review.completed_at || null,
      }
    })

    return successResponse({
      ...contract,
      file_url: contractFileAccessUrl(id, typeof contract.storage_path === 'string' ? contract.storage_path : null),
      riskCards: orderedRiskCards,
      stats,
      latestReview: selectedReview,
      latestJob,
      versions,
      currentVersion,
      source_identity: sourceIdentity,
      reviewedVersion,
      current_review_status: currentReview?.status || 'PENDING',
      has_current_review: Boolean(currentReview),
      review_context: reviewContext,
      review_history: reviewHistory,
      reviewRun,
      riskFindings,
      negotiationTasks,
      annotations,
      outputs: outputVersions,
      currentReport: reportVersions[0] || null,
      reportVersions,
      payload_scope: summaryOnly ? 'summary' : 'full',
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
    const parsed = reviewConclusionSchema.safeParse(body)
    if (!parsed.success) {
      return errorResponse(
        createApiError('VALIDATION_ERROR', '审核结论参数不正确', {
          fieldErrors: parsed.error.flatten().fieldErrors,
        })
      )
    }

    const { conclusion, conclusion_reason } = parsed.data

    // 2. 检查合同是否存在
    const {
      assignments,
      userIds: accessibleUserIds,
    } = await listFreshAccessibleUserIds(user.id, orgId)
    if (!canAccessContractAction(assignments, orgId, 'review')) {
      return errorResponse(createApiError('FORBIDDEN', '没有更新合同审核结论的权限'))
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('contracts')
      .select('id, status, conclusion')
      .eq('id', id)
      .eq('org_id', orgId)
      .in('created_by', accessibleUserIds)
      .maybeSingle()

    if (existingError) {
      return errorResponse(createApiError('DB_ERROR', '查询合同失败'))
    }

    if (!existing) {
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
      .in('created_by', accessibleUserIds)
      .select()
      .single()

    if (updateError) {
      return errorResponse(createApiError('DB_ERROR', '更新审核结论失败'))
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
