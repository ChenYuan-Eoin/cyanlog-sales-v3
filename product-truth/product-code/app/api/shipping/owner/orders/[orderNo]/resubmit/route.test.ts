// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { AuthError } from '@/lib/auth'
import { GET, POST } from './route'

const mock = vi.hoisted(() => ({
  auth: vi.fn(), operator: vi.fn(), from: vi.fn(), rpc: vi.fn(), dept: vi.fn(), rules: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAuth: mock.auth, AuthError: class extends Error {} }))
vi.mock('@/lib/shipping/operator-access', () => ({ loadShippingOperatorDecision: mock.operator }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mock.from, rpc: mock.rpc } }))
vi.mock('@/lib/shipping/intake-settings', () => ({ loadIntakeSettings: mock.rules }))
vi.mock('@/lib/shipping/department-access', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/shipping/department-access')>(),
  loadEmployeeShippingDepartments: mock.dept,
}))

const number = 'SO-20261118-ABCD1618'
const path = 'https://app.example/api/shipping/owner/orders/' + number + '/resubmit'
const ctx = { params: Promise.resolve({ orderNo: number }) }
const actor = { id: 'user-A', org_id: 'org-A', phone: '13700000000', display_name: '真实员工' }
const departmentId = '19377c6b-5ffb-458b-913f-76aeaf54d47b'
const contact = { name: '公司前台', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '示例路18号' }
const form = { sender: contact, recipient: contact, cargo: '文件', customerName: '客户公司', serviceId: 8,
  submittedBy: { name: '旧姓名', phone: '13800000000', team: '旧部门', departmentId } }
const submission = { expectedRevision: 1, key: '8b69242d-16cb-425e-b647-6dcba8c1aa1d', input: form }
const sessionFixture = 'local-test'
const options = { headers: { authorization: 'Bearer ' + sessionFixture } }
const read = () => GET(new NextRequest(path, options), ctx)
const post = (body: unknown = submission) => POST(new NextRequest(path, { ...options, method: 'POST', body: JSON.stringify(body) }), ctx)
const result = { orderNo: 'SO-20261125-ABCD1618', revision: 1, status: 'awaiting_confirmation', createdAt: '2026-11-25T03:00:00Z', nextReviewAt: '2026-11-25T03:00:00Z', resubmittedFrom: number, replayed: false }
let order: Record<string, unknown>
beforeEach(() => {
  order = {
    org_id: 'org-A', created_by: 'user-A', intake_source: 'owner_web', order_no: number, status: 'returned',
    revision: 1, returned_reason: '请补充楼层', shipping_waybills: [],
    shipment_payload: { ...form, internalField: 'private', recipient: { ...contact, legacyExtra: 'internal' } },
  }
  vi.resetAllMocks()
  mock.auth.mockResolvedValue(actor)
  mock.operator.mockResolvedValue({ orgId: 'org-A', canOperate: false, roleCodes: ['FXIAOKE_BASELINE'] })
  mock.dept.mockResolvedValue([{ id: departmentId, name: '销售部', path: '总部 / 销售部' }])
  mock.rules.mockResolvedValue({ companyName: { enabled: true, required: true, minLength: 2 }, team: { enabled: true, required: true, minLength: 1 } })
  mock.from.mockImplementation((table: string) => {
    const record = table === 'auth_tokens' ? { token: sessionFixture, user_id: 'user-A', auth_method: 'fxiaoke' } : order
    const filters = new Map<string, unknown>()
    const q = {
      select: () => q,
      eq: (field: string, value: unknown) => { filters.set(field, value); return q },
      maybeSingle: () => Promise.resolve({ data: [...filters].every(([key, value]) => (record as Record<string, unknown>)[key] === value) ? record : null, error: null }),
    }
    return q
  })
  mock.rpc.mockResolvedValue({ data: result })
})

it('loads the editable fields and return reason through the employee route', async () => {
  const response = await read()
  expect(response.status).toBe(200)
  const receipt = await response.json()
  expect(receipt).toMatchObject({ orderNo: number, status: 'returned', revision: 1, returnedReason: '请补充楼层', input: { recipient: contact, customerName: '客户公司' } })
  expect(receipt.input).not.toHaveProperty('internalField')
  expect(receipt.input.serviceId).toBe(8)
  expect(receipt.input.recipient).not.toHaveProperty('legacyExtra')
})

it('denies a read-only employee before reading returned order details', async () => {
  mock.operator.mockResolvedValue({ orgId: 'org-A', canOperate: false, roleCodes: ['READONLY'] })

  const response = await read()

  expect(response.status).toBe(403)
  expect(await response.json()).toEqual({ error: '当前账号仅可查看本人寄件记录。' })
  expect(mock.from).not.toHaveBeenCalledWith('shipping_orders')
})

it('opens an owned returned order for an authorized operator', async () => {
  mock.operator.mockResolvedValue({ orgId: 'org-A', canOperate: true, roleCodes: ['SHIPPING_OPERATOR'] })

  const response = await read()

  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ orderNo: number, input: { recipient: contact } })
  expect(mock.from).not.toHaveBeenCalledWith('auth_tokens')
})

it.each([{ org_id: 'org-B' }, { created_by: 'user-B' }, { intake_source: 'anonymous_web' }, { order_no: 'other' }])('conceals out-of-scope drafts %j', async patch => {
  Object.assign(order, patch)
  expect((await read()).status).toBe(404)
})

it.each([{ status: 'awaiting_confirmation' }, { status: 'resubmitted' }, { provider_order_id: 'uncertain' }, { cancellation: { phase: 'unknown' } }, { shipping_waybills: [{ waybill_no: 'SF1234' }] }])('does not open a frozen work order %j', async patch => {
  Object.assign(order, patch)
  expect((await read()).status).toBe(409)
})

it('applies the current employee identity and department before invoking the successor transaction', async () => {
  const response = await post()
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(result)
  expect(mock.rpc).toHaveBeenCalledOnce()
  expect(mock.rpc).toHaveBeenCalledWith('resubmit_returned_owner_shipment_v2', expect.objectContaining({
    p_org_id: 'org-A', p_actor_id: actor.id, p_order_no: number, p_request_key: submission.key,
    p_new_order_no: expect.stringMatching(/^SO-\d{8}-[A-Z0-9]{8}$/),
    p_receipt_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    p_expected_revision: 1, p_request_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    p_shipment_payload: expect.objectContaining({ submittedBy: { name: actor.display_name, phone: actor.phone, team: '销售部', departmentId } }),
  }))
  expect(mock.rpc.mock.calls[0][1].p_shipment_payload).not.toHaveProperty('serviceId')
})

it('requires an authenticated session, a valid original revision and an allowed department', async () => {
  mock.auth.mockRejectedValueOnce(new AuthError())
  expect((await read()).status).toBe(401)
  expect((await post({ ...submission, expectedRevision: 0 })).status).toBe(400)
  expect((await post({ ...submission, input: { ...form, customerName: '' } })).status).toBe(400)
  mock.dept.mockResolvedValue([])
  expect((await post()).status).toBe(403)
  expect(mock.rpc).not.toHaveBeenCalled()
})

it.each([[null, 404], ['40001', 409], ['23514', 409], ['other', 503]])('reports a transaction failure %s as %s', async (code, status) => {
  mock.rpc.mockResolvedValue({ data: null, error: code ? { code } : null })
  expect((await post()).status).toBe(status)
})
