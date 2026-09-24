// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ submit: vi.fn(), policy: vi.fn(), settings: vi.fn(), runtime: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: async () => ({ id: 'test-user' }), AuthError: class extends Error {} }))
vi.mock('@/lib/shipping/service', () => ({ submitShipping: mocks.submit, checkShippingPolicy: mocks.policy, shippingRequestId: vi.fn() }))
vi.mock('@/lib/shipping/runtime-config', () => ({ getUserShippingSettings: mocks.settings, getShippingRuntimeConfig: mocks.runtime }))
vi.mock('@/lib/shipping/operator-access', () => ({ requireShippingOperator: async () => 'org-1' }))
vi.mock('@/lib/shipping/store', () => ({ shippingStore: {}, publicRecord: (x: unknown) => x }))
import { POST } from './orders/route'
const contact = { name: '测试', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '测试街道1号' }
const payload = { key: '43a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0', confirmed: true, billingAccountId: '12a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0', input: { sender: contact, recipient: contact, cargo: '文件', weight: 1, serviceId: 2, remark: '', source: 'manual' } }
const config = { orgId: 'org-1', connectionId: 'conn-1', environment: 'sandbox', partnerId: 'partner', checkWord: 'secret', billingAccountId: payload.billingAccountId, billingAccount: '123456', billingAccountTail: '3456', senderProfileId: 'sender-1', sender: contact, connectionKey: 'connection-key', services: [{ id: 2, name: '标准服务', preference: 'standard' }], snapshot: {} }
const request = (body: unknown) => new NextRequest('http://localhost/api/shipping/orders', { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => {
  mocks.submit.mockReset(); mocks.policy.mockReset(); mocks.settings.mockReset(); mocks.runtime.mockReset()
  mocks.settings.mockResolvedValue({ orgId: 'org-1', settings: { defaultBillingAccountId: payload.billingAccountId } })
  mocks.runtime.mockResolvedValue(config)
})
describe('database-configured order submission boundary', () => {
  it('rejects local invalid fields before reserving or dispatching', async () => {
    const response = await POST(request({ ...payload, input: { ...payload.input, weight: -1 } }))
    expect(response.status).toBe(400)
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('rejects when the organization has no configured billing account', async () => {
    mocks.settings.mockResolvedValue({ orgId: 'org-1', settings: { defaultBillingAccountId: '' } })
    const response = await POST(request({ ...payload, billingAccountId: undefined }))
    expect(response.status).toBe(409)
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('does not turn a storage or provider uncertainty into an editable validation failure', async () => {
    mocks.submit.mockRejectedValue(new Error('uncertain write'))
    const response = await POST(request(payload))
    expect(response.status).toBe(500)
    expect((await response.json()).requestStage).toBeUndefined()
  })
})
