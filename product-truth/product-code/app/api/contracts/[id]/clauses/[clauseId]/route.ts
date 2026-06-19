// PATCH /api/contracts/:id/clauses/:clauseId
// 更新条款审核状态

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function PATCH(req: NextRequest, { params }: AsyncRouteParams) {
  try {
    const contractId = await resolveIdParam(params)
    // clauseId 从路径中提取
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const clauseId = pathParts[pathParts.length - 1]

    if (!contractId || !clauseId) {
      return errorResponse('合同ID和条款ID必填', 400, 'MISSING_ID')
    }

    const body = await req.json()
    const { review_status, review_notes } = body

    const validStatuses = ['passed', 'attention', 'must_fix', 'skipped', 'pending']
    if (!validStatuses.includes(review_status)) {
      return errorResponse('无效的审核状态', 400, 'INVALID_STATUS')
    }

    const { data: clause, error } = await supabaseAdmin
      .from('contract_clauses')
      .update({
        review_status,
        review_notes: review_notes || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', clauseId)
      .eq('contract_id', contractId)
      .select()
      .single()

    if (error) return errorResponse('更新失败', 500, 'DB_ERROR')
    if (!clause) return errorResponse('条款不存在', 404, 'NOT_FOUND')

    return NextResponse.json({ success: true, data: clause })
  } catch (_error) {
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
