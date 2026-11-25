import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { hasOrganizationSourcePermission, hasPermission } from '@/lib/permissions'
import { ORG_SUPER_ADMIN_ROLE_CODE } from '@/lib/role-permission-resolution'
import {
  getFreshDefaultOrgId,
  getFreshUserScopedRoleAssignments,
  type ScopedRoleAssignment,
} from '@/lib/scoped-access'

export interface OrganizationSourceAccess {
  view: boolean
  connect: boolean
  preview: boolean
  apply: boolean
  enterpriseLogin: boolean
}

function evaluateOrganizationSourceAccess(
  assignments: ScopedRoleAssignment[],
  orgId: string,
): OrganizationSourceAccess & { canInspectCrmMetadata: boolean } {
  const organizationRoles = assignments.filter(assignment => assignment.scopeType === 'org' && assignment.scopeId === orgId)
  const permissions = organizationRoles.flatMap(assignment => assignment.permissions)
  const legacyRoles = organizationRoles.filter(assignment => !assignment.permissionsOverridden).map(assignment => assignment.roleCode)
  const protectedAdministrator = organizationRoles.some(assignment => (
    (assignment.roleCode === 'SUPER_ADMIN' || assignment.roleCode === ORG_SUPER_ADMIN_ROLE_CODE)
    && hasPermission(assignment.permissions, 'role:manage')
  ))
  const legacyAdministrator = legacyRoles.includes('ADMIN')
  const connect = protectedAdministrator || legacyAdministrator || hasPermission(permissions, 'org:source_connect')
  const preview = protectedAdministrator || legacyAdministrator || hasPermission(permissions, 'org:source_preview')
  const apply = protectedAdministrator || legacyAdministrator || hasPermission(permissions, 'org:source_apply')
  const enterpriseLogin = organizationRoles.some(assignment => assignment.roleCode === 'SUPER_ADMIN')
  // CRM bridge setup retains the legacy management grants. Directory and
  // member viewing grants do not authorize use of the CRM schema.
  const canInspectCrmMetadata = protectedAdministrator || legacyAdministrator || legacyRoles.includes('SALES_OPS')
    || ['admin:access', 'org:write', 'user:write'].some(key => hasPermission(permissions, key))

  return {
    view: protectedAdministrator || legacyAdministrator || enterpriseLogin || hasOrganizationSourcePermission(permissions),
    connect,
    preview,
    apply,
    enterpriseLogin,
    canInspectCrmMetadata,
  }
}

export async function loadOrganizationSourceAccess(req: NextRequest) {
  const actor = await requireAuth(req)
  const [orgId, assignments] = await Promise.all([
    req.headers.get('x-org-id')?.trim() || getFreshDefaultOrgId(actor.id),
    getFreshUserScopedRoleAssignments(actor.id),
  ])
  if (!orgId) return null

  const { canInspectCrmMetadata, ...access } = evaluateOrganizationSourceAccess(assignments, orgId)
  return { actor, orgId, access, canInspectCrmMetadata }
}
