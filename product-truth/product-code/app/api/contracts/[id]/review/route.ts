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
    const orderedRiskCards = [...(riskCards || [])].sort((left: { level: string; created_at?: string }, right: { level: string; created_at?: string }) => (
      (riskOrder[left.level] ?? 9) - (riskOrder[right.level] ?? 9)
      || new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime()
    ))

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
      latestReview: contract.contract_reviews?.[0] || null,
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
