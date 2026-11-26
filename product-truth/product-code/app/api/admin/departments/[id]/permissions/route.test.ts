import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { AuthError, requireAuth } from '@/lib/auth'
import { loadOrgRolePermissionContext } from '@/lib/org-role-permissions'
import { loadShippingModulePermissionState } from '@/lib/permission-registry'
import { supabaseAdmin } from '@/lib/supabase'
import { GET, PATCH } from './route'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
}))
vi.mock('@/lib/org-role-permissions', () => ({ loadOrgRolePermissionContext: vi.fn() }))
vi.mock('@/lib/permission-registry', () => ({ loadShippingModulePermissionState: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc: vi.fn() } }))

const actorId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const departmentId = '33333333-3333-4333-8333-333333333333'
const otherOrgId = '44444444-4444-4444-8444-444444444444'
const point = 'shipping:ledger_view'
const url = `https://example.test/api/admin/departments/${departmentId}/permissions`
const params = { params: Promise.resolve({ id: departmentId }) }
const rootContext = {
  orgId, settings: {}, canRead: true, canEdit: true, canEditPlatformRoot: true,
  actorPermissions: ['*'],
}
const actor = { id: actorId, org_id: otherOrgId, email: null, display_name: null, phone: null }
const noGrant = { permissions: [], include_subdepartments: false }
const departmentGrant = { permissions: [point], include_subdepartments: true }
const change = {
  expected_org_id: orgId, expected_permissions: [], expected_include_subdepartments: false,
  ...departmentGrant,
}

function patch(body: object, headers?: HeadersInit) {
  return PATCH(new NextRequest(url, { method: 'PATCH', body: JSON.stringify(body), headers }), params)
}

function setPublished(departmentLedgerPublished: boolean) {
  vi.mocked(loadShippingModulePermissionState).mockResolvedValue({
    registered: new Set([point]), published: new Set([point]), departmentLedgerPublished,
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(actor)
  vi.mocked(loadOrgRolePermissionContext).mockResolvedValue(rootContext)
  setPublished(true)
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: noGrant, error: null } as never)
})

it('reads current explicit permissions only in the authenticated current organization', async () => {
  const response = await GET(new NextRequest(url), params)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(await response.json()).toEqual({
    org_id: orgId, department_id: departmentId, ...noGrant, available_permissions: [point], permissions_editable: true,
  })
  expect(supabaseAdmin.rpc).toHaveBeenCalledWith('admin_get_department_permissions_v1', {
    p_actor_id: actorId, p_org_id: orgId, p_department_id: departmentId,
  })
})

it('requires an exact current system administrator to read or write', async () => {
  vi.mocked(requireAuth).mockRejectedValueOnce(new AuthError())
  expect((await GET(new NextRequest(url), params)).status).toBe(401)
  vi.mocked(loadOrgRolePermissionContext).mockResolvedValue({ ...rootContext, canEditPlatformRoot: false })
  expect((await GET(new NextRequest(url), params)).status).toBe(403)
  expect((await patch(change)).status).toBe(403)
  expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
})

it('rejects stale organization, cross-origin writes and actions outside the explicit supported point', async () => {
  expect((await patch(change, { origin: 'https://outside.test' })).status).toBe(403)
  expect((await patch({ ...change, expected_org_id: otherOrgId })).status).toBe(409)
  expect((await patch({ ...change, permissions: ['shipping:*'] })).status).toBe(400)
  expect((await patch({ ...change, permissions: [point, point] })).status).toBe(400)
  expect((await patch({ ...change, expected_include_subdepartments: undefined })).status).toBe(400)
  expect((await patch({ ...change, permissions: [] })).status).toBe(400)
  expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
})

it('sends the editor baseline and returns the database result with exact organization and department', async () => {
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: departmentGrant, error: null } as never)
  const response = await patch(change)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    org_id: orgId, department_id: departmentId, ...departmentGrant,
    available_permissions: [point], permissions_editable: true,
  })
  expect(supabaseAdmin.rpc).toHaveBeenCalledWith('admin_set_department_permissions_v1', {
    p_actor_id: actorId, p_org_id: orgId, p_department_id: departmentId, p_expected_org_id: orgId,
    p_expected_permissions: [], p_expected_include_subdepartments: false,
    p_permissions: [point], p_include_subdepartments: true,
  })
})

it('supports revocation when the point is unpublished and disallows re-granting it', async () => {
  setPublished(false)
  vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({ data: departmentGrant, error: null } as never)
  const stored = await GET(new NextRequest(url), params)
  expect(await stored.json()).toMatchObject({ ...departmentGrant, available_permissions: [], permissions_editable: true })
  expect((await patch(change)).status).toBe(409)
  expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(1)
  const removed = await patch({
    expected_org_id: orgId, expected_permissions: [point], expected_include_subdepartments: true, ...noGrant,
  })
  expect(removed.status).toBe(200)
  expect(await removed.json()).toMatchObject({ ...noGrant, available_permissions: [] })
})

it.each([['42501', 403], ['P0002', 404], ['40001', 409], ['23514', 409], ['PGRST202', 503]])(
  'handles a database rejection of %s as %s', async (code, status) => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { code } } as never)
    expect((await patch(change)).status).toBe(status)
  },
)
