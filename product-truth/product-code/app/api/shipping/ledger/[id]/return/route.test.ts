// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), rpc: vi.fn(), legacyReturn: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth, AuthError: class extends Error {} }))
vi.mock('@/lib/shipping/entry-access', () => ({ loadPublishedShippingAccess: mocks.access }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc: mocks.rpc } }))
vi.mock('@/lib/shipping/workflow', () => ({ returnShipmentOrder: mocks.legacyReturn }))

import { POST } from './route'

const id = '00000000-0000-4000-8000-000000000031'
const params = { params: Promise.resolve({ id }) }
const org = 'org-current'
const reason = '请补齐收件资料'
const result = { id, order_no: 'SO-20261126-AAAAAAAA', status: 'returned', returned_reason: reason }
function request(origin = 'https://example.test', body: object = { reason }) {
  return new NextRequest(`https://example.test/api/shipping/ledger/${id}/return`, {
    method: 'POST', headers: { origin }, body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ id: 'actor', org_id: 'org-ignored' })
  mocks.access.mockResolvedValue({ orgId: org, returnRegistered: true, permissions: ['shipping:ledger_view'] })
  mocks.rpc.mockResolvedValue({ data: result, error: null })
})

it('uses the known actor and currently resolved org for the atomic scoped operation', async () => {
  const response = await POST(request(), params)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(result)
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('shipping_return_department_record_v1', {
    p_actor_id: 'actor', p_org_id: org, p_order_id: id, p_reason: reason,
  })
  expect(mocks.legacyReturn).not.toHaveBeenCalled()
})

it('cannot convert previously broad review into the new return action once registered', async () => {
  mocks.access.mockResolvedValue({ orgId: org, returnRegistered: true, permissions: ['shipping:ledger_view', 'shipping:record_review'] })
  mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
  expect((await POST(request(), params)).status).toBe(403)
  expect(mocks.legacyReturn).not.toHaveBeenCalled()
})

it('uses legacy review only while the new action is absent from the registry', async () => {
  mocks.access.mockResolvedValue({ orgId: org, returnRegistered: false, permissions: ['shipping:ledger_view', 'shipping:record_review'] })
  mocks.legacyReturn.mockResolvedValue(result)
  expect((await POST(request(), params)).status).toBe(200)
  expect(mocks.legacyReturn).toHaveBeenCalledExactlyOnceWith(id, 'actor', org, reason)
  expect(mocks.rpc).not.toHaveBeenCalled()
})

it.each([['42501', 403], ['P0002', 404], ['23514', 409]])('reports live SQL denial %s', async (code, status) => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code } })
  expect((await POST(request(), params)).status).toBe(status)
})

it('rejects forged scopes, write origins and malformed IDs without requesting a mutation', async () => {
  expect((await POST(request('https://foreign.test'), params)).status).toBe(403)
  expect((await POST(request('https://example.test', { reason, departmentId: id }), params)).status).toBe(400)
  expect((await POST(request(), { params: Promise.resolve({ id: 'not-an-order' }) })).status).toBe(400)
  expect(mocks.rpc).not.toHaveBeenCalled()
})
