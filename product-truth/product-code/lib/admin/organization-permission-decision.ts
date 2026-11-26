import {
  canAccessOrgAdmin, canReadRoleDirectory, hasLegacyDepartmentStructureWrite, hasLegacyOrgMemberWrite,
  hasOrgDepartmentDirectoryPermission, hasPermission, ORG_DEPARTMENT_DIRECTORY_VIEW,
  ORG_DEPARTMENT_STRUCTURE_DELETE, ORG_DEPARTMENT_STRUCTURE_EDIT, ORG_MEMBER_EDIT, ROLE_DIRECTORY_VIEW,
} from '@/lib/permissions'
import type { EmployeePermissionOverride } from '@/lib/shipping/employee-permission-scope'
import { ORG_MEMBER_LIFECYCLE_ACTIONS } from './member-action-keys'

export const organizationEmployeePermissionKeys = [
  'user:view', ORG_MEMBER_EDIT, ...ORG_MEMBER_LIFECYCLE_ACTIONS,
  ORG_DEPARTMENT_DIRECTORY_VIEW, ORG_DEPARTMENT_STRUCTURE_EDIT, ORG_DEPARTMENT_STRUCTURE_DELETE,
  ROLE_DIRECTORY_VIEW,
] as const

export type OrganizationEmployeePermissionKey = typeof organizationEmployeePermissionKeys[number]
export type OrganizationPermissionDecision = Readonly<Record<OrganizationEmployeePermissionKey, boolean>>
export type OrganizationOverrides = ReadonlyMap<OrganizationEmployeePermissionKey, EmployeePermissionOverride>

export const ORGANIZATION_ACTIONS_HEADER = 'x-user-organization-actions'

export function isOrganizationEmployeePermissionKey(key: string): key is OrganizationEmployeePermissionKey {
  return organizationEmployeePermissionKeys.some(point => point === key)
}

export function resolveOrganizationPermissionDecision(
  permissions: string[], overrides?: OrganizationOverrides,
): OrganizationPermissionDecision {
  function pick(key: OrganizationEmployeePermissionKey, base: boolean) {
    const override = overrides?.get(key)
    return override ? override.effect === 'ALLOW' : base
  }

  const baseMemberView = canAccessOrgAdmin(permissions)
  const memberView = pick('user:view', baseMemberView)
  const legacyMemberWrite = hasLegacyOrgMemberWrite(permissions)
  const memberAction = (key: OrganizationEmployeePermissionKey) => {
    const granted = pick(key, legacyMemberWrite || hasPermission(permissions, key))
    // A person's own setting is evaluated against their final prerequisite.
    // Leave pre-existing unmodified legacy action grants as the route sees them.
    return overrides?.has(key) || overrides?.has('user:view') ? memberView && granted : granted
  }

  const legacyDepartmentWrite = hasLegacyDepartmentStructureWrite(permissions)
  const directlyViewDepartment = hasOrgDepartmentDirectoryPermission(permissions)
  const departmentView = pick(ORG_DEPARTMENT_DIRECTORY_VIEW, directlyViewDepartment || legacyDepartmentWrite
    || (baseMemberView && memberView))
  const departmentControlView = pick(ORG_DEPARTMENT_DIRECTORY_VIEW, directlyViewDepartment)
  const departmentAction = (key: OrganizationEmployeePermissionKey) => departmentView
    && pick(key, legacyDepartmentWrite || (departmentControlView && hasPermission(permissions, key)))
  const roleView = pick(ROLE_DIRECTORY_VIEW, canReadRoleDirectory(permissions)
    || (overrides?.has('user:view') === true && memberView && hasPermission(permissions, ROLE_DIRECTORY_VIEW)))

  return {
    'user:view': memberView,
    [ORG_MEMBER_EDIT]: memberAction(ORG_MEMBER_EDIT),
    'user:invite': memberAction('user:invite'),
    'user:manage_login': memberAction('user:manage_login'),
    'user:manage_employment': memberAction('user:manage_employment'),
    'user:remove_membership': memberAction('user:remove_membership'),
    [ORG_DEPARTMENT_DIRECTORY_VIEW]: departmentView,
    [ORG_DEPARTMENT_STRUCTURE_EDIT]: departmentAction(ORG_DEPARTMENT_STRUCTURE_EDIT),
    [ORG_DEPARTMENT_STRUCTURE_DELETE]: departmentAction(ORG_DEPARTMENT_STRUCTURE_DELETE),
    [ROLE_DIRECTORY_VIEW]: overrides?.has(ROLE_DIRECTORY_VIEW) || overrides?.has('user:view') ? memberView && roleView : roleView,
  }
}

export function readOrganizationPermissionDecision(headers: Pick<Headers, 'get'>): OrganizationPermissionDecision | null {
  const value = headers.get(ORGANIZATION_ACTIONS_HEADER)
  if (!value) return null
  try {
    const decision = JSON.parse(value) as Record<string, unknown> | null
    if (!decision || Object.keys(decision).length !== organizationEmployeePermissionKeys.length
      || !organizationEmployeePermissionKeys.every(key => typeof decision[key] === 'boolean')) return null
    return decision as OrganizationPermissionDecision
  } catch {
    return null
  }
}
