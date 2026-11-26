import type { AuthUser } from '@/lib/auth'
import {
  loadEmployeeOrganizationPermissionOverrides, organizationEmployeePermissionKeys,
  resolveOrganizationPermissionDecision, selectActiveOrganizationOverrides,
} from '@/lib/admin/employee-organization-permissions'
import { hasConfigurationReadPermission, hasPermission } from '@/lib/permissions'
import {
  getEffectiveOwnerShippingPermissions, getEffectiveShippingPermissions, hasShippingPermission,
  SHIPPING_RECORD_RETURN, type ShippingPermissionKey,
} from '@/lib/module-access'
import { loadCurrentOrganizationRoleAssignments } from '@/lib/org-role-permissions'
import { loadRoleModulePermissionProjection, loadShippingModulePermissionState } from '@/lib/permission-registry'
import { supabaseAdmin } from '@/lib/supabase'
import { createMiddlewareRestClient } from '@/lib/middleware-rest-client'
import { DEPARTMENT_LEDGER_VIEW, loadAuthorizedLedgerDepartments, loadDepartmentLedgerScope, type LedgerDepartment } from './department-ledger-access'
import { isEmployeeTeamPermission, type EmployeePermissionScope } from './employee-permission-scope'
import { isShippingOwnerPermission } from './owner-permission-keys'
import {
  displayEmployeeTeamPermissionScope, effectiveEmployeeOwnerShippingPermissions, effectiveOrganizationShippingPermissions,
  employeeShippingPermissionKeys, hasEmployeeShippingOverrides, loadEmployeeShippingState, type EmployeeShippingPermissionRow,
} from './employee-permission-overrides'

type PublishedShippingAccess = {
  orgId: string
  returnRegistered?: boolean
  permissions: ShippingPermissionKey[]
  roleCodes: string[]
  ownerPermissions: string[]
  departmentLedger?: LedgerDepartment[]
  organizationLedgerDepartments?: LedgerDepartment[]
}

type DepartmentOptions = 'none' | 'scoped' | 'all'
type EmployeePermissionTableRow = Omit<EmployeeShippingPermissionRow, 'key'> & {
  key: string
  scope_types?: EmployeePermissionScope['type'][]
}

async function loadShippingAuthorization(userId: string) {
  const [context, publication] = await Promise.all([
    loadCurrentOrganizationRoleAssignments(userId), loadShippingModulePermissionState(),
  ])
  if (!context) return null
  const permissions = context.assignments.flatMap(assignment => assignment.permissions)
  const hasExplicitReturn = permissions.includes(SHIPPING_RECORD_RETURN)
    || context.assignments.some(assignment => assignment.roleCode === 'SUPER_ADMIN')
  const employee = !context.assignments.some(assignment => assignment.roleCode === 'SUPER_ADMIN')
    && hasEmployeeShippingOverrides(context.settings) ? await loadEmployeeShippingState(context.orgId, userId) : null
  return { context, publication, employee, permissions: effectiveOrganizationShippingPermissions(permissions, publication, employee)
    .filter(key => key !== SHIPPING_RECORD_RETURN || employee !== null || hasExplicitReturn) }
}

async function readLedgerDepartments(authorization: NonNullable<Awaited<ReturnType<typeof loadShippingAuthorization>>>, userId: string, organizationWide: boolean) {
  const { context, employee } = authorization
  const rest = createMiddlewareRestClient()
  return employee
    ? loadAuthorizedLedgerDepartments(rest, context.orgId, organizationWide ? undefined : employee.team[DEPARTMENT_LEDGER_VIEW].department_ids)
    : loadDepartmentLedgerScope(rest, context.orgId, userId, context.settings, organizationWide)
}

export async function loadPublishedShippingAccess(userId: string, departmentOptions: DepartmentOptions = 'none'): Promise<PublishedShippingAccess | null> {
  const authorization = await loadShippingAuthorization(userId)
  if (!authorization) return null
  const { context, publication, permissions, employee } = authorization
  const organizationWide = permissions.includes(DEPARTMENT_LEDGER_VIEW)
  const departments = departmentOptions !== 'none' && publication.departmentLedgerPublished
    && (!organizationWide || departmentOptions === 'all')
    ? await readLedgerDepartments(authorization, userId, organizationWide) : []
  return {
    orgId: context.orgId,
    returnRegistered: publication.registered.has(SHIPPING_RECORD_RETURN) || employee?.overrides.has(SHIPPING_RECORD_RETURN)
      || employee?.overrides.has(DEPARTMENT_LEDGER_VIEW),
    permissions,
    ownerPermissions: effectiveEmployeeOwnerShippingPermissions(
      context.assignments.flatMap(assignment => assignment.ownerShippingPermissions ?? []), publication, employee,
    ),
    roleCodes: context.assignments.map(assignment => assignment.roleCode),
    ...(departments.length ? organizationWide ? { organizationLedgerDepartments: departments } : { departmentLedger: departments } : {}),
  }
}

