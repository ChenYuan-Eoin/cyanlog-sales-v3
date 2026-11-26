import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { AuthError, requireAuth } from '@/lib/auth'
import { loadOrgRolePermissionContext } from '@/lib/org-role-permissions'
import { loadEmployeeShippingPermissionTable } from '@/lib/shipping/entry-access'
import { supabaseAdmin } from '@/lib/supabase'
import { GET, PATCH } from './route'

vi.mock('@/lib/auth', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
}))
vi.mock('@/lib/org-role-permissions', () => ({ loadOrgRolePermissionContext: vi.fn() }))
vi.mock('@/lib/shipping/entry-access', () => ({ loadEmployeeShippingPermissionTable: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc: vi.fn() } }))

const actorId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const otherOrgId = '44444444-4444-4444-8444-444444444444'
const departmentId = '55555555-5555-4555-8555-555555555555'
const childId = '66666666-6666-4666-8666-666666666666'
const path = `https://example.test/api/admin/users/${userId}/permission-overrides`
const url = `${path}?orgId=${orgId}`
const params = { params: Promise.resolve({ id: userId }) }
const point = 'shipping:ledger_view'
const orgScope = { type: 'org' } as const
const selfScope = { type: 'self' } as const
const departmentScope = { type: 'department' as const, departments: [
  { department_id: departmentId, include_subdepartments: true },
  { department_id: childId, include_subdepartments: false },
] }
const departmentOverride = { effect: 'ALLOW', scope: departmentScope } as const
const orgOverride = { effect: 'ALLOW', scope: orgScope } as const
const deny = { effect: 'DENY', scope: null } as const
const change = { permission_code: point, expected_override: orgOverride, override: departmentOverride }
const authority = { orgId, settings: {}, canRead: true, canEdit: true, canEditPlatformRoot: true, actorPermissions: ['*'] }

type Snapshot = NonNullable<Awaited<ReturnType<typeof loadEmployeeShippingPermissionTable>>>
type PermissionRow = Snapshot['permissions'][number]

function projection(
  overrides: Partial<Omit<PermissionRow, 'key'>> = {},
  published = true,
  key: PermissionRow['key'] = point,
): Snapshot {
  return {
    permissions: [{
      key,
      base: true,
      effective: true,
      base_scope: orgScope,
      effective_scope: orgScope,
      override: orgOverride,
      sources: [{ kind: 'role', name: '台账角色' }],
      can_edit: true,
      ...overrides,
    }],
    departments: [
      { id: departmentId, name: '大部门', parent_id: null },
      { id: childId, name: '子部门', parent_id: departmentId },
    ],
    permission_catalog: [],
    shipping_permission_publication: { registered: [key], published: published ? [key] : [] },
  }
}

function patch(body: unknown, target = url, headers?: HeadersInit) {
  return PATCH(new NextRequest(target, { method: 'PATCH', body: JSON.stringify(body), headers }), params)
}

function setRpcResult(data: unknown, error: { code: string, details?: string } | null = null) {
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data, error } as never)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({ id: actorId, org_id: otherOrgId, email: null, display_name: null, phone: null })
  vi.mocked(loadOrgRolePermissionContext).mockResolvedValue(authority)
  vi.mocked(loadEmployeeShippingPermissionTable).mockResolvedValue(projection())
  setRpcResult(departmentOverride)
})

it('returns the effective table, evidence, and scopes from the verified organization without caching', async () => {
  const response = await GET(new NextRequest(url), params)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(await response.json()).toEqual({ org_id: orgId, user_id: userId, ...projection() })
  expect(loadEmployeeShippingPermissionTable).toHaveBeenCalledExactlyOnceWith(userId, orgId)
  expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
})

it('requires a current system administrator regardless of session org claim or other permissions', async () => {
  vi.mocked(requireAuth).mockRejectedValueOnce(new AuthError())
  expect((await GET(new NextRequest(url), params)).status).toBe(401)
  vi.mocked(loadOrgRolePermissionContext).mockResolvedValue({ ...authority, canEditPlatformRoot: false })
  expect((await GET(new NextRequest(url), params)).status).toBe(403)
  expect((await patch(change)).status).toBe(403)
  expect(loadEmployeeShippingPermissionTable).not.toHaveBeenCalled()
  expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
})

