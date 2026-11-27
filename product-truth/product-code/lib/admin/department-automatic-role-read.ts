import type { MiddlewareRestClient } from '@/lib/middleware-rest-client'

export const DEPARTMENT_AUTOMATIC_ROLE_READ_RPC = 'department_automatic_role_sources_v1'

// Keep automatic assignments at their explicitly supported business actions.
// Organization administration and historical space access only use their existing grants.
const supportedPermissions = new Set(['dept:view', 'report:dept', 'shipping:ledger_view', 'shipping:record_return'])
const systemRoleCodes = new Set(['SUPER_ADMIN', 'ORG_SUPER_ADMIN', 'FXIAOKE_BASELINE'])

type AutomaticDepartmentGrant = {
  departmentId: string
  permissions: string[]
}

export function readDepartmentAutomaticRoleRows(value: unknown): AutomaticDepartmentGrant[] {
  if (!Array.isArray(value)) throw new Error('Invalid automatic department role response')
  return value.flatMap((row: unknown) => {
    if (!row || typeof row !== 'object') return []
    const { affiliation_department_id, role_code, permissions } = row as Record<string, unknown>
    if (typeof affiliation_department_id !== 'string' || !affiliation_department_id
      || typeof role_code !== 'string' || !role_code || systemRoleCodes.has(role_code)
      || !Array.isArray(permissions)) return []
    const effective = permissions.filter((permission): permission is string =>
      typeof permission === 'string' && supportedPermissions.has(permission))
    return effective.length ? [{ departmentId: affiliation_department_id, permissions: effective }] : []
  })
}

export async function loadDepartmentAutomaticRoleSources(rest: MiddlewareRestClient, orgId: string, userId: string) {
  try {
    return readDepartmentAutomaticRoleRows(await rest.readRpcRows(DEPARTMENT_AUTOMATIC_ROLE_READ_RPC, {
      p_org_id: orgId, p_user_id: userId,
    }))
  } catch (error) {
    // An older database has no explicit automatic role rules to apply.
    if (error instanceof Error
      && error.message === `auth middleware query failed: ${DEPARTMENT_AUTOMATIC_ROLE_READ_RPC} returned 404`) return []
    throw error
  }
}
