// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ submit: vi.fn(), policy: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: async () => ({ id: 'test-user' }), AuthError: class extends Error {} }))
vi.mock('@/lib/shipping/service', () => ({ submitShipping: mocks.submit, checkShippingPolicy: mocks.policy, shippingRequestId: vi.fn() }))
vi.mock('@/lib/shipping/store', () => ({ shippingStore: {}, publicRecord: (x: unknown) => x }))
import { POST } from './orders/route'
const contact = { name: '测试', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '测试街道1号' }
const payload = { key: '43a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0', confirmed: true, input: { sender: contact, recipient: contact, cargo: '文件', weight: 1, serviceId: 2, remark: '', source: 'manual' } }
const request = (body: unknown) => new NextRequest('http://localhost/api/shipping/orders', { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => { vi.stubEnv('SHIPPING_ALLOWED_USER_IDS', 'test-user'); vi.stubEnv('SF_PARTNER_ID', ''); mocks.submit.mockReset(); mocks.policy.mockReset() })
describe('pre-submit rejection boundary', () => {
 it('marks local invalid fields editable without invoking submission', async () => { const r = await POST(request({ ...payload, input: { ...payload.input, weight: -1 } })); expect(r.status).toBe(400); expect(await r.json()).toMatchObject({ requestStage: 'validation' }); expect(mocks.submit).not.toHaveBeenCalled() })
 it('marks missing connection editable without invoking submission', async () => { const r = await POST(request(payload)); expect(r.status).toBe(503); expect(await r.json()).toMatchObject({ requestStage: 'validation' }); expect(mocks.submit).not.toHaveBeenCalled() })
 it('does not mislabel storage or dispatch errors as editable', async () => { vi.stubEnv('SF_PARTNER_ID', 'test'); vi.stubEnv('SF_CHECK_WORD', 'test'); vi.stubEnv('SF_MONTHLY_CARD', 'test'); vi.stubEnv('SF_SANDBOX_MONTHLY_CARD', 'test'); vi.stubEnv('SF_SERVICES_JSON', '[{"id":2,"name":"test"}]'); mocks.submit.mockRejectedValue(new Error('uncertain write')); const r = await POST(request(payload)); expect(r.status).toBe(500); expect((await r.json()).requestStage).toBeUndefined() })
})
