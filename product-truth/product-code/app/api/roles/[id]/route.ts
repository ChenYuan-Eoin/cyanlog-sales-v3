// REQ: F003 自主可控 + RBAC
// PURPOSE: 角色管理 API - 列出与编辑角色权限
// 权限要求: config:read (可读) / config:write (可改)

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { z } from 'zod'

const PERMISSION_KEYS = [
  'config:read',
  'config:write',
  'rule:write',
  'contract:read',
  'contract:write',
  'contract:review',
  'quote:read',
  'quote:write',
  'user:read',
  'user:write',
  'org:write',
  'feishu:sync',
  'admin:access',
] as const

// GET /api/roles - 列出所有角色
export async function GET(req: NextRequest) {
  const userPerms = (req.headers.get('x-user-permissions') ?? '').split(',').filter(Boolean)
  if (!userPerms.includes('*') && !userPerms.includes('config:read')) {
    return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
  }

  const { data, error } = await supabaseAdmin
    .from('roles')
    .select('id, code, name, description, permissions, sort_order, created_at')
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('List roles error:', error)
    return NextResponse.json({ error: '查询失败' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    data: {
      roles: data ?? [],
      permission_keys: PERMISSION_KEYS,
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
  { params }: { params: { id: string } }
) {
  const userPerms = (req.headers.get('x-user-permissions') ?? '').split(',').filter(Boolean)
  if (!userPerms.includes('*') && !userPerms.includes('config:write')) {
    return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
  }

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
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    console.error('Update role error:', error)
    return NextResponse.json({ error: '更新失败' }, { status: 500 })
  }

  return NextResponse.json({ success: true, data })
}
