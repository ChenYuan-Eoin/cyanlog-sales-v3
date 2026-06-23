// REQ:F005 - 条款库单条操作
// PURPOSE: 修改/删除单条条款

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

// PATCH /api/admin/clause-library/:id - 修改条款
export async function PATCH(req: NextRequest, { params }: AsyncRouteParams) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const id = await resolveIdParam(params)

    if (!id) return errorResponse('条款ID必填', 400, 'MISSING_ID')

    const body = (await req.json().catch(() => ({}))) as {
      name?: string
      category?: string
      stance?: string
      template_text?: string
      legal_basis?: string
      description?: string
      tags?: string[]
      contract_types?: string[]
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.name !== undefined) update.name = body.name
    if (body.category !== undefined) update.category = body.category
    if (body.stance !== undefined) update.stance = body.stance
    if (body.template_text !== undefined) update.template_text = body.template_text
    if (body.legal_basis !== undefined) update.legal_basis = body.legal_basis
    if (body.description !== undefined) update.description = body.description
    if (body.tags !== undefined) update.tags = body.tags
    if (body.contract_types !== undefined) update.contract_types = body.contract_types

    // 不允许修改系统内置条款
    const { data: existing } = await supabaseAdmin
      .from('clause_library')
      .select('is_system, org_id')
      .eq('id', id)
      .single()

    if (!existing) return errorResponse('条款不存在', 404, 'NOT_FOUND')
    if (existing.is_system) return errorResponse('系统内置条款不可修改', 403, 'SYSTEM_PROTECTED')
    if (existing.org_id !== orgId) return errorResponse('无权修改', 403, 'NO_PERMISSION')

    const { data, error } = await supabaseAdmin
      .from('clause_library')
      .update(update)
      .eq('id', id)
      .select()
      .single()

    if (error) return errorResponse('更新失败', 500, 'DB_ERROR')
    return NextResponse.json({ success: true, data })
  } catch {
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

// DELETE /api/admin/clause-library/:id
export async function DELETE(req: NextRequest, { params }: AsyncRouteParams) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const id = await resolveIdParam(params)

    if (!id) return errorResponse('条款ID必填', 400, 'MISSING_ID')

    const { data: existing } = await supabaseAdmin
      .from('clause_library')
      .select('is_system, org_id')
      .eq('id', id)
      .single()

    if (!existing) return errorResponse('条款不存在', 404, 'NOT_FOUND')
    if (existing.is_system) return errorResponse('系统内置条款不可删除', 403, 'SYSTEM_PROTECTED')
    if (existing.org_id !== orgId) return errorResponse('无权删除', 403, 'NO_PERMISSION')

    const { error } = await supabaseAdmin
      .from('clause_library')
      .delete()
      .eq('id', id)

    if (error) return errorResponse('删除失败', 500, 'DB_ERROR')
    return NextResponse.json({ success: true })
  } catch {
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
