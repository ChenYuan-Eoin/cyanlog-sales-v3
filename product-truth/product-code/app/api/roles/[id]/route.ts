// REQ: F003 自主可控 + RBAC
// PURPOSE: 在当前组织保存角色权限覆盖，保留全局模板

import { NextRequest } from 'next/server'
import type { AsyncRouteParams } from '@/lib/route-params'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { getFreshDefaultOrgId, getFreshUserScopedRoleAssignments } from '@/lib/scoped-access'
import { canEditRolePermissions, saveOrgRolePermissions } from '@/lib/org-role-permissions'

export async function PATCH(
  req: NextRequest,
  context: AsyncRouteParams
) {
  return withAuthAndOrg(req, async (user: AuthUser) => {
    const [orgId, assignments] = await Promise.all([
      getFreshDefaultOrgId(user.id), getFreshUserScopedRoleAssignments(user.id),
    ])
    if (!canEditRolePermissions(assignments, orgId)) {
      return errorResponse(createApiError('FORBIDDEN'))
    }
    let body: unknown
    try { body = await req.json() } catch { return errorResponse(createApiError('INVALID_JSON')) }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return errorResponse(createApiError('VALIDATION_ERROR'))
    const { id } = await context.params
    if (!id || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) return errorResponse(createApiError('VALIDATION_ERROR'))
    const input = body as Record<string, unknown>
    const result = await saveOrgRolePermissions(orgId, id, input.permissions, input.expected_permissions)
    if (result.ok) return successResponse({ role: result.role })
    if (result.reason === 'not_found') return errorResponse(createApiError('NOT_FOUND'))
    if (result.reason === 'conflict') return errorResponse(createApiError('CONFLICT', '权限已被其他管理员更新，请刷新后重试。'))
    if (result.reason === 'core_required') return errorResponse(createApiError('BUSINESS_RULE_VIOLATION', '超级管理员必须保留后台访问和权限配置能力，避免组织无法管理。'))
    return errorResponse(createApiError('VALIDATION_ERROR', '权限内容无效，请刷新角色列表后重试。'))
  })
}
