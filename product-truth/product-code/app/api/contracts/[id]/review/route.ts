// GET /api/contracts/:id/review
// 获取合同审核结果（风险卡片 + AI 摘要 + 合规检查）

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  errorResponse,
  successResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (_user: AuthUser, _orgId: string) => {
    const { id } = await params

    // 1. 获取合同基本信息
    const { data: contract, error: contractError } = await supabaseAdmin
      .from('contracts')
      .select('*, contract_reviews(*)')
      .eq('id', id)
      .single()

    if (contractError || !contract) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在'))
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

    // 3. 统计信息
    const stats = {
      total: riskCards?.length || 0,
      red: riskCards?.filter((c: { level: string }) => c.level === 'red').length || 0,
      yellow: riskCards?.filter((c: { level: string }) => c.level === 'yellow').length || 0,
      green: riskCards?.filter((c: { level: string }) => c.level === 'green').length || 0,
      open: riskCards?.filter((c: { status: string }) => c.status === 'open').length || 0,
    }

    return successResponse({
      contract,
      riskCards: riskCards || [],
      stats,
      latestReview: contract.contract_reviews?.[0] || null,
    })
  })
}
