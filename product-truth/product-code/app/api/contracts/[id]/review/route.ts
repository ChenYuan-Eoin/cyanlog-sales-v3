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
import { getAccessibleContract } from '@/lib/scoped-access'
import {
  buildReviewRunEvidence,
  type ReviewEvidenceModelInvocation,
  type ReviewEvidenceModelPolicy,
  type ReviewEvidenceRule,
  type ReviewEvidenceSkillBundle,
  type ReviewEvidenceSnapshot,
} from '@/lib/contracts/review-evidence'
import { buildNegotiationTasks } from '@/lib/contracts/negotiation-task'
import { canAccessAskByRoles } from '@/lib/ask/permissions'

type ContractReviewRow = {
  id: string
  status?: string | null
  results?: unknown
  rule_version?: number | null
  skill_bundle_id?: string | null
  model_policy_id?: string | null
  rule_snapshot_ids?: string[] | null
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
  parent_version_id: string | null
  change_summary: string | null
  review_id: string | null
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
  status: string
  clause_ref?: string | null
  position_start?: number | null
  position_end?: number | null
  created_at?: string | null
}

type ContractAnalysisJobRow = {
  id?: string
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

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => (
    typeof value === 'string' && value.trim().length > 0
  ))))
}

// GET - 获取审核结果
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params

    // 1. 获取合同基本信息（包含结论字段）
    const { contract, assignments } = await getAccessibleContract<{
      id: string
      contract_reviews?: Array<{ created_at?: string }>
      [key: string]: unknown
    }>(id, user.id, orgId, '*, contract_reviews(*)')

    if (!contract) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在'))
    }

    if (Array.isArray(contract.contract_reviews)) {
      contract.contract_reviews = contract.contract_reviews.sort((left, right) =>
        new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime()
      )
    }
    const latestReview = (contract.contract_reviews?.[0] || null) as ContractReviewRow | null

    // 2. 获取风险卡片
    let riskCardsQuery = supabaseAdmin
      .from('contract_risk_cards')
      .select('*')
      .eq('contract_id', id)

    if (latestReview?.id) {
      riskCardsQuery = riskCardsQuery.eq('review_id', latestReview.id)
    }

    const { data: riskCards, error: riskError } = await riskCardsQuery
      .order('level', { ascending: false })
      .order('created_at', { ascending: true })

    if (riskError) {
      return errorResponse(createApiError('DB_ERROR', '获取风险卡片失败'))
    }

    const riskOrder: Record<string, number> = { red: 0, yellow: 1, green: 2, white: 3 }
    const orderedRiskCards = ([...(riskCards || [])] as RiskCardRow[]).sort((left, right) => (
      (riskOrder[left.level] ?? 9) - (riskOrder[right.level] ?? 9)
      || new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime()
    ))

    const [
      versionsResult,
      annotationsResult,
      jobsResult,
      asksResult,
      reportVersionsResult,
    ] = await Promise.all([
      supabaseAdmin
        .from('contract_versions')
        .select('id, contract_id, version_number, source, storage_path, file_size, mime_type, parent_version_id, change_summary, review_id, created_at')
        .eq('contract_id', id)
        .order('version_number', { ascending: false }),
      supabaseAdmin
        .from('contract_annotations')
        .select('id, contract_id, start_offset, end_offset, selected_text, comment, category, priority, status, author_id, created_at')
        .eq('contract_id', id)
        .order('created_at', { ascending: true }),
      supabaseAdmin
        .from('contract_analysis_jobs')
        .select('*')
        .eq('contract_id', id)
        .order('created_at', { ascending: false }),
      supabaseAdmin
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
        .order('created_at', { ascending: true }),
      supabaseAdmin
        .from('report_versions')
        .select('id, version, trigger_event, trigger_ask_id, report_data, report_file_url, is_current, created_at')
        .eq('contract_id', id)
        .order('version', { ascending: false })
        .limit(5),
    ])

    if (versionsResult.error) {
      return errorResponse(createApiError('DB_ERROR', '获取合同版本失败'))
    }

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

    const versions = (versionsResult.data || []) as ContractVersionRow[]
    const annotations = (annotationsResult.data || []) as AnnotationRow[]
    const jobs = (jobsResult.data || []) as ContractAnalysisJobRow[]
    const asks = ((asksResult.data || []) as AskTaskRow[])
      .filter((ask) => canAccessAskByRoles(ask.required_roles, assignments))
    const reportVersions = (reportVersionsResult.data || []) as ReportVersionRow[]
    const outputVersions = versions.filter((version) => version.source === 'review_revision')
    const sourceVersions = versions.filter((version) => version.source !== 'review_revision')
    const currentVersion = sourceVersions[0] || versions[0] || null
    const latestJob = jobs[0] || null

    const riskRuleIds = uniqueStrings(orderedRiskCards.map((card) => card.rule_id))
    const riskRuleCodes = uniqueStrings(orderedRiskCards.map((card) => card.rule_code))

    const ruleQueries: Array<PromiseLike<{
      data: ReviewEvidenceRule[] | null
      error: { message?: string } | null
    }>> = []

    if (riskRuleIds.length > 0) {
      ruleQueries.push(
        supabaseAdmin
          .from('contract_rules_v2')
          .select('id, code, version, is_active, engine_type, target_field, clause_category, published_at, updated_at')
          .eq('org_id', orgId)
          .in('id', riskRuleIds)
      )
    }

    if (riskRuleCodes.length > 0) {
      ruleQueries.push(
        supabaseAdmin
          .from('contract_rules_v2')
          .select('id, code, version, is_active, engine_type, target_field, clause_category, published_at, updated_at')
          .eq('org_id', orgId)
          .in('code', riskRuleCodes)
      )
    }

    if (ruleQueries.length === 0 && latestReview) {
      ruleQueries.push(
        supabaseAdmin
          .from('contract_rules_v2')
          .select('id, code, version, is_active, engine_type, target_field, clause_category, published_at, updated_at')
          .eq('org_id', orgId)
          .eq('is_active', true)
          .order('code', { ascending: true })
      )
    }

    const ruleResults = await Promise.all(ruleQueries)
    const ruleError = ruleResults.find((result) => result.error)?.error
    if (ruleError) {
      return errorResponse(createApiError('DB_ERROR', '获取规则快照规则失败'))
    }

    const ruleRows = Array.from(
      new Map(
        ruleResults
          .flatMap((result) => result.data || [])
          .map((rule) => [rule.id, rule] as const)
      ).values()
    )

    let snapshotRows: ReviewEvidenceSnapshot[] = []
    if (ruleRows.length > 0) {
      const { data: snapshots, error: snapshotError } = await supabaseAdmin
        .from('contract_rule_snapshots')
        .select('id, rule_id, version, status, released_at, created_at, config_snapshot')
        .in('rule_id', ruleRows.map((rule) => rule.id))
        .eq('status', 'published')
        .order('released_at', { ascending: false })

      if (snapshotError) {
        return errorResponse(createApiError('DB_ERROR', '获取规则快照失败'))
      }

      snapshotRows = (snapshots || []) as ReviewEvidenceSnapshot[]
    }

    const boundSnapshotIds = latestReview?.rule_snapshot_ids || []
    if (boundSnapshotIds.length > 0) {
      const { data: boundSnapshots, error: boundSnapshotError } = await supabaseAdmin
        .from('contract_rule_snapshots')
        .select('id, rule_id, version, status, released_at, created_at, config_snapshot')
        .in('id', boundSnapshotIds)

      if (boundSnapshotError) {
        return errorResponse(createApiError('DB_ERROR', '获取绑定规则快照失败'))
      }

      snapshotRows = Array.from(
        new Map(
          [...snapshotRows, ...((boundSnapshots || []) as ReviewEvidenceSnapshot[])]
            .map((snapshot) => [snapshot.id, snapshot] as const)
        ).values()
      )
    }

    let skillBundle: ReviewEvidenceSkillBundle = null
    if (latestReview?.skill_bundle_id) {
      const { data, error } = await supabaseAdmin
        .from('contract_skill_bundles')
        .select('id, version, rule_snapshot_ids, template_snapshot_ids, model_policy_id, output_schema, eval_case_ids, release_meta, compiled_from, compiled_hash, status, published_at')
        .eq('id', latestReview.skill_bundle_id)
        .maybeSingle()

      if (error) {
        return errorResponse(createApiError('DB_ERROR', '获取 SkillBundle 失败'))
      }
      skillBundle = data as ReviewEvidenceSkillBundle
    }

    let modelPolicy: ReviewEvidenceModelPolicy = null
    const modelPolicyId = latestReview?.model_policy_id || skillBundle?.model_policy_id || null
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
    if (latestReview?.model_invocation_ids?.length) {
      const { data, error } = await supabaseAdmin
        .from('model_invocations')
        .select('id, provider, model, phase, status, degraded, fallback_reason, error_message, created_at')
        .in('id', latestReview.model_invocation_ids)
        .order('created_at', { ascending: false })

      if (error) {
        return errorResponse(createApiError('DB_ERROR', '获取模型调用记录失败'))
      }
      modelInvocations = (data || []) as ReviewEvidenceModelInvocation[]
    } else if (latestReview?.id) {
      const { data, error } = await supabaseAdmin
        .from('model_invocations')
        .select('id, provider, model, phase, status, degraded, fallback_reason, error_message, created_at')
        .eq('review_id', latestReview.id)
        .order('created_at', { ascending: false })
        .limit(5)

      if (error) {
        return errorResponse(createApiError('DB_ERROR', '获取模型调用记录失败'))
      }
      modelInvocations = (data || []) as ReviewEvidenceModelInvocation[]
    }

    const reviewRun = buildReviewRunEvidence({
      latestReview,
      latestJob,
      currentVersion,
      risks: orderedRiskCards,
      rules: ruleRows,
      snapshots: snapshotRows,
      skillBundle,
      modelPolicy,
      modelInvocations,
    })

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

    return successResponse({
      ...contract,
      riskCards: orderedRiskCards,
      stats,
      latestReview,
      latestJob,
      versions,
      currentVersion,
      reviewRun,
      riskFindings,
      negotiationTasks,
      annotations,
      outputs: outputVersions,
      currentReport: reportVersions[0] || null,
      reportVersions,
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
      contract: existing,
      userIds: accessibleUserIds,
    } = await getAccessibleContract<{
      id: string
      status: string | null
      conclusion: string | null
    }>(id, user.id, orgId, 'id, status, conclusion')

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
