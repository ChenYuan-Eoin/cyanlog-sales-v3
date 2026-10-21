import { hasPermission } from '@/lib/permissions'

/** Explicitly supported capabilities. Wildcards are only expanded when editing. */
export const PERMISSION_KEYS: string[] = [
  '*', 'admin:access', 'config:*', 'config:read', 'config:write', 'config:publish',
  'role:manage', 'report:*', 'report:dept', 'report:finance',
  'org:*', 'org:write', 'dept:*', 'dept:view', 'dept:write',
  'user:*', 'user:view', 'user:write', 'feishu:sync',
  'opportunity:*', 'opportunity:own', 'quote:*', 'quote:create', 'quote:update_own',
  'quote:approve', 'quote:view', 'customer:*', 'customer:view', 'customer:create',
  'contract:*', 'contract:view', 'contract:upload', 'contract:create', 'contract:write',
  'contract:review', 'contract:approve', 'contract:read', 'template:view', 'payment:*',
  'shipping:*', 'shipping:manage_connections', 'shipping:operate',
]

export const SUPER_ADMIN_CORE_PERMISSIONS: string[] = [
  'admin:access', 'config:read', 'config:write', 'role:manage',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizePermissions(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((key): key is string => typeof key === 'string' && key.length > 0)))
    : []
}

function templatePermissions(role: { code: string; permissions: unknown }): string[] {
  // Preserve capabilities that existing authorization granted by role code before the first edit.
  const legacyCapabilities: Record<string, string[]> = {
    SUPER_ADMIN: ['*'],
    ADMIN: ['admin:access', 'user:write', 'dept:write', 'contract:write', 'shipping:manage_connections'],
    SALES_OPS: ['admin:access'],
    LEGAL: ['contract:review'],
  }
  return Array.from(new Set([...normalizePermissions(role.permissions), ...(legacyCapabilities[role.code] ?? [])]))
}

/** Empty overrides revoke everything; malformed overrides must never restore templates. */
export function resolveRolePermissions(
  settings: unknown,
  role: { id: string; code: string; permissions: unknown },
): { permissions: string[]; overridden: boolean } {
  if (settings != null && !isRecord(settings)) return { permissions: [], overridden: true }
  if (!isRecord(settings) || !Object.prototype.hasOwnProperty.call(settings, 'role_permission_overrides')) {
    return { permissions: templatePermissions(role), overridden: false }
  }
  const overrides = settings.role_permission_overrides
  if (!isRecord(overrides)) return { permissions: [], overridden: true }
  if (!Object.prototype.hasOwnProperty.call(overrides, role.id)) {
    return { permissions: templatePermissions(role), overridden: false }
  }
  const permissions = overrides[role.id]
  if (!Array.isArray(permissions) || permissions.some(key => typeof key !== 'string' || !key)) {
    return { permissions: [], overridden: true }
  }
  return { permissions: Array.from(new Set(permissions)), overridden: true }
}

function resourceLeaves(key: string): string[] {
  const resource = key.slice(0, -1)
  return PERMISSION_KEYS.filter(candidate => candidate.startsWith(resource) && !candidate.endsWith('*'))
}

// Existing business authorization treats these broader capabilities as grants.
const IMPLIED_PERMISSION_SOURCES: Record<string, string[]> = {
  'config:read': ['config:write', 'config:publish'],
  'admin:access': ['org:write', 'user:view', 'user:write'],
  'user:write': ['org:write'],
  'dept:write': ['org:write'],
  'contract:view': ['contract:read', 'contract:upload', 'contract:review', 'contract:write'],
  'contract:upload': ['contract:create', 'contract:write'],
  'contract:create': ['contract:upload', 'contract:write'],
  'contract:review': ['contract:write'],
}

function permissionSources(key: string): string[] {
  return [key, ...(IMPLIED_PERMISSION_SOURCES[key] ?? [])]
}

export function isRolePermissionEnabled(permissions: string[], key: string): boolean {
  if (permissionSources(key).some(source => hasPermission(permissions, source))) return true
  if (!key.endsWith(':*')) return false
  const leaves = resourceLeaves(key)
  return leaves.length > 0 && leaves.every(leaf => isRolePermissionEnabled(permissions, leaf))
}

/** Remove every wildcard that would silently re-grant a deselected capability. */
export function toggleRolePermission(
  permissions: string[],
  key: string,
  protectedPermissions: string[] = [],
): string[] {
  if (protectedPermissions.includes(key)) return permissions
  const wasEnabled = isRolePermissionEnabled(permissions, key)
  let next = [...permissions]
  if (!wasEnabled) {
    next.push(key)
  } else {
    // Keep other currently effective leaves when revoking their broader grant.
    for (const implied of Object.keys(IMPLIED_PERMISSION_SOURCES)) {
      if (isRolePermissionEnabled(permissions, implied)) next.push(implied)
    }
    const allKnown = PERMISSION_KEYS.filter(candidate => candidate !== '*')
    if (next.includes('*')) next = [...next.filter(candidate => candidate !== '*'), ...allKnown]
    const revoked = key.endsWith(':*')
      ? resourceLeaves(key).flatMap(permissionSources)
      : permissionSources(key)
    for (const capability of revoked) {
      const wildcard = `${capability.split(':')[0]}:*`
      if (next.includes(wildcard)) {
        next = [...next.filter(candidate => candidate !== wildcard), ...resourceLeaves(wildcard)]
      }
      next = next.filter(candidate => candidate !== capability)
    }
    if (key.endsWith(':*')) {
      const prefix = key.slice(0, -1)
      next = next.filter(candidate => !candidate.startsWith(prefix))
    }
  }
  return Array.from(new Set([...next, ...protectedPermissions]))
}
