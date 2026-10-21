import { supabaseAdmin } from '@/lib/supabase'
import { hasPermission } from '@/lib/permissions'
import { PERMISSION_KEYS, SUPER_ADMIN_CORE_PERMISSIONS, resolveRolePermissions } from '@/lib/role-permission-policy'
import type { ScopedRoleAssignment } from '@/lib/scoped-access'

export async function loadOrgRolePermissionSettings(orgId: string): Promise<unknown> {
  const { data, error } = await supabaseAdmin
    .from('organizations').select('settings').eq('id', orgId).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Organization not found')
  return data.settings
}

export function canEditRolePermissions(assignments: ScopedRoleAssignment[], orgId: string): boolean {
  return assignments.some((assignment) => (
    assignment.scopeType === 'org' && assignment.scopeId === orgId
    && assignment.roleCode === 'SUPER_ADMIN'
    && (!assignment.permissionsOverridden || hasPermission(assignment.permissions, 'role:manage'))
  ))
}

type PermissionRole = { id: string; code: string; permissions: unknown; [key: string]: unknown }
type SaveResult =
  | { ok: true; role: PermissionRole }
  | { ok: false; reason: 'not_found' | 'invalid' | 'core_required' | 'conflict' }

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

/** Only called after a fresh, exact-organization root-admin authorization check. */
export async function saveOrgRolePermissions(
  orgId: string,
  roleId: string,
  permissions: unknown,
  expectedPermissions: unknown,
): Promise<SaveResult> {
  if (!permissionList(permissions) || !permissionList(expectedPermissions)) return { ok: false, reason: 'invalid' }
  const { data: role, error } = await supabaseAdmin.from('roles')
    .select('id, code, name, description, permissions, sort_order').eq('id', roleId).maybeSingle()
  if (error) throw error
  if (!role) return { ok: false, reason: 'not_found' }
  const settings = await loadOrgRolePermissionSettings(orgId)
  if (settings !== null && !record(settings)) throw new Error('Invalid organization settings')
  const current = resolveRolePermissions(settings, role)
  if (!samePermissions(current.permissions, expectedPermissions)) return { ok: false, reason: 'conflict' }
  // Preserve already stored extensions; clients cannot invent new capability names.
  const known = new Set<string>([...PERMISSION_KEYS, ...current.permissions])
  if (permissions.some((key) => !known.has(key))) return { ok: false, reason: 'invalid' }
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
  let query = supabaseAdmin.from('organizations').update({ settings: nextSettings }).eq('id', orgId)
  // Compare the entire JSONB snapshot, preserving unrelated settings and other roles.
  query = settings === null ? query.is('settings', null) : query.eq('settings', JSON.stringify(settings))
  const result = await query.select('id').maybeSingle()
  if (result.error) throw result.error
  if (!result.data) return { ok: false, reason: 'conflict' }
  return { ok: true, role: { ...role, permissions } }
}
