import { hasLegacyDepartmentStructureWrite, hasLegacyOrgMemberWrite, hasPermission, ORG_MEMBER_EDIT } from '@/lib/permissions'
import { canMutateOrgUsers, type ScopedRoleAssignment } from '@/lib/scoped-access'
import {
  ORG_MEMBER_INVITE, ORG_MEMBER_MANAGE_EMPLOYMENT, ORG_MEMBER_MANAGE_LOGIN,
  ORG_MEMBER_REMOVE_MEMBERSHIP, type ORG_MEMBER_LIFECYCLE_ACTIONS,
} from './member-action-keys'

type MemberAction =
  | typeof ORG_MEMBER_EDIT
  | typeof ORG_MEMBER_LIFECYCLE_ACTIONS[number]

export function getMemberActionAvailability(permissions: string[], assignRoles = false) {
  const legacyWrite = hasLegacyOrgMemberWrite(permissions)
  return {
    edit: legacyWrite || hasPermission(permissions, ORG_MEMBER_EDIT),
    assignRoles,
    invite: legacyWrite || hasPermission(permissions, ORG_MEMBER_INVITE),
    manageLogin: legacyWrite || hasPermission(permissions, ORG_MEMBER_MANAGE_LOGIN),
    manageEmployment: legacyWrite || hasPermission(permissions, ORG_MEMBER_MANAGE_EMPLOYMENT),
    removeMembership: legacyWrite || hasPermission(permissions, ORG_MEMBER_REMOVE_MEMBERSHIP),
    manageDepartments: hasLegacyDepartmentStructureWrite(permissions),
    bindExternalIdentity: assignRoles,
  }
}

export type MemberActionAvailability = ReturnType<typeof getMemberActionAvailability>

export function getScopedMemberActionAvailability(assignments: ScopedRoleAssignment[], orgId: string, assignRoles = false): MemberActionAvailability {
  const organizationRoles = assignments.filter(assignment => assignment.scopeType === 'org' && assignment.scopeId === orgId)
  return getMemberActionAvailability(
    organizationRoles.flatMap(assignment => assignment.permissions ?? []),
    assignRoles,
  )
}

/** Explicit legacy write keys remain supported alongside individual member actions. */
export function canPerformMemberAction(
  assignments: ScopedRoleAssignment[],
  orgId: string,
  action: MemberAction,
): boolean {
  return canMutateOrgUsers(assignments, orgId) || assignments.some(assignment =>
    assignment.scopeType === 'org' && assignment.scopeId === orgId
    && hasPermission(assignment.permissions ?? [], action)
  )
}
