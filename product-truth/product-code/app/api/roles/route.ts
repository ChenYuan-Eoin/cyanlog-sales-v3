// REQ: F003 自主可控 + RBAC
// PURPOSE: 当前组织的角色列表、权限和角色创建

import { NextRequest } from 'next/server'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { queryOrgRoles, rolePermissionsEditBlockReason, type OrgVisibleRole } from '@/lib/org-role-permissions'
import { hasPublishedShippingBundle, REGISTERED_MODULE_PERMISSION_KEYS, SHIPPING_BUNDLE } from '@/lib/module-access'
import { loadRoleModulePermissionProjection, loadShippingModulePermissionState } from '@/lib/permission-registry'
import { PERMISSION_KEYS } from '@/lib/role-permission-policy'
import { ORG_BUSINESS_ROLE_ASSIGN } from '@/lib/permissions'
import { FXIAOKE_BASELINE_ROLE_CODE, ORG_SUPER_ADMIN_ROLE_CODE, resolveOwnerShippingPermissions, resolveRolePermissions, SHIPPING_OPERATOR_ROLE_CODE } from '@/lib/role-permission-resolution'
import { DEPARTMENT_LEDGER_VIEW } from '@/lib/shipping/department-ledger-access'
import { isRoleId, withRolePermissionContext } from './context'
import { mutateOrgRoleMetadata, roleMetadata } from './metadata'

function shippingDepartmentAvailability(code: string, permissions: readonly string[], departmentLedgerPublished: boolean) {
  return code === SHIPPING_OPERATOR_ROLE_CODE
    ? { department_scope_available: departmentLedgerPublished && permissions.includes(DEPARTMENT_LEDGER_VIEW) }
    : {}
}

export async function GET(req: NextRequest) {
  return withRolePermissionContext(req, async ({
    orgId, settings, canRead, canEdit, canListAssignableRoles,
  }) => {
    const { searchParams } = new URL(req.url)
    const assignable = searchParams.get('view') === 'assignable'
    if (assignable ? !canListAssignableRoles : !canRead) {
      return errorResponse(createApiError('FORBIDDEN'))
    }

    const roleId = searchParams.get('role_id')
    if (roleId !== null && !isRoleId(roleId)) return errorResponse(createApiError('VALIDATION_ERROR'))
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 100)
    const offset = Math.max(Number.parseInt(searchParams.get('offset') || '0', 10) || 0, 0)

    let query = queryOrgRoles(orgId, 'exact')
    // Only an exact lookup by a system administrator may read a retired role for audit.
    if (assignable || roleId === null || !canEdit) {
      const excludedCodes = [ORG_SUPER_ADMIN_ROLE_CODE, FXIAOKE_BASELINE_ROLE_CODE]
      if (assignable) excludedCodes.unshift('SUPER_ADMIN')
      query = query.not('code', 'in', `(${excludedCodes.join(',')})`)
    }
    if (roleId !== null) query = query.eq('id', roleId)
    const { data, error, count } = await query.order('sort_order').order('id').range(offset, offset + limit - 1)
    if (error?.code === '22P02') return errorResponse(createApiError('VALIDATION_ERROR'))
    if (error) {
      console.error('List organization roles error:', error)
      return errorResponse(createApiError('DB_ERROR', '查询失败'))
    }
    const rows = (data ?? []) as OrgVisibleRole[]
    const total = count ?? 0
    const pagination = { total, limit, offset, hasMore: total > offset + limit }
    if (assignable) {
      const departmentLedgerPublished = rows.some(role => role.code === SHIPPING_OPERATOR_ROLE_CODE)
        && (await loadShippingModulePermissionState()).departmentLedgerPublished
      return successResponse({ roles: rows.map(role => ({
        id: role.id, code: role.code, name: role.name,
        ...shippingDepartmentAvailability(role.code, resolveRolePermissions(settings, role).permissions, departmentLedgerPublished),
      })) }, pagination)
    }

    const { catalog: permissionCatalog, publication } = await loadRoleModulePermissionProjection()
    const roles = rows.map((role) => {
      const effective = resolveRolePermissions(settings, role)
      return {
        ...roleMetadata(role, canEdit),
        sort_order: role.sort_order,
        created_at: role.created_at,
        permissions: effective.permissions,
        permissions_overridden: effective.overridden,
        ...shippingDepartmentAvailability(role.code, effective.permissions, publication.departmentLedgerPublished),
        owner_shipping_permissions: resolveOwnerShippingPermissions(settings, role),
        permissions_edit_block_reason: rolePermissionsEditBlockReason(role.code),
      }
    })
    const publishedModuleKeys = [...publication.published].sort()
    const shippingBundleAvailable = hasPublishedShippingBundle(new Set(publishedModuleKeys))
    const permissionKeys = [
      ...PERMISSION_KEYS.filter(key => key !== '*' && key !== ORG_BUSINESS_ROLE_ASSIGN && !REGISTERED_MODULE_PERMISSION_KEYS.some(registered => registered === key)
        && (key !== SHIPPING_BUNDLE || shippingBundleAvailable)),
      ...publishedModuleKeys,
    ].sort()
    return successResponse(
      {
        org_id: orgId,
        roles,
        permission_keys: permissionKeys,
        permission_catalog: permissionCatalog,
        shipping_permission_publication: { registered: [...publication.registered].sort(), published: publishedModuleKeys },
        permissions_editable: canEdit,
        can_appoint_system_super_admin: canEdit,
        permissions_edit_block_reason: canEdit ? null : '仅系统超管可以保存角色授权。',
      },
      pagination,
    )
  })
}

export async function POST(req: NextRequest) {
  return mutateOrgRoleMetadata(req, 'create')
}
