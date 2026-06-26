// REQ: F003 自主可控 + RBAC
// PURPOSE: 角色管理 API - 列出角色权限

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { hasPermission } from '@/lib/permissions'

function canReadRoles(userPerms: string[]) {
  return hasPermission(userPerms, 'config:read')
    || hasPermission(userPerms, 'admin:access')
}

export async function GET(req: NextRequest) {
  const userPerms = (req.headers.get('x-user-permissions') ?? '').split(',').filter(Boolean)
  if (!canReadRoles(userPerms)) {
    return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
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
