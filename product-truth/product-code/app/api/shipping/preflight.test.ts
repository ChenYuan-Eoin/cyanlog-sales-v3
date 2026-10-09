// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), operator: vi.fn(), submit: vi.fn(), create: vi.fn(), runtime: vi.fn(), get: vi.fn(), recent: vi.fn(), imported: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth, AuthError: class extends Error {} }))
vi.mock('@/lib/shipping/service', () => ({ submitShipping: mocks.submit, shippingRequestId: () => 'stable-request-id' }))
vi.mock('@/lib/shipping/sf-client', () => ({ createSfOrder: mocks.create }))
vi.mock('@/lib/shipping/runtime-config', () => ({ getShippingRuntimeConfig: mocks.runtime }))
vi.mock('@/lib/shipping/operator-access', () => ({ requireShippingOperator: mocks.operator }))
vi.mock('@/lib/shipping/store', () => ({ shippingStoreForOrg: () => ({ get: mocks.get, recent: mocks.recent }), publicRecord: (value: unknown) => value }))
vi.mock('@/lib/shipping/outbound', () => ({ listImportedOutbound: mocks.imported }))
import { GET, POST } from './orders/route'
import { AuthError } from '@/lib/auth'
import { ShippingError } from '@/lib/shipping/config'
const contact = { name: '示例收件人', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '示例街道1号' }
const payload = { key: '43a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0', confirmed: true, input: { sender: contact, recipient: contact, cargo: '文件', weight: 1, serviceId: 2, remark: '', source: 'manual' } }
const request = () => new NextRequest('http://localhost/api/shipping/orders', { method: 'POST', body: JSON.stringify(payload) })

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.auth.mockResolvedValue({ id: 'operator-1' })
  mocks.operator.mockResolvedValue('org-1')
  mocks.recent.mockResolvedValue([{ id: 'historical-request', status: 'accepted', waybill: 'SF1234567890123' }])
  mocks.imported.mockResolvedValue([])
})

describe('retired direct carrier submission boundary', () => {
  it('rejects even an authenticated confirmed request before carrier or configuration access', async () => {
    const response = await POST(request())
    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('工单'), requestStage: 'validation' })
    expect(mocks.runtime).not.toHaveBeenCalled()
    expect(mocks.submit).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('retains login and operator authorization on the retired route', async () => {
    mocks.auth.mockRejectedValue(new AuthError())
    expect((await POST(request())).status).toBe(401)
    mocks.auth.mockResolvedValue({ id: 'sales-user' })
    mocks.operator.mockRejectedValue(new ShippingError(403, '仅操作员可访问'))
    expect((await POST(request())).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('preserves authorized historical GET queries without making a new carrier request', async () => {
    const response = await GET(new NextRequest('http://localhost/api/shipping/orders'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ records: [{ id: 'historical-request' }], imported: [], current: null })
    expect(mocks.recent).toHaveBeenCalledWith('operator-1')
    expect(mocks.submit).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
