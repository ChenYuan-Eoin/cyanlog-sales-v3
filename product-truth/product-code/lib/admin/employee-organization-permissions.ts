import { createMiddlewareRestClient, readMiddlewareRpcRows } from '@/lib/middleware-rest-client'
import { BUILTIN_PERMISSION_DEFINITIONS } from '@/lib/permission-catalog'
import type { EmployeePermissionOverride } from '@/lib/shipping/employee-permission-scope'
import {
  isOrganizationEmployeePermissionKey, resolveOrganizationPermissionDecision,
  type OrganizationEmployeePermissionKey, type OrganizationOverrides, type OrganizationPermissionDecision,
} from './organization-permission-decision'

export * from './organization-permission-decision'

const organizationDefinitions = new Map(BUILTIN_PERMISSION_DEFINITIONS
  .filter(point => isOrganizationEmployeePermissionKey(point.key)).map(point => [point.key, point]))

export function isPublishedOrganizationEmployeePermission(point: {
  key: string; status: string; kind: string; category: string; moduleKey: string | null;
  resource: string; action: string; capabilityLevel: string | null; enforcementConsumer: string | null;
  scopeTypes: string[]; grantSubjectTypes: string[]; dependencies: string[];
}) {
  const expected = organizationDefinitions.get(point.key)
  if (!expected || point.status !== 'published' || point.kind !== 'atomic' || point.category !== 'org'
    || point.moduleKey !== 'config' || point.resource !== expected.resource || point.action !== expected.action
    || point.capabilityLevel !== expected.capabilityLevel || point.enforcementConsumer !== expected.enforcementConsumer
    || !Array.isArray(point.grantSubjectTypes) || !point.grantSubjectTypes.includes('role')
    || !Array.isArray(point.dependencies) || point.dependencies.length !== expected.dependencies.length
    || !expected.dependencies.every((dependency, index) => point.dependencies[index] === dependency)
    || !Array.isArray(point.scopeTypes)) return false
  return (point.scopeTypes.length === 1 && point.scopeTypes[0] === 'org')
    || (point.key === 'user:view' && point.scopeTypes.length === 4
      && ['org', 'department', 'space', 'self'].every(scope => point.scopeTypes.includes(scope)))
}

type EmployeeOverrideRow = { permission_code?: unknown; effect?: unknown; scope?: { type?: unknown } | null }

export function readEmployeeOrganizationPermissionOverrides(rows: EmployeeOverrideRow[]): OrganizationOverrides {
  const result = new Map<OrganizationEmployeePermissionKey, EmployeePermissionOverride>()
  for (const row of rows) {
    if (typeof row?.permission_code !== 'string') throw new Error('Invalid employee permission row')
    const key = row.permission_code
    if (!isOrganizationEmployeePermissionKey(key)) continue
    if (result.has(key)) throw new Error('Duplicate employee organization permission row')
    if (row.effect === 'DENY' && row.scope === null) {
      result.set(key, { effect: 'DENY', scope: null })
    } else if (row.effect === 'ALLOW' && row.scope?.type === 'org' && Object.keys(row.scope).length === 1) {
      result.set(key, { effect: 'ALLOW', scope: { type: 'org' } })
    } else {
      throw new Error('Invalid employee organization permission override')
    }
  }
  return result
}

export async function loadEmployeeOrganizationPermissionOverrides(orgId: string, userId: string): Promise<OrganizationOverrides> {
  const rows = await readMiddlewareRpcRows<EmployeeOverrideRow>(
    'employee_permission_overrides_v1', { p_org_id: orgId, p_user_id: userId },
  )
  return readEmployeeOrganizationPermissionOverrides(rows)
}

export async function loadEmployeeOrganizationPermissionDecision(
  permissions: string[], input: { orgId: string; userId: string; settings: unknown; systemAdministrator?: boolean },
): Promise<OrganizationPermissionDecision | null> {
  const settings = input.settings as { employee_organization_permission_overrides_enabled?: unknown } | null
  if (input.systemAdministrator || settings?.employee_organization_permission_overrides_enabled !== true) return null
  const overrides = await loadEmployeeOrganizationPermissionOverrides(input.orgId, input.userId)
  if (!overrides.size) return null
  if (![...overrides.values()].some(override => override.effect === 'ALLOW')) {
    return resolveOrganizationPermissionDecision(permissions, overrides)
  }
  const points = await createMiddlewareRestClient().selectRows<{
    code: string; resource: string; action: string; capability_level: string | null; enforcement_consumer: string | null;
    supported_scope_types: string[]; grant_subject_types: string[]; dependencies: string[];
  }>('permission_points', { status: 'published', kind: 'atomic', category: 'org', module_key: 'config' },
    'code,resource,action,capability_level,enforcement_consumer,supported_scope_types,grant_subject_types,dependencies', 100)
  const published = new Set(points.filter(point => isPublishedOrganizationEmployeePermission({
    key: point.code, status: 'published', kind: 'atomic', category: 'org', moduleKey: 'config',
    resource: point.resource, action: point.action, capabilityLevel: point.capability_level,
    enforcementConsumer: point.enforcement_consumer, scopeTypes: point.supported_scope_types,
    grantSubjectTypes: point.grant_subject_types, dependencies: point.dependencies,
  })).map(point => point.code))
  return resolveOrganizationPermissionDecision(permissions, selectActiveOrganizationOverrides(overrides, published))
}

export function selectActiveOrganizationOverrides(overrides: OrganizationOverrides, published: ReadonlySet<string>): OrganizationOverrides {
  return new Map([...overrides].filter(([key, override]) => override.effect === 'DENY' || published.has(key)))
}
