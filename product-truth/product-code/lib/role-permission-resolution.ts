import { isShippingOwnerPermission, SHIPPING_OWNER_ACTION_KEYS, SHIPPING_OWNER_VIEW } from './shipping/owner-permission-keys'

export const ORG_SUPER_ADMIN_ROLE_CODE = 'ORG_SUPER_ADMIN'
export const FXIAOKE_BASELINE_ROLE_CODE = 'FXIAOKE_BASELINE'
export const SHIPPING_OPERATOR_ROLE_CODE = 'SHIPPING_OPERATOR'

export function isRoleAssignableInScope(code: string, scopeType: 'org' | 'department' | 'space'): boolean {
  return code !== SHIPPING_OPERATOR_ROLE_CODE || scopeType === 'org'
}

export function isRetiredRoleCode(code: string): boolean {
  return code === FXIAOKE_BASELINE_ROLE_CODE || code === ORG_SUPER_ADMIN_ROLE_CODE
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizePermissions(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((key): key is string => typeof key === 'string' && key.length > 0)))
    : []
}

export function resolveOwnerShippingPermissions(settings: unknown, role: { id: string; code: string; permissions: unknown }): string[] {
  if (role.code === 'SUPER_ADMIN') return [...SHIPPING_OWNER_ACTION_KEYS]
  if (isRetiredRoleCode(role.code)) return []
  if (settings != null && !isRecord(settings)) return []
  if (isRecord(settings) && Object.hasOwn(settings, 'shipping_owner_permission_overrides')) {
    const overrides = settings.shipping_owner_permission_overrides
    if (!isRecord(overrides)) return []
    if (Object.hasOwn(overrides, role.id)) {
      const grants = overrides[role.id]
      if (!Array.isArray(grants) || !grants.every(isShippingOwnerPermission) || !grants.includes(SHIPPING_OWNER_VIEW)) return []
      return [...new Set(grants)]
    }
  }
  return []
}

function templatePermissions(role: { code: string; permissions: unknown }): string[] {
  // Contract authorization still consumes historical roles pending its action-by-action cutover.
  const legacyContractPermission = role.code === 'ADMIN' ? 'contract:write' : role.code === 'LEGAL' ? 'contract:review' : null
  const stored = normalizePermissions(role.permissions)
  if (legacyContractPermission && !stored.includes(legacyContractPermission)) stored.push(legacyContractPermission)
  return stored
}

/** Resolves a role definition. Callers must validate the actor's binding before applying it. */
export function resolveRolePermissions(
  settings: unknown,
  role: { id: string; code: string; permissions: unknown },
): { permissions: string[]; overridden: boolean } {
  if (role.code === 'SUPER_ADMIN') return { permissions: ['*'], overridden: false }
  if (isRetiredRoleCode(role.code)) return { permissions: [], overridden: true }
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
