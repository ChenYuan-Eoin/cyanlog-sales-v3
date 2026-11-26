import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { isSystemAuthorizationGrant } from '@/lib/permissions'
import { FXIAOKE_BASELINE_ROLE_CODE, ORG_SUPER_ADMIN_ROLE_CODE } from '@/lib/role-permission-resolution'
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
  const enterpriseLogin = organizationRoles.some(({ roleCode, permissions }) => isSystemAuthorizationGrant(roleCode, permissions))
  const permissions = new Set(organizationRoles
    .filter(({ roleCode }) => roleCode !== 'SUPER_ADMIN' && roleCode !== ORG_SUPER_ADMIN_ROLE_CODE && roleCode !== FXIAOKE_BASELINE_ROLE_CODE)
    .flatMap(assignment => assignment.permissions))
  const connect = enterpriseLogin || permissions.has('org:source_connect')
  const preview = enterpriseLogin || permissions.has('org:source_preview')
  const apply = enterpriseLogin || permissions.has('org:source_apply')
  // CRM bridge setup accepts these stored organization grants on its metadata endpoint.
  const canInspectCrmMetadata = enterpriseLogin || ['admin:access', 'org:write', 'user:write'].some(key => permissions.has(key))

  return {
    view: connect || preview || apply || permissions.has('org:source_view'),
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
