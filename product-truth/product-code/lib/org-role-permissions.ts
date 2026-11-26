import { supabaseAdmin } from '@/lib/supabase'
import {
  hasShippingPermission, REGISTERED_MODULE_PERMISSION_KEYS, shippingActionViewDependency, SHIPPING_BUNDLE,
  SHIPPING_MANAGE_CONNECTIONS, SHIPPING_OPERATE,
} from '@/lib/module-access'
import {
  canReadRoleDirectory, hasPermission, isSystemAuthorizationGrant, ORG_BUSINESS_ROLE_ASSIGN, ORG_MEMBER_EDIT,
  ORG_DEPARTMENT_DIRECTORY_VIEW, ORG_DEPARTMENT_STRUCTURE_DELETE, ORG_DEPARTMENT_STRUCTURE_EDIT,
  ROLE_DIRECTORY_VIEW,
} from '@/lib/permissions'
import { PERMISSION_KEYS, resolveRolePermissions } from '@/lib/role-permission-policy'
import { FXIAOKE_BASELINE_ROLE_CODE, isRoleAssignableInScope, ORG_SUPER_ADMIN_ROLE_CODE, resolveOwnerShippingPermissions } from '@/lib/role-permission-resolution'
import type { ScopedRoleAssignment } from '@/lib/scoped-access'
import { ORG_MEMBER_LIFECYCLE_ACTIONS } from '@/lib/admin/member-action-keys'
import { isShippingOwnerPermission, SHIPPING_OWNER_VIEW } from '@/lib/shipping/owner-permission-keys'

export async function loadOrgRolePermissionSettings(orgId: string): Promise<unknown> {
  const { data, error } = await supabaseAdmin
    .from('organizations').select('settings').eq('id', orgId).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Organization not found')
  return data.settings
}

export function canManageSystemAuthorizations(assignments: ScopedRoleAssignment[], orgId: string): boolean {
  return assignments.some((assignment) => (
    assignment.scopeType === 'org' && assignment.scopeId === orgId
    && isSystemAuthorizationGrant(assignment.roleCode, assignment.permissions)
  ))
}

export const canEditRolePermissions = canManageSystemAuthorizations

type RolePermissionContext = {
  orgId: string
  settings: unknown
  canRead: boolean
  canListAssignableRoles?: boolean
  canEdit: boolean
  canEditPlatformRoot: boolean
  actorPermissions: string[]
}

type OrgRoleRow = {
  org_id: string
  user_id: string
  scope_type: string
  scope_id: string | null
  granted_at: string | null
  role: OrgRoleTemplate | OrgRoleTemplate[] | null
}

type OrgRoleTemplate = { id: string; code: string; name: string; permissions: unknown }

/** Reads current membership and role bindings from the same active organization. */
export async function loadCurrentOrganizationRoleAssignments(userId: string, includeScoped = false) {
  const membership = await supabaseAdmin.from('user_organizations')
    .select('org_id,status,employment_status,is_default,left_at,account:users!user_organizations_user_id_fkey(id,status,login_enabled)')
    .eq('user_id', userId).eq('is_default', true).limit(2)
  if (membership.error) throw membership.error
  const member = membership.data?.length === 1 ? membership.data[0] : null
  if (typeof member?.org_id !== 'string' || !member.org_id || member.status !== 'active' || member.employment_status !== 'active'
    || member.is_default !== true || member.left_at !== null) return null

  const orgId = member.org_id
  const roles = supabaseAdmin.from('user_roles')
    .select('org_id,user_id,scope_type,scope_id,granted_at,role:roles(id,code,name,permissions)')
    .eq('org_id', orgId).eq('user_id', userId)
  const [organization, orgRoles] = await Promise.all([
    supabaseAdmin.from('organizations').select('id,status,settings').eq('id', orgId).maybeSingle(),
    includeScoped ? roles : roles.eq('scope_type', 'org').eq('scope_id', orgId),
  ])
  if (organization.error) throw organization.error
  if (orgRoles.error) throw orgRoles.error
  const activeOrg = organization.data
  if (!activeOrg || activeOrg.id !== orgId || activeOrg.status !== 'active') return null

  const settings = activeOrg.settings
  const account = Array.isArray(member.account) ? (member.account.length === 1 ? member.account[0] : null) : member.account
  const activeAccount = account?.id === userId && account.status === 'active' && account.login_enabled === true
  const assignments = ((orgRoles.data ?? []) as OrgRoleRow[]).flatMap((row): ScopedRoleAssignment[] => {
    const role = Array.isArray(row.role) ? (row.role.length === 1 ? row.role[0] : null) : row.role
    if (row.org_id !== orgId || row.user_id !== userId || !row.scope_id
      || !role?.id || !role.code || !role.name || role.code === FXIAOKE_BASELINE_ROLE_CODE) return []
    if (role.code === 'SUPER_ADMIN' && !activeAccount) return []
    const scopeType = row.scope_type
    if (scopeType === 'org') {
      if (row.scope_id !== orgId) return []
    } else if (!includeScoped || (scopeType !== 'department' && scopeType !== 'space')
      || ['SUPER_ADMIN', ORG_SUPER_ADMIN_ROLE_CODE].includes(role.code)
      || !isRoleAssignableInScope(role.code, scopeType)) return []
    const effective = resolveRolePermissions(settings, role)
    return [{
      scopeType, scopeId: row.scope_id, grantedAt: row.granted_at, roleId: role.id, roleCode: role.code,
      roleName: role.name, permissions: effective.permissions, permissionsOverridden: effective.overridden,
      ownerShippingPermissions: scopeType === 'org' ? resolveOwnerShippingPermissions(settings, role) : [],
    }]
  })
  return { orgId, settings, assignments }
}

