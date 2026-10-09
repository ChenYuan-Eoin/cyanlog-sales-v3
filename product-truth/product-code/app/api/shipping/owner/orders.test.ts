// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), operator: vi.fn(), create: vi.fn(), settings: vi.fn(), runtime: vi.fn(), chooseService: vi.fn(), confirm: vi.fn(), carrier: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth, AuthError: class extends Error {} }))
vi.mock('@/lib/shipping/runtime-config', () => ({ loadShippingSettings: mocks.settings, getShippingRuntimeConfig: mocks.runtime, selectAuthorizedShippingService: mocks.chooseService }))
vi.mock('@/lib/shipping/operator-access', () => ({ requireShippingOperator: mocks.operator }))
vi.mock('@/lib/shipping/collaboration', () => ({ createOwnerShipment: mocks.create, publicShipmentReceipt: (order: { orderNo: string; status: string; waybill: string | null }) => ({ orderNo: order.orderNo, status: order.status, waybill: order.waybill }) }))
vi.mock('@/lib/shipping/workflow', () => ({ confirmAndSubmitShipment: mocks.confirm }))
vi.mock('@/lib/shipping/sf-client', () => ({ createSfOrder: mocks.carrier }))
import { POST } from './orders/route'
import { AuthError } from '@/lib/auth'
import { ShippingError } from '@/lib/shipping/config'

const companySender = { name: '示例前台', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '示例公司路8号' }
const recipient = { name: '示例收件人', phone: '13900000000', province: '浙江省', city: '杭州市', county: '西湖区', address: '示例路1号' }
const key = '43a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0'
const minimalBody = { key, input: { recipient, cargo: '文件', servicePreference: 'standard' } }
const request = (body: unknown) => new NextRequest('http://localhost/api/shipping/owner/orders', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  mocks.auth.mockReset().mockResolvedValue({ id: 'operator-1' })
  mocks.operator.mockReset().mockResolvedValue('org-1')
  mocks.create.mockReset().mockResolvedValue({ id: 'order-1', orderNo: 'SO-20261008-ABC12345', status: 'awaiting_confirmation', waybill: null })
  mocks.settings.mockReset().mockResolvedValue({ sender: companySender, defaultBillingAccountId: undefined, canSubmit: false })
  mocks.runtime.mockReset()
  mocks.chooseService.mockReset()
  mocks.confirm.mockReset()
  mocks.carrier.mockReset()
})

describe('operator intake creates a work order without carrier submission', () => {
  it('accepts recipient-only business fields without carrier readiness, account or service ID', async () => {
    const response = await POST(request(minimalBody))
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ orderId: 'order-1', requestNumber: 'SO-20261008-ABC12345', orderNo: 'SO-20261008-ABC12345', status: 'awaiting_confirmation', waybill: null })
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', userId: 'operator-1', key, input: expect.objectContaining({ sender: companySender, recipient, cargo: '文件', weight: 1, source: 'manual', remark: '', servicePreference: 'standard' }) }))
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('snapshot')
    expect(mocks.runtime).not.toHaveBeenCalled()
    expect(mocks.chooseService).not.toHaveBeenCalled()
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.carrier).not.toHaveBeenCalled()
  })

  it('does not turn legacy confirmed/carrier selection fields into an instruction to call SF', async () => {
    const response = await POST(request({ ...minimalBody, confirmed: true, connectionId: '23a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0', billingAccountId: '33a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0', input: { ...minimalBody.input, serviceId: 2, sender: companySender } }))
    expect(response.status).toBe(202)
    expect(mocks.create.mock.calls[0][0].input).not.toHaveProperty('serviceId')
    expect(mocks.runtime).not.toHaveBeenCalled()
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.carrier).not.toHaveBeenCalled()
  })

  it('retains a complete sender supplied by an authorized operator', async () => {
    const sender = { ...companySender, name: '示例另址寄件人', address: '另一示例路9号' }
    const response = await POST(request({ ...minimalBody, input: { ...minimalBody.input, sender } }))
    expect(response.status).toBe(202)
    expect(mocks.create.mock.calls[0][0].input.sender).toEqual(sender)
  })

  it('keeps a missing company sender visible as an incomplete draft without calling SF', async () => {
    mocks.settings.mockResolvedValue({ sender: { name: '', phone: '', province: '', city: '', county: '', address: '' }, canSubmit: false })
    const response = await POST(request(minimalBody))
    expect(response.status).toBe(202)
    expect(mocks.create.mock.calls[0][0].input.sender.name).toBe('')
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.carrier).not.toHaveBeenCalled()
  })

  it.each(['awaiting_confirmation', 'order_unknown', 'waybill_created'] as const)('returns the existing %s work order without confirming or reconciling it', async status => {
    mocks.create.mockResolvedValue({ id: 'order-1', orderNo: 'SO-20261008-ABC12345', status, waybill: status === 'waybill_created' ? 'SF1234567890123' : null })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await POST(request(minimalBody))
      expect(response.status).toBe(202)
      expect(await response.json()).toMatchObject({ orderId: 'order-1', status })
    }
    expect(mocks.create.mock.calls.map(([args]) => args.key)).toEqual([key, key])
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.carrier).not.toHaveBeenCalled()
  })

  it('rejects incomplete recipient data before saving a work order', async () => {
    expect((await POST(request({ ...minimalBody, input: { ...minimalBody.input, recipient: { ...recipient, address: '' } } }))).status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('keeps anonymous and non-operator users out of the internal intake', async () => {
    mocks.auth.mockRejectedValue(new AuthError())
    expect((await POST(request(minimalBody))).status).toBe(401)
    mocks.auth.mockResolvedValue({ id: 'sales-user' })
    mocks.operator.mockRejectedValue(new ShippingError(403, '仅寄件操作员可操作'))
    expect((await POST(request(minimalBody))).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