export async function loadShippingLedgerAccess(userId: string, filterByDepartment: boolean) {
  const authorization = await loadShippingAuthorization(userId)
  if (!authorization) return null
  const { context, publication, permissions, employee } = authorization
  const organizationWide = permissions.includes(DEPARTMENT_LEDGER_VIEW)
  const organizationReturn = employee ? organizationWide && permissions.includes(SHIPPING_RECORD_RETURN)
    : publication.registered.has(SHIPPING_RECORD_RETURN)
    ? permissions.includes(SHIPPING_RECORD_RETURN) : permissions.includes('shipping:record_review')
  const access = { orgId: context.orgId, organizationWide, organizationReturn, returnPublished: publication.published.has(SHIPPING_RECORD_RETURN) }
  if (organizationWide && !filterByDepartment) return { ...access, departments: [] }
  if (!publication.departmentLedgerPublished) return null
  const departments = await readLedgerDepartments(authorization, userId, organizationWide)
  return organizationWide || departments.length ? { ...access, departments } : null
}

function readOnlyOrganizationCapabilities(permissions: string[], systemAdministrator: boolean) {
  const sourceWrites = ['org:source_connect', 'org:source_preview', 'org:source_apply'] as const
  const viewSource = systemAdministrator || permissions.includes('org:source_view')
    || sourceWrites.some(key => permissions.includes(key))
  return {
    'config:read': hasConfigurationReadPermission(permissions),
    'config:write': hasPermission(permissions, 'config:write'),
    'config:publish': hasPermission(permissions, 'config:publish'),
    'org:source_view': viewSource,
    ...Object.fromEntries(sourceWrites.map(key => [key, systemAdministrator || permissions.includes(key)])),
  } as Record<string, boolean>
}

export async function loadEmployeePermissionTable(userId: string, orgId: string) {
  const [context, { publication, catalog, organizationEmployeePublication }] = await Promise.all([
    loadCurrentOrganizationRoleAssignments(userId), loadRoleModulePermissionProjection(),
  ])
  if (!context || context.orgId !== orgId) return null

  const protectedAccount = context.assignments.some(assignment => assignment.roleCode === 'SUPER_ADMIN')
  const [employee, availableDepartments, account, organizationOverrides] = await Promise.all([
    loadEmployeeShippingState(orgId, userId),
    loadAuthorizedLedgerDepartments(createMiddlewareRestClient(), orgId),
    supabaseAdmin.from('users').select('id,status,login_enabled').eq('id', userId).maybeSingle(),
    loadEmployeeOrganizationPermissionOverrides(orgId, userId),
  ])
  if (account.error) throw account.error
  if (!account.data || account.data.id !== userId || account.data.status !== 'active' || account.data.login_enabled !== true) return null
  const ownerGrants = context.assignments.flatMap(assignment => assignment.ownerShippingPermissions ?? [])
  const organizationGrants = context.assignments.flatMap(assignment => assignment.permissions)
  const baseOwner = getEffectiveOwnerShippingPermissions(ownerGrants, publication)
  const effectiveOwner = effectiveEmployeeOwnerShippingPermissions(ownerGrants, publication, protectedAccount ? null : employee)
  const baseOrganization = getEffectiveShippingPermissions(organizationGrants, publication)
  const effectiveOrganization = effectiveOrganizationShippingPermissions(organizationGrants, publication, protectedAccount ? null : employee)
  const permissions = employeeShippingPermissionKeys.map<EmployeeShippingPermissionRow>(key => {
    const override = protectedAccount ? null : employee.overrides.get(key) ?? null
    const can_edit = !protectedAccount && (publication.published.has(key) || override !== null)
    if (isShippingOwnerPermission(key)) {
      const base = baseOwner.includes(key)
      const effective = effectiveOwner.includes(key)
      const scope = { type: 'self' } as const
      return { key, base, effective, base_scope: base ? scope : null, effective_scope: effective ? scope : null, override, can_edit,
        sources: context.assignments.filter(assignment => base && assignment.ownerShippingPermissions?.includes(key))
          .map(assignment => ({ kind: 'role' as const, name: assignment.roleName })) }
    }
    if (!isEmployeeTeamPermission(key)) {
      const base = baseOrganization.includes(key)
      const effective = effectiveOrganization.includes(key)
      const scope = { type: 'org' } as const
      return { key, base, effective, base_scope: base ? scope : null, effective_scope: effective ? scope : null, override, can_edit,
        sources: context.assignments.filter(assignment => base && hasShippingPermission(assignment.permissions, key))
          .map(assignment => ({ kind: 'role' as const, name: assignment.roleName })) }
    }
    const scope = employee.team[key]
    const base_scope = displayEmployeeTeamPermissionScope(employee, key, true)
    const effective_scope = protectedAccount ? base_scope : displayEmployeeTeamPermissionScope(employee, key, false)
    return { key, base: base_scope !== null, effective: effective_scope !== null, base_scope, effective_scope, override, can_edit,
      sources: scope.base_sources ?? [] }
  })
  const publishedOrganizationSet = new Set(organizationEmployeePublication)
  const effectiveOrganizationOverrides = selectActiveOrganizationOverrides(organizationOverrides, publishedOrganizationSet)
  const baseOrganizationActions = resolveOrganizationPermissionDecision(organizationGrants)
  const organizationActions = protectedAccount ? baseOrganizationActions
    : resolveOrganizationPermissionDecision(organizationGrants, effectiveOrganizationOverrides)
  const readOnlyOrganizationActions = readOnlyOrganizationCapabilities(organizationGrants, protectedAccount)
  const readOnlySources = context.assignments.map(assignment => ({
    name: assignment.roleName,
    decision: readOnlyOrganizationCapabilities(assignment.permissions, assignment.roleCode === 'SUPER_ADMIN'),
  }))
  const orgScope = { type: 'org' } as const
  const scopeTypes: EmployeePermissionScope['type'][] = ['org']
  const organizationRows = organizationEmployeePermissionKeys.map<EmployeePermissionTableRow>(key => ({
    key,
    base: baseOrganizationActions[key],
    effective: organizationActions[key],
    base_scope: baseOrganizationActions[key] ? orgScope : null,
    effective_scope: organizationActions[key] ? orgScope : null,
    override: protectedAccount ? null : organizationOverrides.get(key) ?? null,
    can_edit: !protectedAccount && (publishedOrganizationSet.has(key) || organizationOverrides.has(key)),
    scope_types: scopeTypes,
    sources: context.assignments.filter(assignment => baseOrganizationActions[key]
      && resolveOrganizationPermissionDecision([
        ...assignment.permissions,
        ...(key === 'role:view' && baseOrganizationActions['user:view'] ? ['user:view'] : []),
        ...((key === 'dept:edit_structure' || key === 'dept:delete_structure')
          && baseOrganizationActions['dept:directory_view'] ? ['dept:directory_view'] : []),
      ])[key])
      .map(assignment => ({ kind: 'role' as const, name: assignment.roleName })),
  }))
  return {
    permissions: [...permissions, ...organizationRows, ...Object.entries(readOnlyOrganizationActions).map<EmployeePermissionTableRow>(([key, enabled]) => ({
      key, base: enabled, effective: enabled, base_scope: enabled ? orgScope : null, effective_scope: enabled ? orgScope : null,
      override: null, can_edit: false,
      sources: readOnlySources.filter(source => source.decision[key]).map(source => ({ kind: 'role', name: source.name })),
    }))],
    departments: availableDepartments.map(({ id, name, parentId }) => ({ id, name, parent_id: parentId })),
    permission_catalog: catalog,
    shipping_permission_publication: { registered: [...publication.registered], published: [...publication.published] },
    organization_permission_publication: organizationEmployeePublication,
  }
}

