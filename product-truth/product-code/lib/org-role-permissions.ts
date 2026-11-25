import { supabaseAdmin } from '@/lib/supabase'
import { REGISTERED_MODULE_PERMISSION_KEYS } from '@/lib/module-access'
import {
  canAccessOrgAdmin, hasPermission, isOrgDelegationSensitivePermission,
} from '@/lib/permissions'
import { PERMISSION_KEYS, SUPER_ADMIN_CORE_PERMISSIONS, resolveRolePermissions } from '@/lib/role-permission-policy'
import { isRoleAssignableInScope, ORG_SUPER_ADMIN_ROLE_CODE } from '@/lib/role-permission-resolution'
import type { ScopedRoleAssignment } from '@/lib/scoped-access'

export async function loadOrgRolePermissionSettings(orgId: string): Promise<unknown> {
  const { data, error } = await supabaseAdmin
    .from('organizations').select('settings').eq('id', orgId).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Organization not found')
  return data.settings
}

function hasOrgRoleManagement(assignments: ScopedRoleAssignment[], orgId: string, codes: string[]): boolean {
  return assignments.some((assignment) => (
    assignment.scopeType === 'org' && assignment.scopeId === orgId
    && codes.includes(assignment.roleCode)
    && hasPermission(assignment.permissions, 'role:manage')
  ))
}

export function canEditRolePermissions(assignments: ScopedRoleAssignment[], orgId: string): boolean {
  return hasOrgRoleManagement(assignments, orgId, ['SUPER_ADMIN', ORG_SUPER_ADMIN_ROLE_CODE])
}

type RolePermissionContext = {
  orgId: string
  settings: unknown
  canRead: boolean
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
    .select('org_id,status,employment_status,is_default,left_at')
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
  const assignments = ((orgRoles.data ?? []) as OrgRoleRow[]).flatMap((row): ScopedRoleAssignment[] => {
    const role = Array.isArray(row.role) ? (row.role.length === 1 ? row.role[0] : null) : row.role
    if (row.org_id !== orgId || row.user_id !== userId || !row.scope_id
      || !role?.id || !role.code || !role.name) return []
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
    canEditPlatformRoot: hasOrgRoleManagement(assignments, orgId, ['SUPER_ADMIN']),
    actorPermissions: permissions,
    canRead: canEdit || canAccessOrgAdmin(permissions, legacyRoleCodes)
      || ['config:read', 'config:write', 'config:publish'].some(permission => hasPermission(permissions, permission)),
  }
}

export function rolePermissionsEditBlockReason(roleCode: string, canEditPlatformRoot = true): string | null {
  if (roleCode === 'FXIAOKE_BASELINE') return '纷享基础角色由系统管理，权限固定为只读。'
  if (roleCode === ORG_SUPER_ADMIN_ROLE_CODE) return '组织超级管理员的治理权限由系统固定。'
  if (roleCode === 'SUPER_ADMIN' && !canEditPlatformRoot) return '仅平台超级管理员可修改此角色的权限。'
  return null
}

type PermissionRole = { id: string; code: string; permissions: unknown; [key: string]: unknown }
type SaveResult =
  | { ok: true; role: PermissionRole }
  | { ok: false; reason: 'not_found' | 'invalid' | 'core_required' | 'conflict' | 'escalation_forbidden' }
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

/** Only called after a fresh, exact-organization role management check. */
export async function saveOrgRolePermissions(
  orgId: string,
  roleId: string,
  permissions: unknown,
  expectedPermissions: unknown,
  authorizedSnapshot?: Pick<RolePermissionContext, 'settings' | 'canEditPlatformRoot' | 'actorPermissions'>,
): Promise<SaveResult> {
  if (!permissionList(permissions) || !permissionList(expectedPermissions)) return { ok: false, reason: 'invalid' }
  const { data: role, error } = await supabaseAdmin.from('roles')
    .select('id, code, name, description, permissions, sort_order').eq('id', roleId).maybeSingle()
  if (error) throw error
  if (!role) return { ok: false, reason: 'not_found' }
  const fixedRoleReason = rolePermissionsEditBlockReason(role.code, authorizedSnapshot?.canEditPlatformRoot)
  if (fixedRoleReason) return { ok: false, reason: 'fixed_role', message: fixedRoleReason }
  const settings = authorizedSnapshot ? authorizedSnapshot.settings : await loadOrgRolePermissionSettings(orgId)
  if (settings !== null && !record(settings)) throw new Error('Invalid organization settings')
  const current = resolveRolePermissions(settings, role)
  if (!samePermissions(current.permissions, expectedPermissions)) return { ok: false, reason: 'conflict' }
  // Preserve already stored extensions; clients cannot invent new capability names.
  const known = new Set<string>([...PERMISSION_KEYS, ...current.permissions])
  if (permissions.some((key) => !known.has(key))) return { ok: false, reason: 'invalid' }
  const newGrants = permissions.filter(key => !current.permissions.includes(key))
  const tenantActor = authorizedSnapshot && !authorizedSnapshot.canEditPlatformRoot ? authorizedSnapshot : null
  if (tenantActor && permissions.includes('*')) return { ok: false, reason: 'escalation_forbidden' }

  const grantsRequiringPublishedDefinition = new Set(
    REGISTERED_MODULE_PERMISSION_KEYS.filter(key => newGrants.includes(key)),
  )
  if (grantsRequiringPublishedDefinition.size > 0) {
    const { loadRoleModulePermissionCatalog } = await import('@/lib/permission-registry')
    const catalog = await loadRoleModulePermissionCatalog()
    const available = new Map(catalog.flatMap(group => group.items.map(item => [item.key, item.dependencies] as const)))
    for (const key of grantsRequiringPublishedDefinition) {
      const dependencies = available.get(key)
      if (!dependencies || dependencies.some(dependency => !hasPermission(permissions, dependency))) {
        return { ok: false, reason: 'invalid' }
      }
    }
  }

  if (tenantActor && newGrants.some(key => isOrgDelegationSensitivePermission(key)
    && !hasPermission(tenantActor.actorPermissions, key))) {
    return { ok: false, reason: 'escalation_forbidden' }
  }
  if (role.code === 'SUPER_ADMIN'
    && SUPER_ADMIN_CORE_PERMISSIONS.some((key) => !hasPermission(permissions, key))) {
    return { ok: false, reason: 'core_required' }
  }
  if (samePermissions(current.permissions, permissions)) return { ok: true, role: { ...role, permissions: current.permissions } }
  const previous = settings ?? {}
  const previousOverrides = (previous as Record<string, unknown>).role_permission_overrides
  if (previousOverrides !== undefined && !record(previousOverrides)) throw new Error('Invalid role permission overrides')
  const nextSettings = {
    ...previous,
    role_permission_overrides: { ...((previousOverrides ?? {}) as Record<string, unknown>), [roleId]: permissions },
  }
  let query = supabaseAdmin.from('organizations').update({ settings: nextSettings })
    .eq('id', orgId).eq('status', 'active')
  // Compare the entire JSONB snapshot, preserving unrelated settings and other roles.
  query = settings === null ? query.is('settings', null) : query.eq('settings', JSON.stringify(settings))
  const result = await query.select('id').maybeSingle()
  if (result.error) throw result.error
  if (!result.data) return { ok: false, reason: 'conflict' }
  return { ok: true, role: { ...role, permissions } }
}
