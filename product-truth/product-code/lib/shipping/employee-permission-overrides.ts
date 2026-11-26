import { readMiddlewareRpcRows } from '@/lib/middleware-rest-client'
import {
  getEffectiveOwnerShippingPermissions, getEffectiveShippingPermissions, SHIPPING_OPERATE, SHIPPING_RECORD_RETURN, shippingActionViewDependency,
} from '@/lib/module-access'

export const employeeShippingPermissionKeys = ['shipping:ledger_view', SHIPPING_RECORD_RETURN, 'shipping:owner_view'] as const
export type EmployeeShippingPermissionKey = typeof employeeShippingPermissionKeys[number]
type TeamPermission = Exclude<EmployeeShippingPermissionKey, 'shipping:owner_view'>
export type EmployeePermissionScope =
  | { type: 'self' }
  | { type: 'org' }
  | { type: 'department'; departments: readonly { department_id: string; include_subdepartments: boolean }[] }
export type EmployeePermissionOverride =
  | { effect: 'ALLOW'; scope: EmployeePermissionScope }
  | { effect: 'DENY'; scope: null }

type PermissionSource = { kind: 'role' | 'department'; name: string }
export type EmployeeShippingPermissionRow = {
  key: EmployeeShippingPermissionKey
  base: boolean
  effective: boolean
  base_scope: EmployeePermissionScope | null
  effective_scope: EmployeePermissionScope | null
  override: EmployeePermissionOverride | null
  can_edit: boolean
  sources: PermissionSource[]
}
type TeamScope = {
  permission_code: TeamPermission
  base_organization_wide: boolean
  base_department_ids: string[]
  organization_wide: boolean
  department_ids: string[]
  base_sources?: PermissionSource[]
}
export type EmployeeShippingState = {
  overrides: ReadonlyMap<EmployeeShippingPermissionKey, EmployeePermissionOverride>
  team: Record<TeamPermission, TeamScope>
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readOverride(key: EmployeeShippingPermissionKey, row: Record<string, unknown>): EmployeePermissionOverride {
  if (row.effect === 'DENY' && row.scope === null) return { effect: 'DENY', scope: null }
  const scope = object(row.scope)
  if (row.effect === 'ALLOW' && scope) {
    if (key === 'shipping:owner_view' && scope.type === 'self') return { effect: 'ALLOW', scope: { type: 'self' } }
    if (key !== 'shipping:owner_view' && scope.type === 'org') return { effect: 'ALLOW', scope: { type: 'org' } }
    if (key !== 'shipping:owner_view' && scope.type === 'department' && Array.isArray(scope.departments) && scope.departments.length) {
      const departments = scope.departments.map(value => {
        const selection = object(value)
        if (typeof selection?.department_id !== 'string' || typeof selection.include_subdepartments !== 'boolean') {
          throw new Error('auth middleware invalid employee department override')
        }
        return { department_id: selection.department_id, include_subdepartments: selection.include_subdepartments }
      })
      return { effect: 'ALLOW', scope: { type: 'department', departments } }
    }
  }
  throw new Error('auth middleware invalid employee shipping override')
}

function readTeamScope(rows: TeamScope[], key: TeamPermission): TeamScope {
  const matches = rows.filter(row => row?.permission_code === key)
  const scope = matches[0]
  if (matches.length !== 1 || typeof scope?.organization_wide !== 'boolean' || typeof scope.base_organization_wide !== 'boolean'
    || !Array.isArray(scope.department_ids) || !scope.department_ids.every(id => typeof id === 'string')
    || !Array.isArray(scope.base_department_ids) || !scope.base_department_ids.every(id => typeof id === 'string')) {
    throw new Error('auth middleware invalid employee shipping scope')
  }
  return scope
}

export async function loadEmployeeShippingState(orgId: string, userId: string): Promise<EmployeeShippingState> {
  const args = { p_org_id: orgId, p_user_id: userId }
  const [rows, ranges] = await Promise.all([
    readMiddlewareRpcRows<unknown>('employee_permission_overrides_v1', args),
    readMiddlewareRpcRows<TeamScope>('shipping_employee_permission_scopes_v1', args),
  ])
  const overrides = new Map<EmployeeShippingPermissionKey, EmployeePermissionOverride>()
  for (const value of rows) {
    const row = object(value)
    if (!row || typeof row.permission_code !== 'string') throw new Error('auth middleware invalid employee permission row')
    const key = employeeShippingPermissionKeys.find(permission => permission === row.permission_code)
    if (!key) continue
    if (overrides.has(key)) throw new Error('auth middleware duplicate employee permission row')
    overrides.set(key, readOverride(key, row))
  }
  return { overrides, team: {
    'shipping:ledger_view': readTeamScope(ranges, 'shipping:ledger_view'),
    [SHIPPING_RECORD_RETURN]: readTeamScope(ranges, SHIPPING_RECORD_RETURN),
  } }
}

export function hasEmployeeShippingOverrides(settings: unknown): boolean {
  return object(settings)?.employee_permission_overrides_enabled === true
}

type ShippingPublication = Parameters<typeof getEffectiveShippingPermissions>[1]

export function effectiveOrganizationShippingPermissions(
  grants: readonly string[], publication: ShippingPublication, employee?: EmployeeShippingState | null,
) {
  if (!employee) return getEffectiveShippingPermissions(grants, publication)
  const ledger = employee.team['shipping:ledger_view'].organization_wide
  const returns = employee.team[SHIPPING_RECORD_RETURN].organization_wide
  const projection = getEffectiveShippingPermissions([
    ...grants,
    ...(ledger ? ['shipping:ledger_view'] : []),
    ...(returns ? [SHIPPING_RECORD_RETURN] : []),
  ], publication)
  return projection.filter(key => {
    if (key === 'shipping:ledger_view' || key === SHIPPING_OPERATE || shippingActionViewDependency(key) === 'shipping:ledger_view') {
      return ledger && (key !== SHIPPING_RECORD_RETURN || returns)
    }
    return true
  })
}

export function employeeOwnerShippingGrants(grants: readonly string[], employee?: EmployeeShippingState | null) {
  const override = employee?.overrides.get('shipping:owner_view')
  if (!override) return [...grants]
  return override.effect === 'ALLOW'
    ? [...new Set([...grants, 'shipping:owner_view'])]
    : grants.filter(key => key !== 'shipping:owner_view')
}

export function effectiveEmployeeOwnerShippingPermissions(
  grants: readonly string[], publication: Pick<ShippingPublication, 'published'>, employee?: EmployeeShippingState | null,
) {
  return getEffectiveOwnerShippingPermissions(employeeOwnerShippingGrants(grants, employee), publication)
}

export function displayTeamScope(wide: boolean, ids: string[]): EmployeePermissionScope | null {
  if (wide) return { type: 'org' }
  return ids.length ? { type: 'department', departments: ids.map(department_id => ({ department_id, include_subdepartments: false })) } : null
}

export function displayEmployeeTeamPermissionScope(state: EmployeeShippingState, key: TeamPermission, useBase: boolean) {
  const action = state.team[key]
  const wide = useBase ? action.base_organization_wide : action.organization_wide
  const ids = useBase ? action.base_department_ids : action.department_ids
  if (key === 'shipping:ledger_view') return displayTeamScope(wide, ids)

  const ledger = state.team['shipping:ledger_view']
  const ledgerWide = useBase ? ledger.base_organization_wide : ledger.organization_wide
  const ledgerIds = useBase ? ledger.base_department_ids : ledger.department_ids
  if (ledgerWide) return displayTeamScope(wide, ids)
  if (wide) return displayTeamScope(false, ledgerIds)
  const allowed = new Set(ledgerIds)
  return displayTeamScope(false, ids.filter(id => allowed.has(id)))
}