it('requires exactly one current org and blocks third-party mutations before reading the employee', async () => {
  const stale = `${path}?orgId=${otherOrgId}`
  expect((await GET(new NextRequest(stale), params)).status).toBe(409)
  expect((await patch(change, stale)).status).toBe(409)
  expect((await GET(new NextRequest(path), params)).status).toBe(400)
  expect((await GET(new NextRequest(`${url}&orgId=${orgId}`), params)).status).toBe(400)
  expect((await patch(change, url, { origin: 'https://elsewhere.test' })).status).toBe(403)
  expect(loadEmployeeShippingPermissionTable).not.toHaveBeenCalled()
  expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
})

it('scopes both methods to the current employee and protects canonical administrator targets', async () => {
  vi.mocked(loadEmployeeShippingPermissionTable).mockResolvedValue(null)
  expect((await GET(new NextRequest(url), params)).status).toBe(404)
  expect((await patch(change)).status).toBe(404)
  vi.mocked(loadEmployeeShippingPermissionTable).mockResolvedValue(projection({ can_edit: false }))
  expect((await GET(new NextRequest(url), params)).status).toBe(200)
  const protectedResponse = await patch(change)
  expect(protectedResponse.status).toBe(403)
  expect(await protectedResponse.json()).toMatchObject({ code: 'EMPLOYEE_PERMISSION_OVERRIDE_PROTECTED' })
  expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
})

it('validates exact action keys and scope, rejects duplicates and requires the full expected override', async () => {
  const noExplicitScope = { effect: 'ALLOW', scope: null }
  const invalid = [
    { ...change, permission_code: 'shipping:*' },
    { ...change, permission_code: 'shipping:owner_view' },
    { ...change, override: { effect: 'ALLOW', scope: { type: 'self' } } },
    { ...change, override: { effect: 'DENY', scope: orgScope } },
    { ...change, override: noExplicitScope },
    { ...change, expected_override: undefined },
    { ...change, org_id: orgId },
    { ...change, override: { effect: 'ALLOW', scope: { type: 'department', departments: [] } } },
    { ...change, override: { effect: 'ALLOW', scope: {
      type: 'department',
      departments: [departmentScope.departments[0], departmentScope.departments[0]],
    } } },
  ]
  for (const body of invalid) expect((await patch(body)).status).toBe(400)
  expect(loadEmployeeShippingPermissionTable).not.toHaveBeenCalled()
  expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
})

it('CAS replaces a wider data scope with the selected departments and independently reads effective state', async () => {
  const after = projection({ override: departmentOverride, effective_scope: departmentOverride.scope })
  vi.mocked(loadEmployeeShippingPermissionTable).mockResolvedValueOnce(projection()).mockResolvedValueOnce(after)
  const response = await patch({
    ...change,
    override: { ...departmentOverride, scope: {
      ...departmentOverride.scope,
      departments: [...departmentOverride.scope.departments].reverse(),
    } },
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ org_id: orgId, user_id: userId, ...after })
  expect(supabaseAdmin.rpc).toHaveBeenCalledExactlyOnceWith('admin_set_employee_permission_override_v1', {
    p_actor_id: actorId,
    p_org_id: orgId,
    p_user_id: userId,
    p_permission_code: point,
    p_expected_override: orgOverride,
    p_override: departmentOverride,
  })
  expect(loadEmployeeShippingPermissionTable).toHaveBeenNthCalledWith(2, userId, orgId)
})

