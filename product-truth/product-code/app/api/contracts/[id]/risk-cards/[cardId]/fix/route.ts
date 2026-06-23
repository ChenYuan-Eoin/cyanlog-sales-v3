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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; cardId: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, _orgId: string) => {
    const { id: contractId, cardId } = await params

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
        fixed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
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
        created_at: new Date().toISOString(),
      })

    return successResponse({
      message: '修复成功',
      riskCard: {
        id: riskCard.id,
        status: 'fixed',
        fixed_at: new Date().toISOString(),
      },
    })
  })
}
