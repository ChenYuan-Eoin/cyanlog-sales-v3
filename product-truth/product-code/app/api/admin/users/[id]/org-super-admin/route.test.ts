import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth'
import { loadOrgRolePermissionContext } from '@/lib/org-role-permissions'
import { supabaseAdmin } from '@/lib/supabase'
import { GET, PATCH } from './route'

vi.mock('@/lib/auth', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
}))
vi.mock('@/lib/org-role-permissions', () => ({ loadOrgRolePermissionContext: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc: vi.fn() } }))

const actorId = '10000000-0000-4000-8000-000000000001'
const orgId = '10000000-0000-4000-8000-000000000002'
const memberId = '10000000-0000-4000-8000-000000000003'
const anotherOrgId = '10000000-0000-4000-8000-000000000004'
const authority = {
  orgId, settings: {}, canEdit: true, canRead: true, canEditPlatformRoot: false, actorPermissions: ['role:manage'],
  canAppointOrganizationSuperAdmin: true,
}
const routeContext = { params: Promise.resolve({ id: memberId }) }
const rpcArgs = { p_org_id: orgId, p_actor_id: actorId, p_user_id: memberId }

function request(body?: unknown) {
  return new NextRequest('https://example.test/api/admin/users/' + memberId + '/org-super-admin', body === undefined ? {} : {
    method: 'PATCH',
    headers: { 'x-request-id': 'request-1', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('organization super administrator resource', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, email: null, phone: null, display_name: null })
    vi.mocked(loadOrgRolePermissionContext).mockResolvedValue(authority)
  })

  it('reads the exact organization grant with no caching', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: false, error: null } as never)
    const result = await GET(request(), routeContext)
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(await result.json()).toEqual({ success: true, org_id: orgId, enabled: false })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('admin_get_org_super_admin_v1', rpcArgs)
  })

  it.each([true, false])('delegates the desired %s state and expected state to the exact-org transaction', async enabled => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: enabled, error: null } as never)
    const result = await PATCH(request({ enabled, expected_enabled: !enabled, expected_org_id: orgId }), routeContext)
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ success: true, org_id: orgId, enabled })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('admin_set_org_super_admin_v1', {
      ...rpcArgs, p_assigned: enabled, p_expected_assigned: !enabled, p_request_id: 'request-1',
    })
  })

  it('checks current authority again for every read or write', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: true, error: null } as never)
    expect((await GET(request(), routeContext)).status).toBe(200)
    vi.mocked(loadOrgRolePermissionContext).mockResolvedValue({ ...authority, canAppointOrganizationSuperAdmin: false })
    expect((await GET(request(), routeContext)).status).toBe(403)
    expect((await PATCH(request({ enabled: false, expected_enabled: true, expected_org_id: orgId }), routeContext)).status).toBe(403)
    expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(1)
  })

  it('uses protected appointment authority independently of role-definition writing', async () => {
    vi.mocked(loadOrgRolePermissionContext).mockResolvedValue({ ...authority, canEdit: false })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: true, error: null } as never)
    const result = await PATCH(request({ enabled: true, expected_enabled: false, expected_org_id: orgId }), routeContext)
    expect(result.status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledOnce()
  })

  it('rejects authentication, self-mutation, incomplete input and an organization switch before executing a transaction', async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(new AuthError())
    expect((await GET(request(), routeContext)).status).toBe(401)
    expect((await PATCH(request({ enabled: true }), { params: Promise.resolve({ id: actorId }) })).status).toBe(403)
    expect((await PATCH(request({ enabled: true }), routeContext)).status).toBe(400)
    expect((await PATCH(request({ enabled: true, expected_enabled: false, expected_org_id: anotherOrgId }), routeContext)).status).toBe(409)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it.each([['42501', 403], ['P0002', 404], ['40001', 409], ['23514', 409], ['PGRST202', 503]])(
    'maps the database error %s to %s', async (code, status) => {
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { code } } as never)
      expect((await PATCH(request({ enabled: true, expected_enabled: false, expected_org_id: orgId }), routeContext)).status).toBe(status)
    },
  )
})
