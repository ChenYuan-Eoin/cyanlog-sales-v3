import { SHIPPING_RECORD_RETURN, SHIPPING_SETTINGS_ACTION_KEYS, SHIPPING_WORKBENCH_ACTION_KEYS } from '@/lib/module-access'
import { isShippingOwnerPermission, SHIPPING_OWNER_ACTION_KEYS } from './owner-permission-keys'

export const employeeTeamPermissionKeys = ['shipping:ledger_view', SHIPPING_RECORD_RETURN] as const
export const employeeOrganizationPermissionKeys = [
  ...SHIPPING_WORKBENCH_ACTION_KEYS.filter(key => key !== 'shipping:ledger_view' && key !== SHIPPING_RECORD_RETURN),
  ...SHIPPING_SETTINGS_ACTION_KEYS,
] as const
export const employeeShippingPermissionKeys = [
  ...employeeTeamPermissionKeys, ...SHIPPING_OWNER_ACTION_KEYS, ...employeeOrganizationPermissionKeys,
] as const

export type EmployeeTeamPermissionKey = typeof employeeTeamPermissionKeys[number]
export type EmployeeShippingPermissionKey = typeof employeeShippingPermissionKeys[number]
export type EmployeePermissionScope =
  | { type: 'self' }
  | { type: 'org' }
  | { type: 'department'; departments: readonly { department_id: string; include_subdepartments: boolean }[] }
export type EmployeePermissionOverride =
  | { effect: 'ALLOW'; scope: EmployeePermissionScope }
  | { effect: 'DENY'; scope: null }

export function isEmployeeTeamPermission(key: string): key is EmployeeTeamPermissionKey {
  return employeeTeamPermissionKeys.some(permission => permission === key)
}

export function employeePermissionAllowsScope(key: string, scopeType: EmployeePermissionScope['type']): boolean {
  if (isShippingOwnerPermission(key)) return scopeType === 'self'
  if (isEmployeeTeamPermission(key)) return scopeType === 'org' || scopeType === 'department'
  return scopeType === 'org' && employeeOrganizationPermissionKeys.some(permission => permission === key)
}