/** Both role routes read live, exact-organization membership and role grants. */
export async function loadOrgRolePermissionContext(userId: string): Promise<RolePermissionContext | null> {
  const context = await loadCurrentOrganizationRoleAssignments(userId)
  if (!context) return null
  const { orgId, settings, assignments } = context
  const permissions = assignments.flatMap(assignment => assignment.permissions)
  const legacyRoleCodes = assignments.filter(assignment => !assignment.permissionsOverridden)
    .map(assignment => assignment.roleCode)
  const canEdit = canEditRolePermissions(assignments, orgId)
  return {
    orgId,
    settings,
    canEdit,
    canEditPlatformRoot: canEdit,
    actorPermissions: permissions,
    canRead: canReadRoleDirectory(permissions, legacyRoleCodes),
    canListAssignableRoles: canEdit,
  }
}

export function rolePermissionsEditBlockReason(roleCode: string): string | null {
  if (roleCode === FXIAOKE_BASELINE_ROLE_CODE) return '历史纷享基础角色已停止授予业务权限，仅可核对和撤销成员绑定。'
  if (roleCode === ORG_SUPER_ADMIN_ROLE_CODE) return '历史组织治理授权仅可撤销。'
  if (roleCode === 'SUPER_ADMIN') return '系统超管的权限由系统固定，可在员工分配中任免成员。'
  return null
}

type PermissionRole = { id: string; code: string; permissions: unknown; [key: string]: unknown }
type SaveResult =
  | { ok: true; role: PermissionRole }
  | { ok: false; reason: 'not_found' | 'invalid' | 'conflict' | 'forbidden' }
  | { ok: false; reason: 'fixed_role'; message: string }

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function permissionList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 300
    && value.every((key) => typeof key === 'string' && key.length > 0 && key.length <= 120)
    && new Set(value).size === value.length
}

function samePermissions(left: string[], right: string[]): boolean {
  return left.length === right.length && [...left].sort().every((key, index) => key === [...right].sort()[index])
}

