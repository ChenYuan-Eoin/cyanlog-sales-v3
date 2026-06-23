// REQ: F003 自主可控 + RBAC
// PURPOSE: 角色管理 API - 列出与编辑角色权限
// 权限要求: config:read (可读) / config:write (可改)

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { z } from 'zod'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'
import { hasPermission } from '@/lib/permissions'

function canReadRoles(userPerms: string[]) {
  return hasPermission(userPerms, 'config:read')
    || hasPermission(userPerms, 'admin:access')
}

function canWriteRoles(userPerms: string[]) {
  return hasPermission(userPerms, 'config:write')
    || hasPermission(userPerms, 'admin:access')
}

// GET /api/roles - 列出所有角色（分页）
export async function GET(req: NextRequest) {
  const userPerms = (req.headers.get('x-user-permissions') ?? '').split(',').filter(Boolean)
  if (!canReadRoles(userPerms)) {
    return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  // 分页参数
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100)
  const offset = parseInt(searchParams.get('offset') || '0', 10)

  const { data, error, count } = await supabaseAdmin
    .from('roles')
    .select('id, code, name, description, permissions, sort_order, created_at', { count: 'exact' })
    .order('sort_order', { ascending: true })
    .range(offset, offset + limit - 1)

  if (error) {
    console.error('List roles error:', error)
    return NextResponse.json({ error: '查询失败' }, { status: 500 })
  }

  const permissionKeys = Array.from(new Set(
    (data || [])
      .flatMap((role) => Array.isArray(role.permissions) ? role.permissions : [])
      .filter((permission): permission is string => typeof permission === 'string' && permission.length > 0)
  )).sort()

  return NextResponse.json({
    success: true,
    data: {
      roles: data ?? [],
      permission_keys: permissionKeys,
    },
    pagination: {
      total: count || 0,
      limit,
      offset,
      hasMore: (count || 0) > offset + limit,
    },
  })
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

  const body = await req.json()
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
