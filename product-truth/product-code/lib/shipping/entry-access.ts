import type { AuthUser } from '@/lib/auth'
import {
  getEffectiveOwnerShippingPermissions, SHIPPING_RECORD_RETURN,
} from '@/lib/module-access'
import { loadCurrentOrganizationRoleAssignments } from '@/lib/org-role-permissions'
import { loadRoleModulePermissionProjection, loadShippingModulePermissionState } from '@/lib/permission-registry'
import { supabaseAdmin } from '@/lib/supabase'
import { createMiddlewareRestClient } from '@/lib/middleware-rest-client'
import { DEPARTMENT_LEDGER_VIEW, loadAuthorizedLedgerDepartments, loadDepartmentLedgerScope, type LedgerDepartment } from './department-ledger-access'
import {
  displayEmployeeTeamPermissionScope, effectiveEmployeeOwnerShippingPermissions, effectiveOrganizationShippingPermissions,
  employeeShippingPermissionKeys, hasEmployeeShippingOverrides, loadEmployeeShippingState, type EmployeeShippingPermissionRow,
} from './employee-permission-overrides'

type PublishedShippingAccess = {
  orgId: string
  returnRegistered?: boolean
  permissions: string[]
  roleCodes: string[]
  ownerPermissions: string[]
  departmentLedger?: LedgerDepartment[]
  organizationLedgerDepartments?: LedgerDepartment[]
}

type DepartmentOptions = 'none' | 'scoped' | 'all'

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

export async function loadEmployeeShippingPermissionTable(userId: string, orgId: string) {
  const [context, { publication, catalog }] = await Promise.all([
    loadCurrentOrganizationRoleAssignments(userId), loadRoleModulePermissionProjection(),
  ])
  if (!context || context.orgId !== orgId) return null

  const protectedAccount = context.assignments.some(assignment => assignment.roleCode === 'SUPER_ADMIN')
  const [employee, availableDepartments, account] = await Promise.all([
    loadEmployeeShippingState(orgId, userId),
    loadAuthorizedLedgerDepartments(createMiddlewareRestClient(), orgId),
    supabaseAdmin.from('users').select('id,status,login_enabled').eq('id', userId).maybeSingle(),
  ])
  if (account.error) throw account.error
  if (!account.data || account.data.id !== userId || account.data.status !== 'active' || account.data.login_enabled !== true) return null
  const ownerGrants = context.assignments.flatMap(assignment => assignment.ownerShippingPermissions ?? [])
  const permissions = employeeShippingPermissionKeys.map<EmployeeShippingPermissionRow>(key => {
    const override = protectedAccount ? null : employee.overrides.get(key) ?? null
    const can_edit = !protectedAccount && (publication.published.has(key) || override !== null)
    if (key === 'shipping:owner_view') {
      const base = getEffectiveOwnerShippingPermissions(ownerGrants, publication).includes(key)
      const effective = effectiveEmployeeOwnerShippingPermissions(ownerGrants, publication, protectedAccount ? null : employee).includes(key)
      const scope = { type: 'self' } as const
      return { key, base, effective, base_scope: base ? scope : null, effective_scope: effective ? scope : null, override, can_edit,
        sources: context.assignments.filter(assignment => assignment.ownerShippingPermissions?.includes(key))
          .map(assignment => ({ kind: 'role' as const, name: assignment.roleName })) }
    }
    const scope = employee.team[key]
    const base_scope = displayEmployeeTeamPermissionScope(employee, key, true)
    const effective_scope = protectedAccount ? base_scope : displayEmployeeTeamPermissionScope(employee, key, false)
    return { key, base: base_scope !== null, effective: effective_scope !== null, base_scope, effective_scope, override, can_edit,
      sources: scope.base_sources ?? [] }
  })
  return {
    permissions,
    departments: availableDepartments.map(({ id, name, parentId }) => ({ id, name, parent_id: parentId })),
    permission_catalog: catalog,
    shipping_permission_publication: { registered: [...publication.registered], published: [...publication.published] },
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