it.each([
  { key: 'shipping:owner_submit', scope: selfScope, wrongScope: orgScope },
  { key: 'shipping:intake_write', scope: orgScope, wrongScope: departmentScope },
] as const)('accepts only the registered scope for $key and reads back the saved override', async ({ key, scope, wrongScope }) => {
  const allow = { effect: 'ALLOW', scope } as const
  const invalid = { effect: 'ALLOW', scope: wrongScope } as const
  const assignment = { permission_code: key, expected_override: null, override: allow }
  const before = projection({ base: false, effective: false, base_scope: null, effective_scope: null, override: null }, true, key)
  const after = projection({ base: false, effective: true, base_scope: null, effective_scope: scope, override: allow }, true, key)
  vi.mocked(loadEmployeeShippingPermissionTable).mockResolvedValueOnce(before).mockResolvedValueOnce(after)
  setRpcResult(allow)

  expect((await patch({ ...assignment, override: invalid })).status).toBe(400)
  expect((await patch({ ...assignment, expected_override: invalid })).status).toBe(400)
  expect(supabaseAdmin.rpc).not.toHaveBeenCalled()

  const response = await patch(assignment)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ org_id: orgId, user_id: userId, ...after })
  expect(supabaseAdmin.rpc).toHaveBeenCalledExactlyOnceWith('admin_set_employee_permission_override_v1', {
    p_actor_id: actorId,
    p_org_id: orgId,
    p_user_id: userId,
    p_permission_code: key,
    p_expected_override: null,
    p_override: allow,
  })
})

it('denies independently of the base grant and can clear a stored unpublished override', async () => {
  const disabled = projection({ override: deny, effective: false, effective_scope: null })
  vi.mocked(loadEmployeeShippingPermissionTable).mockResolvedValueOnce(projection()).mockResolvedValueOnce(disabled)
  setRpcResult(deny)
  const off = await patch({ ...change, override: deny })
  expect(off.status).toBe(200)
  expect(await off.json()).toMatchObject({ permissions: [{ ...disabled.permissions[0], base: true, effective: false }] })

  const unpublished = projection({ override: deny, effective: false, effective_scope: null }, false)
  const cleared = projection({ override: null, can_edit: false, effective: false, effective_scope: null }, false)
  vi.mocked(loadEmployeeShippingPermissionTable).mockResolvedValueOnce(unpublished)
  expect((await patch(change)).status).toBe(409)
  vi.mocked(loadEmployeeShippingPermissionTable).mockResolvedValueOnce(unpublished).mockResolvedValueOnce(cleared)
  setRpcResult(null)
  expect((await patch({ ...change, expected_override: deny, override: null })).status).toBe(200)
  expect(supabaseAdmin.rpc).toHaveBeenLastCalledWith('admin_set_employee_permission_override_v1',
    expect.objectContaining({ p_expected_override: deny, p_override: null }))
})

it.each([
  ['40001', undefined, 409, 'EMPLOYEE_PERMISSION_OVERRIDE_CONFLICT'],
  ['42501', 'EMPLOYEE_PERMISSION_OVERRIDE_PROTECTED', 403, 'EMPLOYEE_PERMISSION_OVERRIDE_PROTECTED'],
  ['42501', undefined, 403, 'NO_PERMISSION'],
  ['P0002', undefined, 404, 'EMPLOYEE_PERMISSION_OVERRIDE_TARGET_NOT_FOUND'],
  ['22023', undefined, 400, 'EMPLOYEE_PERMISSION_OVERRIDE_INVALID'],
  ['23514', undefined, 409, 'EMPLOYEE_PERMISSION_OVERRIDE_NOT_PUBLISHED'],
  ['PGRST202', undefined, 503, 'EMPLOYEE_PERMISSION_OVERRIDE_UNAVAILABLE'],
])('maps the live RPC denial %s to the appropriate response', async (code, details, status, responseCode) => {
  setRpcResult(null, { code, details })
  const response = await patch(change)
  expect(response.status).toBe(status)
  expect(await response.json()).toMatchObject({ code: responseCode })
  expect(loadEmployeeShippingPermissionTable).toHaveBeenCalledTimes(1)
})

it('does not acknowledge a write when its receipt or refreshed override disagrees', async () => {
  setRpcResult(orgOverride)
  expect((await patch(change)).status).toBe(503)
  expect(loadEmployeeShippingPermissionTable).toHaveBeenCalledTimes(1)
  setRpcResult(departmentOverride)
  expect((await patch(change)).status).toBe(409)
  expect(loadEmployeeShippingPermissionTable).toHaveBeenCalledTimes(3)
})
