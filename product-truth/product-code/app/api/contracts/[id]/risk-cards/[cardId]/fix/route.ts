// POST /api/contracts/:id/risk-cards/:cardId/fix
// 一键修复风险卡片

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  errorResponse,
  successResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { getAccessibleContract } from '@/lib/scoped-access'

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function feedbackStatusValue(value: unknown) {
  const text = textValue(value)
  return ['accepted', 'rejected', 'special_approval', 'needs_customer_confirmation'].includes(text)
    ? text
    : ''
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; cardId: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id: contractId, cardId } = await params
    const body = await req.json().catch(() => ({}))
    const { contract } = await getAccessibleContract(contractId, user.id, orgId, 'id')

    if (!contract) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在'))
    }

    // 1. 获取风险卡片
    const { data: riskCard, error: fetchError } = await supabaseAdmin
      .from('contract_risk_cards')
      .select('*')
      .eq('id', cardId)
      .eq('contract_id', contractId)
      .single()

    if (fetchError || !riskCard) {
      return errorResponse(createApiError('NOT_FOUND', '风险卡片不存在'))
    }

    const action = textValue((body as { action?: unknown }).action) || 'auto_fix'
    const note = textValue((body as { note?: unknown }).note)
    const proposedValue = textValue((body as { proposed_value?: unknown }).proposed_value)
    const feedbackStatus = feedbackStatusValue((body as { feedback_status?: unknown }).feedback_status)
    const isControlNote = action === 'control_note' || Boolean(note || proposedValue)
    const now = new Date().toISOString()

    if (isControlNote) {
      if (!note && !proposedValue && !feedbackStatus) {
        return errorResponse(createApiError('VALIDATION_ERROR', '请补充风险可控化说明、建议数值或客户反馈状态'))
      }
      if (note.length > 1200 || proposedValue.length > 300) {
        return errorResponse(createApiError('VALIDATION_ERROR', '风险可控化说明过长'))
      }

      const fixAction = {
        ...objectValue(riskCard.fix_action),
        control_note: note || null,
        proposed_value: proposedValue || null,
        control_status: 'needs_customer_confirmation',
        customer_feedback_status: feedbackStatus || 'needs_customer_confirmation',
        control_source: 'manual_review_note',
        controlled_by: user.id,
        controlled_at: now,
      }

      const { error: updateError } = await supabaseAdmin
        .from('contract_risk_cards')
        .update({
          fix_action: fixAction,
          updated_at: now,
        })
        .eq('id', cardId)

      if (updateError) {
        return errorResponse(createApiError('DB_ERROR', '保存风险可控说明失败'))
      }

      await supabaseAdmin
        .from('contract_risk_card_fixes')
        .insert({
          risk_card_id: cardId,
          contract_id: contractId,
          fixed_by: user.id,
          fix_action: {
            type: 'control_note',
            note: note || null,
            proposed_value: proposedValue || null,
            status: feedbackStatus || 'needs_customer_confirmation',
            risk_status_preserved: riskCard.status,
          },
          created_at: now,
        })

      return successResponse({
        message: '已保存风险可控化说明',
        riskCard: {
          id: riskCard.id,
          status: riskCard.status,
          fix_action: fixAction,
        },
      })
    }

    // 2. 检查是否支持自动修复
    if (!riskCard.auto_fixable) {
      return errorResponse(createApiError('VALIDATION_ERROR', '该风险不支持自动修复'))
    }

    // 3. 执行修复（目前是标记状态，后续可接入 AI 自动修改合同文本）
    const { error: updateError } = await supabaseAdmin
      .from('contract_risk_cards')
      .update({
        status: 'fixed',
        fixed_by: user.id,
        fixed_at: now,
        updated_at: now,
      })
      .eq('id', cardId)

    if (updateError) {
      return errorResponse(createApiError('DB_ERROR', '修复失败'))
    }

    // 4. 记录修复历史
    await supabaseAdmin
      .from('contract_risk_card_fixes')
      .insert({
        risk_card_id: cardId,
        contract_id: contractId,
        fixed_by: user.id,
        fix_action: riskCard.fix_action || {},
        created_at: now,
      })

    return successResponse({
      message: '修复成功',
      riskCard: {
        id: riskCard.id,
        status: 'fixed',
        fixed_at: now,
      },
    })
  })
}
