import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { POST } from './route'

const { auth, access, rpc } = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: auth }))
vi.mock('@/lib/admin/member-actions', () => ({ loadOrganizationPermissionAccess: access }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc } }))

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const orgId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const departmentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const choiceId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const otherOrgId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const requestId = '12121212-1212-4212-8212-121212121212'
const saveInput = {
  action: 'save', expected_org_id: orgId, department_id: departmentId, keep_previous: true, request_id: requestId,
}
const applied = {
  status: 'applied', department_id: departmentId, secondary_department_ids: [],
  impact: {}, effective_at: '2026-11-27T15:03:00Z',
}
const expectedRpc = {
  p_org_id: orgId, p_actor_id: actorId, p_user_id: userId, p_department_id: departmentId, p_keep_previous: true,
  p_override_choice: null, p_choice_id: null, p_request_id: requestId,
}

function request(body: unknown, id = userId) {
  return POST(new NextRequest(`https://example.test/api/admin/users/${id}/department-transfer`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'x-request-id': 'department-transfer-test' },
  }), { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ id: actorId })
  access.mockReset().mockResolvedValue({ orgId, systemAdministrator: true })
  rpc.mockReset()
})

it('saves a routine transfer in one organization-bound command', async () => {
  rpc.mockResolvedValue({ data: applied, error: null })
  const response = await request(saveInput)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual(applied)
  expect(rpc).toHaveBeenCalledExactlyOnceWith('save_member_department_transfer_v1', expectedRpc)
})

it('passes through the personal permission choice and saves with the same request ID and selection', async () => {
  const prompt = {
    status: 'override_choice_required', choice_id: choiceId,
    impact: { affected_count: 2, retainable_count: 1, blocked_count: 1 },
  }
  rpc.mockResolvedValueOnce({ data: prompt, error: null }).mockResolvedValueOnce({ data: applied, error: null })
  const first = await request(saveInput)
  expect(first.status).toBe(200)
  expect(await first.json()).toEqual(prompt)
  const second = await request({ ...saveInput, choice_id: choiceId, override_choice: 'retain_eligible' })
  expect(second.status).toBe(200)
  expect(await second.json()).toEqual(applied)
  expect(rpc).toHaveBeenNthCalledWith(1, 'save_member_department_transfer_v1', expectedRpc)
  expect(rpc).toHaveBeenNthCalledWith(2, 'save_member_department_transfer_v1', {
    ...expectedRpc, p_choice_id: choiceId, p_override_choice: 'retain_eligible',
  })
})

it('blocks unpaired decisions, old confirmation bypass, cross-organization use and a transfer of the acting account', async () => {
  expect((await request({ ...saveInput, choice_id: choiceId })).status).toBe(400)
  expect((await request({ ...saveInput, override_choice: 'retain_eligible' })).status).toBe(400)
  const legacy = await request({ action: 'confirm', expected_org_id: orgId, preview_id: choiceId })
  expect(legacy.status).toBe(409)
  expect(await legacy.json()).toMatchObject({ code: 'DEPARTMENT_TRANSFER_CLIENT_UPDATED' })
  expect((await request({ ...saveInput, expected_org_id: otherOrgId })).status).toBe(409)
  expect((await request(saveInput, actorId)).status).toBe(403)
  access.mockResolvedValue({ orgId, systemAdministrator: false })
  expect((await request(saveInput)).status).toBe(403)
  expect(rpc).not.toHaveBeenCalled()
})

it('ignores save requests from another browser origin', async () => {
  const response = await POST(new NextRequest(`https://example.test/api/admin/users/${userId}/department-transfer`, {
    method: 'POST',
    headers: { origin: 'https://other.example.test' },
    body: JSON.stringify(saveInput),
  }), { params: Promise.resolve({ id: userId }) })
  expect(response.status).toBe(403)
  expect(auth).not.toHaveBeenCalled()
  expect(rpc).not.toHaveBeenCalled()
})

it('returns a stale choice conflict without retrying or calling a legacy writer', async () => {
  rpc.mockResolvedValue({ data: null, error: { code: '40001', details: 'DEPARTMENT_TRANSFER_STALE' } })
  const response = await request({ ...saveInput, choice_id: choiceId, override_choice: 'new_baseline' })
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({ code: 'DEPARTMENT_TRANSFER_STALE', error: expect.stringContaining('重新保存') })
  expect(rpc).toHaveBeenCalledTimes(1)
})

it('preserves source-owned membership guard and does not disclose raw transaction errors', async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', details: 'DEPARTMENT_TRANSFER_EXTERNAL_SOURCE' } })
  expect((await request(saveInput)).status).toBe(403)
  rpc.mockResolvedValueOnce({ data: { unsafe: true }, error: null })
  expect((await request(saveInput)).status).toBe(503)
})
