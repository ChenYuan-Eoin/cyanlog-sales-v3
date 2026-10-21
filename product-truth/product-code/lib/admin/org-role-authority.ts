import { hasPermission } from '@/lib/permissions'
import {
  getOrgPermissions,
  type ScopedRoleAssignment,
} from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { loadOrgRolePermissionSettings } from '@/lib/org-role-permissions'
import { resolveRolePermissions } from '@/lib/role-permission-policy'

type AssignableRoleRow = {
  id: string
  code: string
  permissions: unknown
}

function roleCodeOf(value: unknown): string | null {
  const role = Array.isArray(value) ? value[0] : value
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
    .eq('scope_type', 'org')
    .eq('scope_id', orgId)

  if (error) throw error
  return (data || []).some((row) => roleCodeOf(row.role) === roleCode)
}

export type OrgRoleAssignmentValidation =
  | { ok: true; roleIds: string[] }
  | { ok: false; reason: 'ROLE_NOT_FOUND' | 'ROLE_ESCALATION_FORBIDDEN' }

const DELEGATION_SENSITIVE_RESOURCES = new Set([
  'admin',
  'org',
  'user',
  'dept',
  'config',
  'role',
  'permission',
  'platform',
  'report',
  'feishu',
])

function isDelegationSensitivePermission(permission: string): boolean {
  if (permission === '*') return true
  const [resource] = permission.split(':')
  return DELEGATION_SENSITIVE_RESOURCES.has(resource)
}

/**
 * Validate tenant-side role assignment without allowing the caller to create a
 * stronger administrative principal than themselves. Organization managers may
 * still assign ordinary sales/legal/finance roles even when they do not perform
 * those business actions personally. SUPER_ADMIN and wildcard roles remain a
 * platform/offline operation until the product has a non-self-assignable trust root.
 */
export async function validateOrgRoleAssignment(
  actorAssignments: ScopedRoleAssignment[],
  orgId: string,
  roleIds: string[]
): Promise<OrgRoleAssignmentValidation> {
  const uniqueRoleIds = Array.from(new Set(roleIds.filter(Boolean)))
  if (uniqueRoleIds.length === 0) {
    return { ok: true, roleIds: [] }
  }

  const { data, error } = await supabaseAdmin
    .from('roles')
    .select('id, code, permissions')
    .in('id', uniqueRoleIds)

  const roles = (data || []) as AssignableRoleRow[]
  if (error || roles.length !== uniqueRoleIds.length) {
    return { ok: false, reason: 'ROLE_NOT_FOUND' }
  }

  const actorPermissions = getOrgPermissions(actorAssignments, orgId)
  const settings = await loadOrgRolePermissionSettings(orgId)
  const exceedsActorAuthority = roles.some((role) => {
    const { permissions } = resolveRolePermissions(settings, role)

    return role.code === 'SUPER_ADMIN'
      || permissions.includes('*')
      || permissions.some((permission) => (
        isDelegationSensitivePermission(permission)
        && !hasPermission(actorPermissions, permission)
      ))
  })

  return exceedsActorAuthority
    ? { ok: false, reason: 'ROLE_ESCALATION_FORBIDDEN' }
    : { ok: true, roleIds: uniqueRoleIds }
}
