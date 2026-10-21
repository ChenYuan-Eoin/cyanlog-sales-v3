// REQ: F003 自主可控 + RBAC
// PURPOSE: 角色管理 API - 列出角色权限

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { userHasOrgConfigAccess } from '@/lib/configs/access'
import { canManageOrg, getUserScopedRoleAssignments } from '@/lib/scoped-access'
import { canEditRolePermissions, loadOrgRolePermissionSettings } from '@/lib/org-role-permissions'
import { PERMISSION_KEYS, resolveRolePermissions } from '@/lib/role-permission-policy'

export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const [canReadConfig, assignments] = await Promise.all([
      userHasOrgConfigAccess(user.id, orgId, 'read'),
      getUserScopedRoleAssignments(user.id),
    ])
    if (!canReadConfig && !canManageOrg(assignments, orgId)) {
      return errorResponse(createApiError('FORBIDDEN'))
    }

    const { searchParams } = new URL(req.url)
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 100)
    const offset = Math.max(Number.parseInt(searchParams.get('offset') || '0', 10) || 0, 0)

    const { data, error, count } = await supabaseAdmin
      .from('roles')
      .select('id, code, name, description, permissions, sort_order, created_at', { count: 'exact' })
      .order('sort_order', { ascending: true })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('List roles error:', error)
      return errorResponse(createApiError('DB_ERROR', '查询失败'))
    }

    const settings = await loadOrgRolePermissionSettings(orgId)
    const roles = (data || []).map((role) => ({ ...role, permissions: resolveRolePermissions(settings, role).permissions }))
    const permissionKeys = Array.from(new Set([
      ...PERMISSION_KEYS,
      ...roles
        .flatMap((role) => Array.isArray(role.permissions) ? role.permissions : [])
        .filter((permission): permission is string => typeof permission === 'string' && permission.length > 0)
    ])).sort()
    const editable = canEditRolePermissions(assignments, orgId)

    return successResponse(
      {
        roles,
        permission_keys: permissionKeys,
        permissions_editable: editable,
        permissions_edit_block_reason: editable ? null : '仅当前组织的超级管理员可修改角色权限。',
      },
      {
        total: count || 0,
        limit,
        offset,
        hasMore: (count || 0) > offset + limit,
      }
    )
  })
}