/** The caller has already verified the session and active account for this token. */
async function loadShippingSession(user: AuthUser, token: string | null, currentAccess?: PublishedShippingAccess, departmentOptions: DepartmentOptions = 'none') {
  if (!token) return null
  const [access, session] = await Promise.all([
    currentAccess ?? loadPublishedShippingAccess(user.id, departmentOptions),
    supabaseAdmin.from('auth_tokens').select('user_id,auth_method').eq('token', token)
      .eq('user_id', user.id).maybeSingle(),
  ])
  if (session.error) throw session.error
  if (!access || session.data?.user_id !== user.id) return null
  const ownerPermissions = session.data.auth_method === 'fxiaoke' && user.org_id === access.orgId
    ? access.ownerPermissions : []
  return {
    ...access,
    ownerPermissions,
    canReadLegacyReceipt: ownerPermissions.includes('shipping:owner_view')
      || access.permissions.includes('shipping:ledger_view'),
  }
}

export async function resolveShippingOwnerAccess(user: AuthUser, token: string | null) {
  const access = await loadShippingSession(user, token)
  if (!access) return null
  return {
    orgId: access.orgId,
    ownerPermissions: access.ownerPermissions,
    canReadLegacyReceipt: access.canReadLegacyReceipt,
  }
}

export async function resolveShippingEntry(user: AuthUser, token: string | null, currentAccess?: PublishedShippingAccess, includeOrganizationDepartments = false) {
  const access = await loadShippingSession(user, token, currentAccess, includeOrganizationDepartments ? 'all' : 'scoped')
  if (!access) return null
  return {
    orgId: access.orgId,
    canOperate: access.permissions.includes('shipping:ledger_view'),
    canViewOwn: access.ownerPermissions.includes('shipping:owner_view'),
    canReadLegacyReceipt: access.canReadLegacyReceipt,
    canSubmitOwn: access.ownerPermissions.includes('shipping:owner_submit'),
    canManageConnections: access.permissions.includes('shipping:settings_view'),
    permissions: access.permissions,
    ownerPermissions: access.ownerPermissions,
    ...(access.departmentLedger ? { departmentLedger: access.departmentLedger } : {}),
    ...(access.organizationLedgerDepartments ? { organizationLedgerDepartments: access.organizationLedgerDepartments } : {}),
  }
}
