import { hasPermission } from '@/lib/permissions'
import { REGISTERED_MODULE_PERMISSION_KEYS } from '@/lib/module-access'

const registeredModuleKeys = new Set<string>(REGISTERED_MODULE_PERMISSION_KEYS)

export { resolveRolePermissions } from '@/lib/role-permission-resolution'

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

function resourceLeaves(key: string): string[] {
  const resource = key.slice(0, -1)
  return PERMISSION_KEYS.filter(candidate => candidate.startsWith(resource) && !candidate.endsWith('*'))
}

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

/** A checkbox represents this exact stored grant, never a derived effective state. */
export function isRolePermissionExplicitlyGranted(permissions: string[], key: string): boolean {
  return permissions.includes(key)
}

export interface PermissionGrantSource {
  grant: string
  via: 'direct' | 'bundle' | 'dependency'
  label: string
}

/**
 * Explain why a checkbox is effective. Exact grants are direct, resource
 * wildcards are bundles, and broader legacy capabilities are dependencies.
 */
export function getPermissionGrantSource(
  permissions: string[],
  key: string,
  impliedBy?: string[],
): PermissionGrantSource | null {
  const exact = permissions.find((permission) => permission === key)
  if (exact) {
    return { grant: exact, via: 'direct', label: exact }
  }

  const wildcard = permissions.find((permission) => {
    if (!permission.endsWith(':*')) return false
    return permission.slice(0, -1) === key.split(':')[0] + ':'
  })
  if (wildcard) {
    return { grant: wildcard, via: 'bundle', label: wildcard }
  }
  if (permissions.includes('*')) {
    return { grant: '*', via: 'bundle', label: '*' }
  }

  for (const implied of impliedBy ?? IMPLIED_PERMISSION_SOURCES[key] ?? []) {
    if (permissions.some((permission) => hasPermission([permission], implied))) {
      return {
        grant: implied,
        via: 'dependency',
        label: implied,
      }
    }
  }
  return null
}

/** Add or remove one explicit grant without rewriting any broader source. */
export function toggleExplicitRolePermission(
  permissions: string[],
  key: string,
  protectedPermissions: string[] = [],
): string[] {
  if (protectedPermissions.includes(key)) return permissions
  if (permissions.includes(key)) return permissions.filter((permission) => permission !== key)
  return Array.from(new Set([...permissions, key]))
}

/** Bulk select is an explicit action: persist every selected atomic grant. */
export function grantExplicitRolePermissions(
  permissions: string[],
  keys: string[],
  protectedPermissions: string[] = [],
): string[] {
  const next = new Set(permissions)
  for (const key of keys) {
    if (!protectedPermissions.includes(key)) next.add(key)
  }
  return Array.from(next)
}

/** Revoke one effective capability and every wildcard that would silently re-grant it. */
function revokeEffectiveRolePermission(
  permissions: string[],
  key: string,
  protectedPermissions: string[],
  canExpand: (key: string) => boolean,
): string[] {
  if (protectedPermissions.includes(key)) return permissions
  let next = [...permissions]
  // Keep other currently effective leaves when revoking their broader grant.
  for (const implied of Object.keys(IMPLIED_PERMISSION_SOURCES)) {
    if (isRolePermissionEnabled(permissions, implied)) next.push(implied)
  }
  const allKnown = PERMISSION_KEYS.filter(candidate => candidate !== '*' && canExpand(candidate))
  if (next.includes('*')) next = [...next.filter(candidate => candidate !== '*'), ...allKnown]
  const revoked = key.endsWith(':*')
    ? resourceLeaves(key).flatMap(permissionSources)
    : permissionSources(key)
  for (const capability of revoked) {
    const wildcard = `${capability.split(':')[0]}:*`
    if (next.includes(wildcard)) {
      next = [...next.filter(candidate => candidate !== wildcard), ...resourceLeaves(wildcard).filter(canExpand)]
    }
    next = next.filter(candidate => candidate !== capability)
  }
  if (key.endsWith(':*')) {
    const prefix = key.slice(0, -1)
    next = next.filter(candidate => !candidate.startsWith(prefix))
  }
  return Array.from(new Set([...next, ...protectedPermissions]))
}

/** Group clear is deliberately separate from a checkbox; it revokes derived access too. */
export function revokeRolePermissions(
  permissions: string[],
  keys: string[],
  protectedPermissions: string[] = [],
  availableModuleKeys?: ReadonlySet<string>,
): string[] {
  const canExpand = (key: string) => !availableModuleKeys || !registeredModuleKeys.has(key) || availableModuleKeys.has(key)
  const next = Array.from(new Set(keys)).reduce((draft, key) => {
    if (protectedPermissions.includes(key) || (!isRolePermissionEnabled(draft, key) && !draft.includes(key))) return draft
    return revokeEffectiveRolePermission(draft, key, protectedPermissions, canExpand)
  }, permissions)
  return next.filter(key => permissions.includes(key) || !registeredModuleKeys.has(key)
    || isRolePermissionEnabled(next, key))
}
