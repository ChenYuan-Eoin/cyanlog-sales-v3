// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ create: vi.fn(), settings: vi.fn(), runtime: vi.fn(), chooseService: vi.fn(), confirm: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: async () => ({ id: 'operator-1' }), AuthError: class extends Error {} }))
vi.mock('@/lib/shipping/runtime-config', () => ({ loadShippingSettings: mocks.settings, getShippingRuntimeConfig: mocks.runtime, selectAuthorizedShippingService: mocks.chooseService }))
vi.mock('@/lib/shipping/operator-access', () => ({ requireShippingOperator: async () => 'org-1' }))
vi.mock('@/lib/shipping/collaboration', () => ({ createOwnerShipment: mocks.create, publicShipmentReceipt: (order: { orderNo: string; status: string; waybill: string | null }) => ({ orderNo: order.orderNo, status: order.status, waybill: order.waybill }) }))
vi.mock('@/lib/shipping/workflow', () => ({ confirmAndSubmitShipment: mocks.confirm }))
import { POST } from './orders/route'

const serverSender = { name: '公司前台', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '公司路8号' }
const suppliedSender = { name: '伪造寄件人', phone: '13900000000', province: '浙江省', city: '杭州市', county: '西湖区', address: '客户路1号' }
const runtime = { orgId: 'org-1', connectionId: '23a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0', environment: 'sandbox', partnerId: 'partner', checkWord: 'secret', billingAccountId: '33a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0', billingAccount: '123456', billingAccountTail: '3456', senderProfileId: '53a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0', sender: serverSender, connectionKey: 'connection-key', services: [{ id: 2, name: '标准服务', preference: 'standard' }], snapshot: {} }
const body = { key: '43a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0', confirmed: true, connectionId: runtime.connectionId, billingAccountId: runtime.billingAccountId, input: { sender: suppliedSender, recipient: suppliedSender, cargo: '文件', weight: 1, serviceId: 2, remark: '', source: 'manual', payment: 'sender_monthly' } }

beforeEach(() => {
  mocks.create.mockReset().mockResolvedValue({ id: 'order-1', orderNo: 'SO-20261008-ABC12345', status: 'accepted', waybill: null })
  mocks.settings.mockReset().mockResolvedValue({ defaultBillingAccountId: 'account-1' })
  mocks.runtime.mockReset().mockResolvedValue(runtime)
  mocks.chooseService.mockReset().mockReturnValue(runtime.services[0])
  mocks.confirm.mockReset().mockResolvedValue({ status: 'waybill_created', waybill: 'SF1234567890123' })
})

describe('owner order consumes server-configured sender and account', () => {
  it('overwrites client sender details and records only a non-secret configuration snapshot', async () => {
    const response = await POST(new NextRequest('http://localhost/api/shipping/owner/orders', { method: 'POST', body: JSON.stringify(body) }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ orderId: 'order-1', orderNo: 'SO-20261008-ABC12345', status: 'waybill_created', waybill: 'SF1234567890123' })
    expect(mocks.runtime).toHaveBeenCalledWith({ orgId: runtime.orgId, billingAccountId: runtime.billingAccountId, connectionId: runtime.connectionId })
    expect(mocks.settings).toHaveBeenCalledWith('org-1')
    const createArgs = mocks.create.mock.calls[0][0]
    expect(createArgs.input.sender).toEqual(serverSender)
    expect(createArgs.snapshot).toMatchObject({ orgId: runtime.orgId, connectionId: runtime.connectionId, billingAccountId: runtime.billingAccountId, senderProfileId: runtime.senderProfileId, billingAccountTail: '3456' })
    expect(JSON.stringify(createArgs)).not.toContain('secret')
    expect(mocks.confirm).toHaveBeenCalledWith('order-1', 'operator-1', 'org-1', { connectionId: runtime.connectionId, billingAccountId: runtime.billingAccountId, serviceId: 2 })
  })

  it('returns a stable order ID with an unknown result so the existing order can be reconciled', async () => {
    mocks.confirm.mockResolvedValue({ status: 'order_unknown', waybill: null })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await POST(new NextRequest('http://localhost/api/shipping/owner/orders', { method: 'POST', body: JSON.stringify(body) }))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ orderId: 'order-1', orderNo: 'SO-20261008-ABC12345', status: 'order_unknown', waybill: null })
    }
    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(mocks.create.mock.calls.map(([submission]) => submission.key)).toEqual([body.key, body.key])
  })

  it('returns the existing order ID on an idempotent success without confirming again', async () => {
    mocks.create.mockResolvedValue({ id: 'order-1', orderNo: 'SO-20261008-ABC12345', status: 'waybill_created', waybill: 'SF1234567890123' })
    const response = await POST(new NextRequest('http://localhost/api/shipping/owner/orders', { method: 'POST', body: JSON.stringify(body) }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ orderId: 'order-1', orderNo: 'SO-20261008-ABC12345', status: 'waybill_created', waybill: 'SF1234567890123' })
    expect(mocks.confirm).not.toHaveBeenCalled()
  })
})
