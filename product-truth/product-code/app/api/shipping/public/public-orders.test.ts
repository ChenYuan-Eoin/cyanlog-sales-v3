// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ShippingError } from '@/lib/shipping/config'

const { create, enforceRate } = vi.hoisted(() => ({ create: vi.fn(), enforceRate: vi.fn() }))
vi.mock('@/lib/shipping/collaboration', () => ({
  createAnonymousShipment: create,
  publicShipmentReceipt: (order: { orderNo: string; status: string; waybill: string | null; nextReviewAt: string | null; createdAt: string }) => ({ orderNo: order.orderNo, status: order.status, waybill: order.waybill, nextReviewAt: order.nextReviewAt, createdAt: order.createdAt }),
}))
vi.mock('@/lib/shipping/rate-limit', () => ({ enforceAnonymousShippingRate: enforceRate }))
import { POST } from './orders/route'

const contact = { name: '测试联系人', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '测试街道1号测试楼' }
const input = { recipient: contact, cargo: '文件', weight: 1, remark: '', serviceId: 2, source: 'manual', customerName: '星河科技', submittedBy: { name: '张三', phone: '13800000000', team: '华南销售部' }, specialRequirements: '样品易碎' }
const body = { key: '43a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0', input }

beforeEach(() => { vi.stubEnv('SHIPPING_SENDER_JSON', JSON.stringify(contact)); create.mockReset(); enforceRate.mockReset(); enforceRate.mockResolvedValue(undefined); create.mockResolvedValue({ order: { orderNo: 'SO-20260922-ABC12345', status: 'awaiting_confirmation', waybill: null, nextReviewAt: '2026-09-22T09:00:00.000Z', createdAt: '2026-09-22T08:00:00.000Z' }, receiptToken: 'a'.repeat(43) }) })

describe('anonymous shipment intake', () => {
  it('accepts a valid request without login and returns a receipt', async () => { const response = await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify(body) })); expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ orderNo: 'SO-20260922-ABC12345', status: 'awaiting_confirmation', receiptToken: 'a'.repeat(43) }) })
  it('injects the configured sender without exposing it to the sales form', async () => { await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', body: JSON.stringify(body) })); expect(create.mock.calls[0][0].input.sender).toEqual(contact); expect(create.mock.calls[0][0].input.customerName).toBe('星河科技') })
  it('rejects cross-origin submission', async () => { const response = await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify(body) })); expect(response.status).toBe(403); expect(create).not.toHaveBeenCalled() })
  it('rejects forged relation fields', async () => { const response = await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', body: JSON.stringify({ ...body, salesRef: 'forged' }) })); expect(response.status).toBe(400); expect(create).not.toHaveBeenCalled() })
  it('enforces the durable anonymous intake rate limit', async () => { enforceRate.mockRejectedValue(new ShippingError(429, '提交过于频繁，请稍后再试。')); const response = await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', body: JSON.stringify(body) })); expect(response.status).toBe(429); expect(create).not.toHaveBeenCalled() })
})
