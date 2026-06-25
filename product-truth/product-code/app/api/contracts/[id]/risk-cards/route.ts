// GET /api/contracts/:id/risk-cards
// PATCH /api/contracts/:id/risk-cards/:cardId
// POST /api/contracts/:id/risk-cards/:cardId/fix

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

// GET - 风险卡片列表
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params
    const { contract } = await getAccessibleContract(id, user.id, orgId, 'id')

    if (!contract) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在'))
    }

    const { data: riskCards, error } = await supabaseAdmin
      .from('contract_risk_cards')
      .select('*')
      .eq('contract_id', id)
      .order('level', { ascending: false })
      .order('created_at', { ascending: true })

    if (error) {
      return errorResponse(createApiError('DB_ERROR', '获取风险卡片失败'))
    }

    return successResponse(riskCards || [])
  })
}