/** Validate the proposed grants, then commit through the live system authority check. */
export async function saveOrgRolePermissions(
  actorId: string,
  orgId: string,
  roleId: string,
  permissions: unknown,
  expectedPermissions: unknown,
  authorizedSnapshot?: Pick<RolePermissionContext, 'settings'>,
  ownerChange?: { expected: unknown; permissions: unknown },
): Promise<SaveResult> {
  if (!permissionList(permissions) || !permissionList(expectedPermissions)
    || permissions.some(isShippingOwnerPermission)) return { ok: false, reason: 'invalid' }
  const { data: role, error } = await supabaseAdmin.from('roles')
    .select('id, code, name, description, permissions, sort_order').eq('id', roleId).maybeSingle()
  if (error) throw error
  if (!role) return { ok: false, reason: 'not_found' }
  const fixedRoleReason = rolePermissionsEditBlockReason(role.code)
  const settings = authorizedSnapshot ? authorizedSnapshot.settings : await loadOrgRolePermissionSettings(orgId)
  if (settings !== null && !record(settings)) throw new Error('Invalid organization settings')
  const current = resolveRolePermissions(settings, role)
  const currentOwnerPermissions = resolveOwnerShippingPermissions(settings, role)
  const updateOrganizationPermissions = !samePermissions(current.permissions, permissions)
  if (fixedRoleReason) {
    return { ok: false, reason: 'fixed_role', message: fixedRoleReason }
  }
  if (!samePermissions(current.permissions, expectedPermissions)) return { ok: false, reason: 'conflict' }
  let ownerPermissions = currentOwnerPermissions
  if (ownerChange) {
    if (!permissionList(ownerChange.permissions) || !permissionList(ownerChange.expected)
      || !ownerChange.permissions.every(isShippingOwnerPermission) || !ownerChange.expected.every(isShippingOwnerPermission)
      || (ownerChange.permissions.length > 0 && !ownerChange.permissions.includes(SHIPPING_OWNER_VIEW))) {
      return { ok: false, reason: 'invalid' }
    }
    if (!samePermissions(currentOwnerPermissions, ownerChange.expected)) return { ok: false, reason: 'conflict' }
    ownerPermissions = ownerChange.permissions
  }
  // Preserve already stored extensions; clients cannot invent new capability names.
  const known = new Set<string>([...PERMISSION_KEYS, ...current.permissions])
  if (permissions.some((key) => !known.has(key))) return { ok: false, reason: 'invalid' }
  const newGrants = permissions.filter(key => !current.permissions.includes(key))
  if (newGrants.includes(ORG_BUSINESS_ROLE_ASSIGN)) return { ok: false, reason: 'invalid' }
  if (permissions.some(key => key === ORG_MEMBER_EDIT || key === ORG_BUSINESS_ROLE_ASSIGN || key === ROLE_DIRECTORY_VIEW
    || ORG_MEMBER_LIFECYCLE_ACTIONS.some(action => action === key))
    && !hasPermission(permissions, 'user:view')) return { ok: false, reason: 'invalid' }
  if (permissions.some(key => key === ORG_DEPARTMENT_STRUCTURE_EDIT || key === ORG_DEPARTMENT_STRUCTURE_DELETE)
    && !hasPermission(permissions, ORG_DEPARTMENT_DIRECTORY_VIEW)) return { ok: false, reason: 'invalid' }
  if (permissions.some(key => {
    const dependency = shippingActionViewDependency(key)
    return dependency !== null && !hasShippingPermission(permissions, dependency)
  })) return { ok: false, reason: 'invalid' }

  const newOwnerGrants = ownerPermissions.filter(key => !currentOwnerPermissions.includes(key))
  const grantsRequiringPublishedDefinition = newGrants.includes(SHIPPING_BUNDLE)
    ? [SHIPPING_OPERATE, SHIPPING_MANAGE_CONNECTIONS, ...REGISTERED_MODULE_PERMISSION_KEYS.filter(key => newGrants.includes(key)), ...newOwnerGrants]
    : [...REGISTERED_MODULE_PERMISSION_KEYS.filter(key => newGrants.includes(key)), ...newOwnerGrants]
  if (grantsRequiringPublishedDefinition.length > 0) {
    const { loadRoleModulePermissionCatalog } = await import('@/lib/permission-registry')
    const catalog = await loadRoleModulePermissionCatalog()
    const available = new Map(catalog.flatMap(group => group.items.map(item => [item.key, item.dependencies] as const)))
    for (const key of grantsRequiringPublishedDefinition) {
      const dependencies = available.get(key)
      const hasDependency = isShippingOwnerPermission(key)
        ? (dependency: string) => ownerPermissions.includes(dependency)
        : (dependency: string) => hasShippingPermission(permissions, dependency)
      if (!dependencies || dependencies.some(dependency =>
        !available.has(dependency) || !hasDependency(dependency))) {
        return { ok: false, reason: 'invalid' }
      }
    }
  }

  const { data: result, error: saveError } = await supabaseAdmin.rpc('admin_save_org_role_permissions_v1', {
    p_actor_id: actorId,
    p_org_id: orgId,
    p_role_id: roleId,
    p_expected_settings: settings,
    p_expected_role_code: role.code,
    p_expected_role_template: role.permissions,
    p_permissions: updateOrganizationPermissions ? permissions : null,
    p_owner_permissions: samePermissions(currentOwnerPermissions, ownerPermissions) ? null : ownerPermissions,
  })
  if (saveError?.code === '42501') return { ok: false, reason: 'forbidden' }
  if (saveError?.code === '22023') return { ok: false, reason: 'invalid' }
  if (saveError) throw saveError
  if (result === 'not_found' || result === 'conflict') return { ok: false, reason: result }
  if (result === 'fixed_role') return { ok: false, reason: 'fixed_role', message: '该角色的权限由系统固定。' }
  if (result !== 'saved') throw new Error('Unexpected role permission save result')
  return { ok: true, role: { ...role, permissions, owner_shipping_permissions: ownerPermissions } }
}
