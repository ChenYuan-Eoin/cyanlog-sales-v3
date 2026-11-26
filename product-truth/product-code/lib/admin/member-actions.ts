import { hasLegacyOrgMemberWrite, hasPermission, ORG_MEMBER_EDIT } from '@/lib/permissions'
import { canMutateOrgUsers, type ScopedRoleAssignment } from '@/lib/scoped-access'
import {
  ORG_MEMBER_INVITE, ORG_MEMBER_MANAGE_EMPLOYMENT, ORG_MEMBER_MANAGE_LOGIN,
  ORG_MEMBER_REMOVE_MEMBERSHIP, type ORG_MEMBER_LIFECYCLE_ACTIONS,
} from './member-action-keys'

type MemberAction =
  | typeof ORG_MEMBER_EDIT
  | typeof ORG_MEMBER_LIFECYCLE_ACTIONS[number]

export function getMemberActionAvailability(permissions: string[], roleCodes: string[], assignRoles = false) {
  const legacyWrite = hasLegacyOrgMemberWrite(permissions, roleCodes)
  return {
    edit: legacyWrite || hasPermission(permissions, ORG_MEMBER_EDIT),
    assignRoles,
    invite: legacyWrite || hasPermission(permissions, ORG_MEMBER_INVITE),
    manageLogin: legacyWrite || hasPermission(permissions, ORG_MEMBER_MANAGE_LOGIN),
    manageEmployment: legacyWrite || hasPermission(permissions, ORG_MEMBER_MANAGE_EMPLOYMENT),
    removeMembership: legacyWrite || hasPermission(permissions, ORG_MEMBER_REMOVE_MEMBERSHIP),
    manageDepartments: roleCodes.includes('SUPER_ADMIN') || roleCodes.includes('ADMIN')
      || hasPermission(permissions, 'dept:write') || hasPermission(permissions, 'org:write'),
    bindExternalIdentity: legacyWrite && roleCodes.includes('SUPER_ADMIN'),
  }
}

export type MemberActionAvailability = ReturnType<typeof getMemberActionAvailability>

export function getScopedMemberActionAvailability(assignments: ScopedRoleAssignment[], orgId: string, assignRoles = false): MemberActionAvailability {
  const organizationRoles = assignments.filter(assignment => assignment.scopeType === 'org' && assignment.scopeId === orgId)
  return getMemberActionAvailability(
    organizationRoles.flatMap(assignment => assignment.permissions ?? []),
    organizationRoles.filter(assignment => !assignment.permissionsOverridden).map(assignment => assignment.roleCode),
    assignRoles,
  )
}

/** Older administrator grants remain valid while explicit actions are configured. */
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
