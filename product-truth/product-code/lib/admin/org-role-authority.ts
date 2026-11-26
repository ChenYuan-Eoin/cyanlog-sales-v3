import { hasPermission, isOrgDelegationSensitivePermission } from '@/lib/permissions'
import {
  getOrgPermissions,
  type ScopedRoleAssignment,
} from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { loadOrgRolePermissionSettings, queryOrgRoles } from '@/lib/org-role-permissions'
import { loadShippingModulePermissionState } from '@/lib/permission-registry'
import { resolveRolePermissions } from '@/lib/role-permission-policy'
import { FXIAOKE_BASELINE_ROLE_CODE, isRoleAssignableInScope, ORG_SUPER_ADMIN_ROLE_CODE, SHIPPING_OPERATOR_ROLE_CODE } from '@/lib/role-permission-resolution'
import { DEPARTMENT_LEDGER_VIEW } from '@/lib/shipping/department-ledger-access'

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
  | { ok: false; reason: 'ROLE_NOT_FOUND' | 'ROLE_ESCALATION_FORBIDDEN' | 'ROLE_SCOPE_NOT_SUPPORTED' | 'LEGACY_BASELINE_ASSIGNMENT_FORBIDDEN' }

type RoleMutation = { scopeType: 'department' | 'space'; action: 'assign' | 'revoke' } | { action: 'replace' }

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
  mutation?: RoleMutation,
): Promise<OrgRoleAssignmentValidation> {
  const uniqueRoleIds = Array.from(new Set(roleIds.filter(Boolean).map(id => id.toLowerCase())))
  if (uniqueRoleIds.length === 0) {
    return { ok: true, roleIds: [] }
  }

  const { data, error } = await queryOrgRoles(orgId)
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

  // A whole-set editor can echo a current role. Only the locked DB command
  // decides whether the historical binding really exists or is a new grant.
  if (mutation?.action !== 'replace' && mutation?.action !== 'revoke' && roles.some(role => role.code === FXIAOKE_BASELINE_ROLE_CODE)) {
    return { ok: false, reason: 'LEGACY_BASELINE_ASSIGNMENT_FORBIDDEN' }
  }
  if (mutation?.action === 'assign' && mutation.scopeType === 'space'
    && roles.some(role => !isRoleAssignableInScope(role.code, 'space'))) {
    return { ok: false, reason: 'ROLE_SCOPE_NOT_SUPPORTED' }
  }
  // An existing department or space binding may be removed without delegating its permissions.
  const rolesToAuthorize = mutation?.action === 'revoke'
    ? roles.filter(role => role.code !== SHIPPING_OPERATOR_ROLE_CODE && role.code !== FXIAOKE_BASELINE_ROLE_CODE)
    : roles
  if (rolesToAuthorize.length === 0) return { ok: true, roleIds: uniqueRoleIds }

  const actorPermissions = getOrgPermissions(actorAssignments, orgId)
  const settings = await loadOrgRolePermissionSettings(orgId)
  const effectiveRoles = rolesToAuthorize.map(role => ({
    code: role.code, permissions: resolveRolePermissions(settings, role).permissions,
  }))
  if (mutation?.action === 'assign' && mutation.scopeType === 'department'
    && effectiveRoles.some(role => role.code === SHIPPING_OPERATOR_ROLE_CODE)) {
    const shippingRoles = effectiveRoles.filter(role => role.code === SHIPPING_OPERATOR_ROLE_CODE)
    if (shippingRoles.some(role => !role.permissions.includes(DEPARTMENT_LEDGER_VIEW))
      || !(await loadShippingModulePermissionState()).departmentLedgerPublished) {
      return { ok: false, reason: 'ROLE_SCOPE_NOT_SUPPORTED' }
    }
  }
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
