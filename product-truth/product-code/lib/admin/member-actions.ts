import { canManageSystemAuthorizations, loadCurrentOrganizationRoleAssignments } from '@/lib/org-role-permissions'
import { ORG_DEPARTMENT_STRUCTURE_EDIT, ORG_MEMBER_EDIT } from '@/lib/permissions'
import {
  loadEmployeeOrganizationPermissionDecision, resolveOrganizationPermissionDecision, type OrganizationPermissionDecision,
} from './employee-organization-permissions'
import {
  ORG_MEMBER_INVITE, ORG_MEMBER_MANAGE_EMPLOYMENT, ORG_MEMBER_MANAGE_LOGIN, ORG_MEMBER_REMOVE_MEMBERSHIP,
} from './member-action-keys'

export function getMemberActionAvailability(decision: OrganizationPermissionDecision, assignRoles = false) {
  return {
    edit: decision[ORG_MEMBER_EDIT],
    assignRoles,
    invite: decision[ORG_MEMBER_INVITE],
    manageLogin: decision[ORG_MEMBER_MANAGE_LOGIN],
    manageEmployment: decision[ORG_MEMBER_MANAGE_EMPLOYMENT],
    removeMembership: decision[ORG_MEMBER_REMOVE_MEMBERSHIP],
    manageDepartments: decision[ORG_DEPARTMENT_STRUCTURE_EDIT],
    bindExternalIdentity: assignRoles,
  }
}

export type MemberActionAvailability = ReturnType<typeof getMemberActionAvailability>

/** Read the actor's exact current organization again before a privileged API action. */
export async function loadOrganizationPermissionAccess(userId: string) {
  const context = await loadCurrentOrganizationRoleAssignments(userId)
  if (!context) return null
  const { orgId, settings, assignments } = context
  const permissions = assignments
    .filter(assignment => assignment.scopeType === 'org' && assignment.scopeId === orgId)
    .flatMap(assignment => assignment.permissions)
  const systemAdministrator = canManageSystemAuthorizations(assignments, orgId)
  const decision = await loadEmployeeOrganizationPermissionDecision(permissions, { orgId, userId, settings, systemAdministrator })
    ?? resolveOrganizationPermissionDecision(permissions)
  return { orgId, assignments, systemAdministrator, decision }
}
