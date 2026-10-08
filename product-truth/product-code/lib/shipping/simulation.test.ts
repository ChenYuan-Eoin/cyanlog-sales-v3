import { afterEach, describe, expect, it, vi } from 'vitest'
import { createShippingSimulation, shippingSimulationSettings } from './simulation'
import type { ShipmentOrder, ShippingInput } from './types'

const input: ShippingInput = {
  sender: shippingSimulationSettings.sender,
  recipient: { name: '演示收件人', phone: '13800000001', province: '广东省', city: '深圳市', county: '南山区', address: '示例路1号' },
  cargo: '文件', weight: 1, serviceId: 2, remark: '', source: 'manual', payment: 'sender_monthly',
}
type Receipt = { orderId: string; status: string; waybill: string | null }
afterEach(() => vi.unstubAllGlobals())

describe('shipping demo uses the authenticated order receipt contract', () => {
  it('returns a stable order ID, explicit status and a demo waybill without network access', async () => {
    const fetch = vi.fn(() => { throw new Error('Demo must remain in memory') })
    vi.stubGlobal('fetch', fetch)
    const request = createShippingSimulation()
    const receipt = await request<Receipt>('/api/shipping/owner/orders', { method: 'POST', body: JSON.stringify({ key: 'demo-key', input }) })
    expect(receipt).toEqual({ orderId: 'demo-order-5', status: 'waybill_created', waybill: 'DEMO-000005' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reuses the same order for repeated idempotency keys', async () => {
    const request = createShippingSimulation()
    const init = { method: 'POST', body: JSON.stringify({ key: 'demo-key', input }) }
    const first = await request<Receipt>('/api/shipping/owner/orders', init)
    const second = await request<Receipt>('/api/shipping/owner/orders', init)
    expect(second.orderId).toBe('demo-order-5')
    expect(second).toEqual(first)
    expect((await request<{ records: ShipmentOrder[] }>('/api/shipping/ledger?limit=50')).records).toHaveLength(5)
  })

  it('reconciles the existing record without creating a second order', async () => {
    const request = createShippingSimulation()
    const initial = await request<Receipt>('/api/shipping/owner/orders', { method: 'POST', body: JSON.stringify({ key: 'demo-key', input }) })
    const result = await request<Receipt>(`/api/shipping/ledger/${initial.orderId}/reconcile`, { method: 'POST' })
    expect(result).toEqual(initial)
    await request(`/api/shipping/ledger/${initial.orderId}/cancel`, { method: 'POST' })
    expect(await request(`/api/shipping/ledger/${initial.orderId}/reconcile`, { method: 'POST' })).toEqual({ ...initial, status: 'cancelled' })
    expect((await request<{ records: ShipmentOrder[] }>('/api/shipping/ledger?limit=50')).records).toHaveLength(5)
  })

  it('rejects unknown reconcile IDs instead of using a network fallback', async () => {
    const request = createShippingSimulation()
    await expect(request('/api/shipping/ledger/demo-order-999/reconcile', { method: 'POST' })).rejects.toThrow('未找到')
  })
})
