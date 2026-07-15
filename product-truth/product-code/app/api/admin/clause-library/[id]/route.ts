// REQ:F005 - 条款库单条操作
// PURPOSE: 修改/删除单条条款

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { userHasFreshOrgConfigAccess } from '@/lib/configs/access'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'

const clauseStanceSchema = z.enum(['required', 'recommended', 'optional', 'risky', 'dangerous'])

const clauseUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  stance: clauseStanceSchema.optional(),
  template_text: z.string().trim().min(1).optional(),
  legal_basis: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  contract_types: z.array(z.string()).optional(),
})

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

// PATCH /api/admin/clause-library/:id - 修改条款
export async function PATCH(req: NextRequest, { params }: AsyncRouteParams) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const canWrite = await userHasFreshOrgConfigAccess(user.id, orgId, 'write')

    if (!canWrite) {
      return errorResponse('无权管理合同审核资产', 403, 'NO_PERMISSION')
    }

    const id = await resolveIdParam(params)

    if (!id) return errorResponse('条款ID必填', 400, 'MISSING_ID')

    const parsed = clauseUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors
      if (fields.stance) {
        return errorResponse('立场值不合法', 400, 'INVALID_STANCE')
      }
      return errorResponse('请求参数无效', 400, 'INVALID_FIELDS')
    }
    const body = parsed.data

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
      .eq('org_id', orgId)
      .eq('is_system', false)
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
    const canWrite = await userHasFreshOrgConfigAccess(user.id, orgId, 'write')

    if (!canWrite) {
      return errorResponse('无权管理合同审核资产', 403, 'NO_PERMISSION')
    }

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
      .eq('org_id', orgId)
      .eq('is_system', false)

    if (error) return errorResponse('删除失败', 500, 'DB_ERROR')
    return NextResponse.json({ success: true })
  } catch {
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
