// REQ:F005 - 合同条款列表 API
// PURPOSE: 返回审核时提取的合同条款（按 risk_level 排序）

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

// GET /api/contracts/:id/clauses - 获取该合同最新审核版本的条款
export async function GET(req: NextRequest, { params }: AsyncRouteParams) {
  try {
    const contractId = await resolveIdParam(params)

    if (!contractId) return errorResponse('合同ID必填', 400, 'MISSING_ID')

    // 找到该合同最新的 review
    const { data: latestReview } = await supabaseAdmin
      .from('contract_reviews')
      .select('id, created_at')
      .eq('contract_id', contractId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!latestReview) {
      return NextResponse.json({ success: true, data: { clauses: [] } })
    }

    const { data: clauses, error } = await supabaseAdmin
      .from('contract_clauses')
      .select('id, clause_number, clause_title, clause_text, risk_level, risk_category, risk_description, legal_basis, suggestion, suggested_text, matched_library_clause_id, position, start_offset, end_offset')
      .eq('review_id', latestReview.id)
      .order('position', { ascending: true })

    if (error) return errorResponse('查询失败', 500, 'DB_ERROR')

    return NextResponse.json({ success: true, data: { clauses: clauses || [] } })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return errorResponse('未登录', 401, 'UNAUTHORIZED')
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
