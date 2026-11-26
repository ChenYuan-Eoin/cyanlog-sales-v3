import type { AuthUser } from '@/lib/auth'
import {
  getEffectiveOwnerShippingPermissions, getEffectiveShippingPermissions,
} from '@/lib/module-access'
import { loadCurrentOrganizationRoleAssignments } from '@/lib/org-role-permissions'
import { loadShippingModulePermissionState } from '@/lib/permission-registry'
import { supabaseAdmin } from '@/lib/supabase'
import { createMiddlewareRestClient } from '@/lib/middleware-rest-client'
import { DEPARTMENT_LEDGER_VIEW, loadDepartmentLedgerScope, type LedgerDepartment } from './department-ledger-access'

type PublishedShippingAccess = {
  orgId: string
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
  return { context, publication, permissions: getEffectiveShippingPermissions(permissions, publication) }
}

export async function loadPublishedShippingAccess(userId: string, departmentOptions: DepartmentOptions = 'none'): Promise<PublishedShippingAccess | null> {
  const authorization = await loadShippingAuthorization(userId)
  if (!authorization) return null
  const { context, publication, permissions } = authorization
  const organizationWide = permissions.includes(DEPARTMENT_LEDGER_VIEW)
  const departments = departmentOptions !== 'none' && publication.departmentLedgerPublished
    && (!organizationWide || departmentOptions === 'all')
    ? await loadDepartmentLedgerScope(createMiddlewareRestClient(), context.orgId, userId, context.settings, organizationWide) : []
  return {
    orgId: context.orgId,
    permissions,
    ownerPermissions: getEffectiveOwnerShippingPermissions(
      context.assignments.flatMap(assignment => assignment.ownerShippingPermissions ?? []), publication,
    ),
    roleCodes: context.assignments.map(assignment => assignment.roleCode),
    ...(departments.length ? organizationWide ? { organizationLedgerDepartments: departments } : { departmentLedger: departments } : {}),
  }
}

export async function loadShippingLedgerAccess(userId: string, filterByDepartment: boolean) {
  const authorization = await loadShippingAuthorization(userId)
  if (!authorization) return null
  const { context, publication, permissions } = authorization
  const organizationWide = permissions.includes(DEPARTMENT_LEDGER_VIEW)
  if (organizationWide && !filterByDepartment) return { orgId: context.orgId, organizationWide, departments: [] }
  if (!publication.departmentLedgerPublished) return null
  const departments = await loadDepartmentLedgerScope(
    createMiddlewareRestClient(), context.orgId, userId, context.settings, organizationWide,
  )
  return organizationWide || departments.length ? { orgId: context.orgId, organizationWide, departments } : null
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
