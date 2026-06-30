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

type ContractReviewRow = {
  id: string
  status?: string | null
  results?: unknown
  rule_version?: number | null
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

// GET - 获取审核结果
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params

    // 1. 获取合同基本信息（包含结论字段）
    const { contract } = await getAccessibleContract<{
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

    // 2. 获取风险卡片
    const { data: riskCards, error: riskError } = await supabaseAdmin
      .from('contract_risk_cards')
      .select('*')
      .eq('contract_id', id)
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

    const versions = (versionsResult.data || []) as ContractVersionRow[]
    const annotations = (annotationsResult.data || []) as AnnotationRow[]
    const jobs = jobsResult.data || []
    const latestReview = (contract.contract_reviews?.[0] || null) as ContractReviewRow | null
    const outputVersions = versions.filter((version) => version.source === 'review_revision')
    const sourceVersions = versions.filter((version) => version.source !== 'review_revision')
    const currentVersion = sourceVersions[0] || versions[0] || null
    const latestJob = jobs[0] || null

    const reviewRun = latestReview ? {
      id: latestReview.id,
      status: latestReview.status || 'PENDING',
      contract_version_id: currentVersion?.id || null,
      skill_bundle_id: `contract-rules:${latestReview.rule_version ?? 'published'}`,
      rule_snapshot_id: latestReview.rule_version
        ? `contract_rules_v2:v${latestReview.rule_version}`
        : 'contract_rules_v2:published',
      model_policy_id: latestJob?.provider || 'rule-engine',
      started_at: latestJob?.started_at || latestReview.created_at || null,
      completed_at: latestJob?.completed_at || latestReview.completed_at || null,
    } : null

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

    const negotiationTasks = orderedRiskCards
      .filter((card) => (card.level === 'red' || card.level === 'yellow') && card.status === 'open')
      .map((card) => ({
        id: `negotiation-${card.id}`,
        risk_id: card.id,
        required: card.level === 'red',
        owner_role: 'sales',
        status: 'pending',
        title: card.level === 'red' ? '必须谈判' : '建议谈判',
        objective: card.suggestion || card.description || card.title,
      }))

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
