// REQ: F003 自主可控 + RBAC
// PURPOSE: 角色管理 API - 列出角色权限

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { rolePermissionsEditBlockReason } from '@/lib/org-role-permissions'
import { hasPublishedShippingBundle, REGISTERED_MODULE_PERMISSION_KEYS, SHIPPING_BUNDLE } from '@/lib/module-access'
import { loadRoleModulePermissionCatalog } from '@/lib/permission-registry'
import { PERMISSION_KEYS, resolveRolePermissions } from '@/lib/role-permission-policy'
import { isRoleId, withRolePermissionContext } from './context'

export async function GET(req: NextRequest) {
  return withRolePermissionContext(req, async ({ orgId, settings, canRead, canEdit, canEditPlatformRoot }) => {
    if (!canRead) {
      return errorResponse(createApiError('FORBIDDEN'))
    }

    const { searchParams } = new URL(req.url)
    const roleId = searchParams.get('role_id')
    if (roleId !== null && !isRoleId(roleId)) return errorResponse(createApiError('VALIDATION_ERROR'))
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 100)
    const offset = Math.max(Number.parseInt(searchParams.get('offset') || '0', 10) || 0, 0)

    let query = supabaseAdmin
      .from('roles')
      .select('id, code, name, description, permissions, sort_order, created_at', { count: 'exact' })
    if (roleId !== null) query = query.eq('id', roleId)
    const { data, error, count } = await query
      .order('sort_order', { ascending: true })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('List roles error:', error)
      return errorResponse(createApiError('DB_ERROR', '查询失败'))
    }

    const roles = (data || []).map((role) => ({
      ...role,
      permissions: resolveRolePermissions(settings, role).permissions,
      permissions_edit_block_reason: rolePermissionsEditBlockReason(role.code, canEditPlatformRoot),
    }))
    const permissionCatalog = await loadRoleModulePermissionCatalog()
    const publishedModuleKeys = permissionCatalog.flatMap(group => group.items.map(item => item.key))
    const shippingBundleAvailable = hasPublishedShippingBundle(new Set(publishedModuleKeys))
    const permissionKeys = [
      ...PERMISSION_KEYS.filter(key => !REGISTERED_MODULE_PERMISSION_KEYS.some(registered => registered === key)
        && (key !== SHIPPING_BUNDLE || shippingBundleAvailable)),
      ...publishedModuleKeys,
    ].sort()
    return successResponse(
      {
        org_id: orgId,
        roles,
        permission_keys: permissionKeys,
        permission_catalog: permissionCatalog,
        permissions_editable: canEdit,
        can_assign_org_super_admin: canEdit,
        permissions_edit_block_reason: canEdit ? null : '仅当前组织的超级管理员可修改角色权限。',
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
