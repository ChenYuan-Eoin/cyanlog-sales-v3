import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

const { auth, access, rpc } = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: auth }))
vi.mock('@/lib/admin/member-actions', () => ({ loadOrganizationPermissionAccess: access }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc } }))

const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const user = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const org = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const review = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const otherOrg = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const requestBody = { expected_org_id: org, review_id: review }
const item = { review_id: review, effective_at: '2026-11-27T15:10:00+00:00', kind: 'personal_override',
  permission_code: 'shipping:ledger_view', effect: 'DENY' }
const endpoint = `https://example.test/api/admin/users/${user}/department-transfer-review`
const context = { params: Promise.resolve({ id: user }) }

function list(query = `expected_org_id=${org}`) {
  return GET(new NextRequest(`${endpoint}?${query}`), context)
}

function acknowledge(body: object = requestBody, origin = 'https://example.test') {
  return POST(new NextRequest(endpoint, {
    method: 'POST', body: JSON.stringify(body), headers: { origin, 'x-request-id': 'review-id' },
  }), context)
}

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ id: actor })
  access.mockReset().mockResolvedValue({ orgId: org, systemAdministrator: true })
  rpc.mockReset()
})

it('returns only typed pending review summaries from the current organization', async () => {
  rpc.mockResolvedValue({ data: [{ ...item, previous_grant: { private_field: 'value' } }], error: null })
  const res = await list()
  expect(res.status).toBe(200)
  expect(res.headers.get('cache-control')).toBe('private, no-store')
  expect(await res.json()).toEqual({ items: [item], has_more: false })
  expect(rpc).toHaveBeenCalledExactlyOnceWith('list_member_department_transfer_reviews_v1', {
    p_org_id: org, p_actor_id: actor, p_user_id: user,
  })
})

it('acknowledges exactly the chosen review through an audit-only RPC', async () => {
  rpc.mockResolvedValue({ data: true, error: null })
  const res = await acknowledge()
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ success: true, review_id: review })
  expect(rpc).toHaveBeenCalledExactlyOnceWith('acknowledge_member_department_transfer_review_v1', {
    p_org_id: org, p_actor_id: actor, p_user_id: user, p_review_id: review, p_request_id: 'review-id',
  })
})

it('rejects changed organizations, non-system administrators and cross-origin changes before the RPC', async () => {
  expect((await list(`expected_org_id=${otherOrg}`)).status).toBe(409)
  expect((await list(`expected_org_id=${org}&expected_org_id=${otherOrg}`)).status).toBe(400)
  expect((await acknowledge(requestBody, 'https://another-site.test')).status).toBe(403)
  expect((await acknowledge({ ...requestBody, override: { effect: 'ALLOW' } })).status).toBe(400)
  access.mockResolvedValue({ orgId: org, systemAdministrator: false })
  expect((await list()).status).toBe(403)
  expect((await acknowledge()).status).toBe(403)
  expect(rpc).not.toHaveBeenCalled()
})

it('returns scoped conflict and not-found errors without exposing the database message', async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { details: 'DEPARTMENT_TRANSFER_REVIEW_NOT_FOUND', message: 'untrusted' } })
    .mockResolvedValueOnce({ data: null, error: { details: 'DEPARTMENT_TRANSFER_REVIEW_STALE', message: 'untrusted' } })
  const missing = await acknowledge()
  expect(missing.status).toBe(404)
  expect(await missing.json()).toMatchObject({ code: 'DEPARTMENT_TRANSFER_REVIEW_NOT_FOUND' })
  const stale = await acknowledge()
  expect(stale.status).toBe(409)
  expect(await stale.json()).toMatchObject({ code: 'DEPARTMENT_TRANSFER_REVIEW_STALE' })
})
