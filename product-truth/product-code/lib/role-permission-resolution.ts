import {
  ORGANIZATION_SOURCE_PERMISSION_KEYS, ORG_BUSINESS_ROLE_ASSIGN, ORG_DEPARTMENT_STRUCTURE_PERMISSION_KEYS, ORG_MEMBER_EDIT,
} from './permissions'
import { ORG_MEMBER_LIFECYCLE_ACTIONS } from './admin/member-action-keys'

export const ORG_SUPER_ADMIN_ROLE_CODE = 'ORG_SUPER_ADMIN'
export const SHIPPING_OPERATOR_ROLE_CODE = 'SHIPPING_OPERATOR'

export function isRoleAssignableInScope(code: string, scopeType: 'org' | 'department' | 'space'): boolean {
  return code !== SHIPPING_OPERATOR_ROLE_CODE || scopeType === 'org'
}

const ORG_SUPER_ADMIN_PERMISSIONS = [
  'admin:access', 'org:write', 'user:view', 'user:write', 'dept:view', 'dept:write',
  'config:read', 'config:write', 'config:publish', 'role:manage',
  ORG_MEMBER_EDIT, ORG_BUSINESS_ROLE_ASSIGN, ...ORG_MEMBER_LIFECYCLE_ACTIONS,
  ...ORG_DEPARTMENT_STRUCTURE_PERMISSION_KEYS, ...ORGANIZATION_SOURCE_PERMISSION_KEYS,
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
    ADMIN: ['admin:access', 'user:write', 'dept:write', 'contract:write', 'shipping:manage_connections', ...ORGANIZATION_SOURCE_PERMISSION_KEYS],
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
  if (role.code === 'FXIAOKE_BASELINE') {
    return { permissions: ['quote:view', 'contract:view', 'customer:view'], overridden: true }
  }
  if (role.code === ORG_SUPER_ADMIN_ROLE_CODE) {
    return { permissions: [...ORG_SUPER_ADMIN_PERMISSIONS], overridden: true }
  }
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
