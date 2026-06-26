// REQ: F003 自主可控 + RBAC
// PURPOSE: 角色管理 API - 编辑角色权限
// 权限要求: config:write

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { z } from 'zod'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'
import { hasPermission } from '@/lib/permissions'

function canWriteRoles(userPerms: string[]) {
  return hasPermission(userPerms, 'config:write')
    || hasPermission(userPerms, 'admin:access')
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  permissions: z.array(z.string()).optional(),
  sort_order: z.number().int().optional(),
})

// PATCH /api/roles/[id] - 修改角色（需 config:write 权限）
export async function PATCH(
  req: NextRequest,
  { params }: AsyncRouteParams
) {
  const userPerms = (req.headers.get('x-user-permissions') ?? '').split(',').filter(Boolean)
  if (!canWriteRoles(userPerms)) {
    return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
  }

  const id = await resolveIdParam(params)

  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_BODY', details: parsed.error.issues[0]?.message },
      { status: 400 }
    )
  }

  const { data, error } = await supabaseAdmin
    .from('roles')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Update role error:', error)
    return NextResponse.json({ error: '更新失败' }, { status: 500 })
  }

  return NextResponse.json({ success: true, data })
}
