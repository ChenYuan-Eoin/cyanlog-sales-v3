// PATCH /api/contracts/:id/clauses/:clauseId
// 更新条款审核状态

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getAccessibleContract } from '@/lib/scoped-access'
import { resolveRouteParams, type AsyncRouteParams } from '@/lib/route-params'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export async function PATCH(
  req: NextRequest,
  { params }: AsyncRouteParams<{ id: string; clauseId: string }>
) {
  try {
    const user = await requireAuth(req)
    const { id: contractId, clauseId } = await resolveRouteParams(params)

    if (!contractId || !clauseId) {
      return errorResponse('合同ID和条款ID必填', 400, 'MISSING_ID')
    }

    const body = await req.json().catch(() => null)
    if (!isJsonObject(body)) {
      return errorResponse('请求格式不是有效的JSON', 400, 'INVALID_JSON')
    }

    const reviewStatus = typeof body.review_status === 'string' ? body.review_status : ''
    const validStatuses = ['passed', 'attention', 'must_fix', 'skipped', 'pending']
    if (!validStatuses.includes(reviewStatus)) {
      return errorResponse('无效的审核状态', 400, 'INVALID_STATUS')
    }

    const reviewNotes = typeof body.review_notes === 'string' ? body.review_notes : null

    const { contract } = await getAccessibleContract(contractId, user.id, undefined, 'id')
    if (!contract) return errorResponse('合同不存在', 404, 'NOT_FOUND')

    const { data: clause, error } = await supabaseAdmin
      .from('contract_clauses')
      .update({
        review_status: reviewStatus,
        review_notes: reviewNotes || null,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', clauseId)
      .eq('contract_id', contractId)
      .select()
      .single()

    if (error) return errorResponse('更新失败', 500, 'DB_ERROR')
    if (!clause) return errorResponse('条款不存在', 404, 'NOT_FOUND')

    return NextResponse.json({ success: true, data: clause })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return errorResponse('未登录', 401, 'UNAUTHORIZED')
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
