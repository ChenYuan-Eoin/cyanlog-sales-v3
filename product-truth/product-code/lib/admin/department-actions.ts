import {
  canReadOrgDepartmentDirectory,
  hasLegacyDepartmentStructureWrite,
  hasOrgDepartmentDirectoryPermission,
  hasPermission,
  ORG_DEPARTMENT_STRUCTURE_DELETE,
  ORG_DEPARTMENT_STRUCTURE_EDIT,
} from '@/lib/permissions'
import {
  getFreshDefaultOrgId,
  getFreshUserScopedRoleAssignments,
  getOrgPermissions,
  type ScopedRoleAssignment,
} from '@/lib/scoped-access'

export function evaluateDepartmentStructureAccess(permissions: string[]) {
  const legacyWrite = hasLegacyDepartmentStructureWrite(permissions)
  const hasDirectoryView = hasOrgDepartmentDirectoryPermission(permissions)
  return {
    canRead: canReadOrgDepartmentDirectory(permissions),
    canEdit: legacyWrite || (hasDirectoryView && hasPermission(permissions, ORG_DEPARTMENT_STRUCTURE_EDIT)),
    canDelete: legacyWrite || (hasDirectoryView && hasPermission(permissions, ORG_DEPARTMENT_STRUCTURE_DELETE)),
  }
}

export function getDepartmentStructureAccess(assignments: ScopedRoleAssignment[], orgId: string) {
  return evaluateDepartmentStructureAccess(getOrgPermissions(assignments, orgId))
}

export async function loadDepartmentStructureContext(userId: string) {
  const [orgId, assignments] = await Promise.all([
    getFreshDefaultOrgId(userId),
    getFreshUserScopedRoleAssignments(userId),
  ])
  return { orgId, ...getDepartmentStructureAccess(assignments, orgId) }
}
