import { hasPermission, isOrgDelegationSensitivePermission } from '@/lib/permissions'
import {
  getOrgPermissions,
  type ScopedRoleAssignment,
} from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { loadOrgRolePermissionSettings } from '@/lib/org-role-permissions'
import { resolveRolePermissions } from '@/lib/role-permission-policy'
import { isRoleAssignableInScope, ORG_SUPER_ADMIN_ROLE_CODE, SHIPPING_OPERATOR_ROLE_CODE } from '@/lib/role-permission-resolution'

type AssignableRoleRow = {
  id: string
  code: string
  permissions: unknown
}

function roleCodeOf(value: unknown): string | null {
  const role = Array.isArray(value) ? (value.length === 1 ? value[0] : null) : value
  if (!role || typeof role !== 'object') return null
  const code = (role as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

export async function userHasOrgRoleCode(
  userId: string,
  orgId: string,
  roleCode: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('user_roles')
    .select('role:roles(code)')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .eq('scope_type', 'org')
    .eq('scope_id', orgId)

  if (error) throw error
  return (data || []).some((row) => roleCodeOf(row.role) === roleCode)
}

export type OrgRoleAssignmentValidation =
  | { ok: true; roleIds: string[] }
  | { ok: false; reason: 'ROLE_NOT_FOUND' | 'ROLE_ESCALATION_FORBIDDEN' | 'ROLE_SCOPE_NOT_SUPPORTED' }

type ScopedRoleMutation = { scopeType: 'department' | 'space'; action: 'assign' | 'revoke' }

/**
 * Validate tenant-side role assignment without allowing the caller to create a
 * stronger administrative principal than themselves. Organization managers may
 * still assign ordinary sales/legal/finance roles even when they do not perform
 * those business actions personally. Administrative trust roles have separate assignment flows.
 */
export async function validateOrgRoleAssignment(
  actorAssignments: ScopedRoleAssignment[],
  orgId: string,
  roleIds: string[],
  scopedMutation?: ScopedRoleMutation,
): Promise<OrgRoleAssignmentValidation> {
  const uniqueRoleIds = Array.from(new Set(roleIds.filter(Boolean).map(id => id.toLowerCase())))
  if (uniqueRoleIds.length === 0) {
    return { ok: true, roleIds: [] }
  }

  const { data, error } = await supabaseAdmin
    .from('roles')
    .select('id, code, permissions')
    .in('id', uniqueRoleIds)

  if (error || !Array.isArray(data) || data.length !== uniqueRoleIds.length) {
    return { ok: false, reason: 'ROLE_NOT_FOUND' }
  }
  const roles = data as AssignableRoleRow[]
  const returnedRoleIds = new Set(roles.map(role => role?.id))
  if (uniqueRoleIds.some(id => !returnedRoleIds.has(id))
    || roles.some(role => typeof role?.code !== 'string' || !role.code)) {
    return { ok: false, reason: 'ROLE_NOT_FOUND' }
  }

  if (scopedMutation?.action === 'assign' && roles.some(role => !isRoleAssignableInScope(role.code, scopedMutation.scopeType))) {
    return { ok: false, reason: 'ROLE_SCOPE_NOT_SUPPORTED' }
  }
  // An existing department or space binding may be removed without delegating its permissions.
  const rolesToAuthorize = scopedMutation?.action === 'revoke'
    ? roles.filter(role => role.code !== SHIPPING_OPERATOR_ROLE_CODE)
    : roles
  if (rolesToAuthorize.length === 0) return { ok: true, roleIds: uniqueRoleIds }

  const actorPermissions = getOrgPermissions(actorAssignments, orgId)
  const settings = await loadOrgRolePermissionSettings(orgId)
  const effectiveRoles = rolesToAuthorize.map(role => ({
    code: role.code, permissions: resolveRolePermissions(settings, role).permissions,
  }))
  const escalation = { ok: false, reason: 'ROLE_ESCALATION_FORBIDDEN' } as const
  const exceedsActorAuthority = effectiveRoles.some(({ code, permissions }) => (
    code === 'SUPER_ADMIN'
    || code === ORG_SUPER_ADMIN_ROLE_CODE
    || permissions.includes('*')
    || permissions.some(permission => isOrgDelegationSensitivePermission(permission) && !hasPermission(actorPermissions, permission))
  ))
  if (exceedsActorAuthority) return escalation

  return { ok: true, roleIds: uniqueRoleIds }
}
