import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getRequestAuthToken } from '@/lib/auth-token'
import { ORGANIZATION_ACTIONS_HEADER, readOrganizationPermissionDecision } from '@/lib/admin/organization-permission-decision'
import { canManageSystemAuthorizations, queryOrgRoles } from '@/lib/org-role-permissions'
import { getConfigsTabAccess, hasConfigsTabAccess } from '@/lib/configs/tab-access'
import {
  canManageOrg,
  getDefaultOrgId,
  getFreshDefaultOrgId,
  getFreshUserScopedRoleAssignments,
  getOrgScopedAssignments,
  getUserScopedRoleAssignments,
} from '@/lib/scoped-access'

export const preferredRegion = 'sin1'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const token = getRequestAuthToken(req)
    const forwardedOrgId = req.headers.get('x-user-id') === user.id ? req.headers.get('x-org-id') : null
    const fresh = req.nextUrl.searchParams.get('fresh') === '1'
      || (forwardedOrgId !== null && req.headers.has(ORGANIZATION_ACTIONS_HEADER))
    const [scopedAssignments, orgId, userResult, sessionResult] = await Promise.all([
      (fresh ? getFreshUserScopedRoleAssignments : getUserScopedRoleAssignments)(user.id),
      (fresh ? getFreshDefaultOrgId : getDefaultOrgId)(user.id),
      supabaseAdmin
        .from('users')
        .select('id, email, phone, display_name, avatar_url, title, employee_id, last_login_at, primary_dept_id, org_id')
        .eq('id', user.id)
        .single(),
      supabaseAdmin.from('auth_tokens').select('user_id,auth_method').eq('token', token || '').maybeSingle(),
    ])
    const { data: userRow, error: userError } = userResult

    if (userError || !userRow) {
      return errorResponse('读取用户失败', 500, 'USER_FETCH_FAILED')
    }

    const organizationRoles = getOrgScopedAssignments(scopedAssignments, orgId)
    const organizationActions = forwardedOrgId === orgId ? readOrganizationPermissionDecision(req.headers) : null
    const roleIds = [...new Set(organizationRoles.map(assignment => assignment.roleId))]
    const names = new Map<string, string>()
    if (roleIds.length) {
      const { data: definitions, error } = await queryOrgRoles(orgId).select('id,name').in('id', roleIds)
      if (error || !Array.isArray(definitions)) {
        return errorResponse('读取角色失败', 500, 'ROLE_FETCH_FAILED')
      }
      for (const definition of definitions) names.set(definition.id, definition.name)
    }
    const roles = organizationRoles.map(assignment => ({
      code: assignment.roleCode,
      name: names.get(assignment.roleId) ?? assignment.roleName,
    }))

    return NextResponse.json({
      user: {
        ...userRow,
        roles,
        scopedRoles: scopedAssignments,
        canManageOrg: organizationActions
          ? organizationActions['user:view'] || organizationActions['dept:directory_view']
          : canManageOrg(scopedAssignments, orgId),
        canViewConfigs: hasConfigsTabAccess(getConfigsTabAccess({
          permissions: organizationRoles.flatMap(assignment => assignment.permissions),
          systemAdministrator: canManageSystemAuthorizations(organizationRoles, orgId),
          shippingSettingsView: req.headers.get('x-user-shipping-settings-view') === '1',
          organizationActions,
        })),
        authMethod: sessionResult.data?.user_id === user.id ? sessionResult.data.auth_method : null,
      },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }

    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
