import { beforeEach, expect, it, vi } from 'vitest'
import {
  loadEmployeeOrganizationPermissionDecision, ORGANIZATION_ACTIONS_HEADER,
  readOrganizationPermissionDecision, resolveOrganizationPermissionDecision,
  type OrganizationEmployeePermissionKey,
} from './employee-organization-permissions'
import type { EmployeePermissionOverride } from '@/lib/shipping/employee-permission-scope'

const mocks = vi.hoisted(() => ({ overrides: vi.fn(), select: vi.fn() }))
vi.mock('@/lib/middleware-rest-client', () => ({
  readMiddlewareRpcRows: mocks.overrides,
  createMiddlewareRestClient: () => ({ selectRows: mocks.select }),
}))

const deny = { effect: 'DENY', scope: null } as const
const allow = { effect: 'ALLOW', scope: { type: 'org' } } as const
const input = { orgId: 'org', userId: 'employee', settings: { employee_organization_permission_overrides_enabled: true } }
function deltas(...items: [OrganizationEmployeePermissionKey, EmployeePermissionOverride][]) {
  return new Map(items)
}

beforeEach(() => {
  vi.resetAllMocks()
})

it.each(['org:write', 'user:*', '*'])('overrides inherited %s per action without changing unrelated actions', grant => {
  const base = resolveOrganizationPermissionDecision([grant])
  expect(base['user:manage_login']).toBe(true)
  expect(resolveOrganizationPermissionDecision([grant], deltas(['user:manage_login', deny]))).toMatchObject({
    'user:view': true, 'user:manage_login': false, 'user:manage_employment': true,
  })
})

it('recomputes dependent member, role and department decisions when a directory grant is removed', () => {
  expect(resolveOrganizationPermissionDecision(
    ['user:*', 'role:view', 'dept:delete_structure'],
    deltas(['user:view', deny], ['role:view', allow]),
  )).toMatchObject({
    'user:view': false, 'user:invite': false, 'role:view': false, 'dept:directory_view': false,
  })
  expect(resolveOrganizationPermissionDecision(
    ['org:write', 'user:view', 'role:view'],
    deltas(['dept:directory_view', deny], ['dept:delete_structure', allow]),
  )).toMatchObject({
    'user:view': true, 'role:view': true, 'dept:directory_view': false,
    'dept:edit_structure': false, 'dept:delete_structure': false,
  })
})

it('allows per-person grants without a role only when their dependencies are effective', () => {
  expect(resolveOrganizationPermissionDecision([], deltas(['user:manage_login', allow]))['user:manage_login']).toBe(false)
  expect(resolveOrganizationPermissionDecision([], deltas(
    ['user:view', allow], ['user:manage_login', allow], ['role:view', allow],
  ))).toMatchObject({
    'user:view': true, 'user:manage_login': true, 'user:manage_employment': false, 'role:view': true,
    'dept:directory_view': false,
  })
})

it('rejects partial or malformed trusted organization decision projections', () => {
  const decision = resolveOrganizationPermissionDecision([])
  expect(readOrganizationPermissionDecision(new Headers({ [ORGANIZATION_ACTIONS_HEADER]: JSON.stringify(decision) })))
    .toEqual(decision)
  expect(readOrganizationPermissionDecision(new Headers({ [ORGANIZATION_ACTIONS_HEADER]: '{"user:view":true}' }))).toBeNull()
  expect(readOrganizationPermissionDecision(new Headers({ [ORGANIZATION_ACTIONS_HEADER]: 'invalid' }))).toBeNull()
})

it('loads only the current sparse overrides, retaining an explicit revoke when a point is unpublished', async () => {
  mocks.overrides.mockResolvedValue([
    { permission_code: 'shipping:ledger_view', ...allow },
    { permission_code: 'user:view', ...allow },
    { permission_code: 'user:manage_login', ...deny },
  ])
  mocks.select.mockResolvedValue([])
  expect(await loadEmployeeOrganizationPermissionDecision(['org:write'], input))
    .toMatchObject({ 'user:view': true, 'user:manage_login': false })
  expect((await loadEmployeeOrganizationPermissionDecision([], input))?.['user:view']).toBe(false)
  const userViewPoint = {
    code: 'user:view', resource: 'user', action: 'view', capability_level: 'L3',
    enforcement_consumer: 'lib/permissions.ts#canAccessOrgAdmin', dependencies: [],
    supported_scope_types: ['org'], grant_subject_types: ['role'],
  }
  mocks.select.mockResolvedValue([{ ...userViewPoint, enforcement_consumer: 'unrelated consumer' }])
  expect((await loadEmployeeOrganizationPermissionDecision([], input))?.['user:view']).toBe(false)
  mocks.select.mockResolvedValue([userViewPoint])
  expect((await loadEmployeeOrganizationPermissionDecision([], input))?.['user:view']).toBe(true)
  expect(mocks.overrides).toHaveBeenCalledWith('employee_permission_overrides_v1', { p_org_id: 'org', p_user_id: 'employee' })
})

it('does not load sparse org rows for fixed system administrators and rejects a corrupted scope', async () => {
  await expect(loadEmployeeOrganizationPermissionDecision(['*'], { ...input, systemAdministrator: true })).resolves.toBeNull()
  expect(mocks.overrides).not.toHaveBeenCalled()
  mocks.overrides.mockResolvedValue([{ permission_code: 'user:view', effect: 'ALLOW', scope: { type: 'self' } }])
  await expect(loadEmployeeOrganizationPermissionDecision([], input)).rejects.toThrow('Invalid employee organization permission override')
})
