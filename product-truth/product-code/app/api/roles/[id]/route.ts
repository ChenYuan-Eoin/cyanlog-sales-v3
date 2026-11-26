// REQ: F003 自主可控 + RBAC
// PURPOSE: 在当前组织保存角色权限覆盖，保留全局模板

import { NextRequest } from 'next/server'
import type { AsyncRouteParams } from '@/lib/route-params'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { saveOrgRolePermissions } from '@/lib/org-role-permissions'
import { isRoleId, withRolePermissionContext } from '../context'

export async function PATCH(
  req: NextRequest,
  context: AsyncRouteParams
) {
  return withRolePermissionContext(req, async ({
    orgId, settings, canEdit, canEditPlatformRoot, actorPermissions,
  }) => {
    if (!canEdit) {
      return errorResponse(createApiError('FORBIDDEN'))
    }
    let body: unknown
    try { body = await req.json() } catch { return errorResponse(createApiError('INVALID_JSON')) }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return errorResponse(createApiError('VALIDATION_ERROR'))
    const { id } = await context.params
    if (!isRoleId(id)) return errorResponse(createApiError('VALIDATION_ERROR'))
    const input = body as Record<string, unknown>
    if (!isRoleId(input.expected_org_id)) {
      return errorResponse(createApiError('VALIDATION_ERROR', '缺少角色所属组织，请刷新角色列表后重试。'))
    }
    if (input.expected_org_id !== orgId) {
      return errorResponse(createApiError('CONFLICT', '当前组织已经切换，请刷新角色列表后重试。'))
    }
    const ownerChange = Object.hasOwn(input, 'owner_shipping_permissions') || Object.hasOwn(input, 'expected_owner_shipping_permissions')
      ? { permissions: input.owner_shipping_permissions, expected: input.expected_owner_shipping_permissions }
      : undefined
    const result = await saveOrgRolePermissions(orgId, id, input.permissions, input.expected_permissions, {
      settings, canEditPlatformRoot, actorPermissions,
    }, ownerChange)
    if (result.ok) return successResponse({ org_id: orgId, role: result.role })
    if (result.reason === 'not_found') return errorResponse(createApiError('NOT_FOUND'))
    if (result.reason === 'conflict') return errorResponse(createApiError('CONFLICT', '权限已被其他管理员更新，请刷新后重试。'))
    if (result.reason === 'fixed_role') return errorResponse(createApiError('BUSINESS_RULE_VIOLATION', result.message))
    if (result.reason === 'escalation_forbidden') return errorResponse(createApiError('FORBIDDEN', '不能授予超出当前组织治理权限的配置项。'))
    return errorResponse(createApiError('VALIDATION_ERROR', '权限内容无效，请刷新角色列表后重试。'))
  })
}
