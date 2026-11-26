import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError, requireAuth } from '@/lib/auth'
import { loadOrgRolePermissionContext } from '@/lib/org-role-permissions'
import { supabaseAdmin } from '@/lib/supabase'
import { GET, PUT } from './route'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('@/lib/org-role-permissions', () => ({ loadOrgRolePermissionContext: vi.fn() }))

const actorId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const departmentId = '33333333-3333-4333-8333-333333333333'
const leaderId = '44444444-4444-4444-8444-444444444444'
const url = 'https://example.test/api/admin/departments/leader-access'

const authority = {
  orgId, settings: {}, actorPermissions: ['*'], canEdit: true, canEditPlatformRoot: true,
  canRead: true, canListAssignableRoles: true,
}

function changeRequest(body: object) {
  return new NextRequest(url, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-request-id': 'dept-confirmation' },
  })
}

describe('department leader access administrator route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, org_id: 'legacy-home-org', email: null, display_name: null, phone: null })
    vi.mocked(loadOrgRolePermissionContext).mockResolvedValue(authority)
  })

  it('reads only the current organization selection from a root-checked RPC', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { leaderId, userId: null }, error: null } as never)
    const response = await GET(new NextRequest(`${url}?departmentId=${departmentId}`))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ success: true, leaderId, userId: null })
    expect(loadOrgRolePermissionContext).toHaveBeenCalledExactlyOnceWith(actorId)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('admin_get_department_lead_access_v1', {
      p_actor_id: actorId, p_org_id: orgId, p_department_id: departmentId,
    })
  })

  it('requires authentication and current active membership before sending writes', async () => {
    const requestBody = { departmentId, userId: leaderId, expectedUserId: null }
    vi.mocked(requireAuth).mockRejectedValueOnce(new AuthError())
    expect((await PUT(changeRequest(requestBody))).status).toBe(401)

    vi.mocked(loadOrgRolePermissionContext).mockResolvedValueOnce(null)
    expect((await PUT(changeRequest(requestBody))).status).toBe(403)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('denies department lead grants without system super administrator authority', async () => {
    vi.mocked(loadOrgRolePermissionContext).mockResolvedValue({ ...authority, canEditPlatformRoot: false })
    expect((await GET(new NextRequest(`${url}?departmentId=${departmentId}`))).status).toBe(403)
    expect((await PUT(changeRequest({ departmentId, userId: leaderId, expectedUserId: null }))).status).toBe(403)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('requires prior-state CAS and disallows client-supplied organization authority', async () => {
    expect((await PUT(changeRequest({ departmentId, userId: leaderId }))).status).toBe(400)
    expect((await PUT(changeRequest({ departmentId, userId: leaderId, expectedUserId: null, orgId }))).status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('sends confirmations and revocations to the audited mutation RPC', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({ data: { status: 'saved', userId: leaderId }, error: null } as never)
    const grant = await PUT(changeRequest({ departmentId, userId: leaderId, expectedUserId: null }))
    expect(await grant.json()).toEqual({ success: true, status: 'saved', userId: leaderId })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('admin_set_department_lead_access_v1', {
      p_actor_id: actorId, p_org_id: orgId, p_department_id: departmentId,
      p_user_id: leaderId, p_expected_user_id: null, p_request_id: 'dept-confirmation',
    })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({ data: { status: 'unchanged', userId: null }, error: null } as never)
    const revoke = await PUT(changeRequest({ departmentId, userId: null, expectedUserId: leaderId }))
    expect(await revoke.json()).toEqual({ success: true, status: 'unchanged', userId: null })
    expect(supabaseAdmin.rpc).toHaveBeenLastCalledWith('admin_set_department_lead_access_v1', {
      p_actor_id: actorId, p_org_id: orgId, p_department_id: departmentId,
      p_user_id: null, p_expected_user_id: leaderId, p_request_id: 'dept-confirmation',
    })
  })

  it.each([
    ['42501', 403, 'NO_PERMISSION'],
    ['P0002', 404, 'DEPARTMENT_NOT_FOUND'],
    ['40001', 409, 'DEPARTMENT_LEAD_ACCESS_CHANGED'],
    ['23514', 409, 'DEPARTMENT_LEADER_NOT_ELIGIBLE'],
    ['PGRST202', 503, 'DEPARTMENT_LEAD_ACCESS_UNAVAILABLE'],
    ['XX000', 500, 'DEPARTMENT_LEAD_ACCESS_FAILED'],
  ])('maps SQL error %s without exposing storage details', async (code, status, publicCode) => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({ data: null, error: { code, message: 'database internals' } } as never)
    const response = await PUT(changeRequest({ departmentId, userId: null, expectedUserId: leaderId }))
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: expect.not.stringContaining('database internals'), code: publicCode })
  })

  it('reports an unavailable migration on GET instead of claiming the department is unconfirmed', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } } as never)
    const response = await GET(new NextRequest(`${url}?departmentId=${departmentId}`))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'DEPARTMENT_LEAD_ACCESS_UNAVAILABLE' })
  })
})
