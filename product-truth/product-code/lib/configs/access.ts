import { hasPermission } from '@/lib/permissions'
import {
  getFreshUserScopedRoleAssignments,
  getUserScopedRoleAssignments,
  type ScopedRoleAssignment,
} from '@/lib/scoped-access'

export type OrgConfigAccess = 'read' | 'write' | 'publish'

export interface OrgConfigAccessDecision {
  canRead: boolean
  canWrite: boolean
  canPublish: boolean
}

const CONFIG_READ_PERMISSIONS = [
  'config:read',
  'config:write',
  'config:publish',
] as const

const CONFIG_WRITE_PERMISSIONS = [
  'config:write',
] as const

const CONFIG_PUBLISH_PERMISSIONS = [
  'config:publish',
] as const

function getExactOrgPermissions(
  assignments: ScopedRoleAssignment[],
  orgId: string
): string[] {
  return Array.from(new Set(
    assignments
      .filter((assignment) => (
        assignment.scopeType === 'org'
        && assignment.scopeId === orgId
      ))
      .flatMap((assignment) => assignment.permissions)
  ))
}

function hasAnyPermission(
  permissions: string[],
  requiredPermissions: readonly string[]
): boolean {
  return requiredPermissions.some((required) => hasPermission(permissions, required))
}

export function evaluateOrgConfigAccess(
  assignments: ScopedRoleAssignment[],
  orgId: string
): OrgConfigAccessDecision {
  const permissions = getExactOrgPermissions(assignments, orgId)

  return {
    canRead: hasAnyPermission(permissions, CONFIG_READ_PERMISSIONS),
    canWrite: hasAnyPermission(permissions, CONFIG_WRITE_PERMISSIONS),
    canPublish: hasAnyPermission(permissions, CONFIG_PUBLISH_PERMISSIONS),
  }
}

export async function getUserOrgConfigAccess(
  userId: string,
  orgId: string
): Promise<OrgConfigAccessDecision> {
  const assignments = await getUserScopedRoleAssignments(userId)
  return evaluateOrgConfigAccess(assignments, orgId)
}

export async function userHasOrgConfigAccess(
  userId: string,
  orgId: string,
  requiredAccess: OrgConfigAccess
): Promise<boolean> {
  const decision = await getUserOrgConfigAccess(userId, orgId)
  if (requiredAccess === 'read') return decision.canRead
  if (requiredAccess === 'write') return decision.canWrite
  return decision.canPublish
}

export async function userHasFreshOrgConfigAccess(
  userId: string,
  orgId: string,
  requiredAccess: OrgConfigAccess
): Promise<boolean> {
  const assignments = await getFreshUserScopedRoleAssignments(userId)
  const decision = evaluateOrgConfigAccess(assignments, orgId)
  if (requiredAccess === 'read') return decision.canRead
  if (requiredAccess === 'write') return decision.canWrite
  return decision.canPublish
}
