import {
  ORG_DEPARTMENT_DIRECTORY_VIEW, ORG_DEPARTMENT_STRUCTURE_DELETE, ORG_DEPARTMENT_STRUCTURE_EDIT,
} from '@/lib/permissions'
import type { OrganizationPermissionDecision } from './employee-organization-permissions'
import { loadOrganizationPermissionAccess } from './member-actions'

export function evaluateDepartmentStructureAccess(decision: OrganizationPermissionDecision) {
  return {
    canRead: decision[ORG_DEPARTMENT_DIRECTORY_VIEW],
    canEdit: decision[ORG_DEPARTMENT_STRUCTURE_EDIT],
    canDelete: decision[ORG_DEPARTMENT_STRUCTURE_DELETE],
  }
}

export async function loadDepartmentStructureContext(userId: string) {
  const access = await loadOrganizationPermissionAccess(userId)
  return access ? {
    orgId: access.orgId,
    memberAccess: access.decision['user:view'],
    ...evaluateDepartmentStructureAccess(access.decision),
  } : null
}
