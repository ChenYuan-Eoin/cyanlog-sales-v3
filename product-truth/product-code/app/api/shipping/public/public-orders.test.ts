// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ShippingError } from '@/lib/shipping/config'

const { create, enforceRate, getEmployee, listMine } = vi.hoisted(() => ({ create: vi.fn(), enforceRate: vi.fn(), getEmployee: vi.fn(), listMine: vi.fn() }))
vi.mock('@/lib/shipping/collaboration', () => ({
  createAnonymousShipment: create,
  listEmployeeShipmentReceipts: listMine,
  publicShipmentReceipt: (order: { orderNo: string; status: string; waybill: string | null; nextReviewAt: string | null; createdAt: string }) => ({ orderNo: order.orderNo, status: order.status, waybill: order.waybill, nextReviewAt: order.nextReviewAt, createdAt: order.createdAt }),
}))
vi.mock('@/lib/shipping/rate-limit', () => ({ enforceAnonymousShippingRate: enforceRate }))
vi.mock('@/lib/shipping/company-email-access', () => ({ requireShippingEmployee: getEmployee }))
import { GET, POST } from './orders/route'

const contact = { name: '测试联系人', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '测试街道1号测试楼' }
const input = { sender: { ...contact, name: '张三', address: '销售本人寄件路9号' }, recipient: contact, cargo: '文件', weight: 1, remark: '', servicePreference: 'standard', source: 'manual', customerName: '星河科技', submittedBy: { name: '张三', phone: '13800000000', team: '华南销售部' }, specialRequirements: '样品易碎' }
const body = { key: '43a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0', input }

beforeEach(() => { create.mockReset(); enforceRate.mockReset(); enforceRate.mockResolvedValue(undefined); getEmployee.mockReset(); getEmployee.mockResolvedValue({ employee: { id: 'employee-1', orgId: 'org-1', sender: input.sender, team: input.submittedBy.team } }); create.mockResolvedValue({ order: { orderNo: 'SO-20260922-ABC12345', status: 'awaiting_confirmation', waybill: null, nextReviewAt: '2026-09-22T09:00:00.000Z', createdAt: '2026-09-22T08:00:00.000Z' }, receiptToken: 'a'.repeat(43) }) })

describe('employee shipment intake', () => {
  it('lists only receipts scoped by the verified identity, ignoring query overrides', async () => {
    listMine.mockResolvedValue([{ orderNo: 'SO-MINE', status: 'awaiting_confirmation' }])
    const response = await GET(new NextRequest('http://localhost/api/shipping/public/orders?employeeId=foreign&orgId=foreign'))
    expect(listMine).toHaveBeenCalledWith('org-1', 'employee-1')
    expect(await response.json()).toEqual({ orders: [{ orderNo: 'SO-MINE', status: 'awaiting_confirmation' }] })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
  it('rejects an unverified caller before creating a workorder', async () => {
    getEmployee.mockRejectedValue(new ShippingError(401, '请先验证公司邮箱。'))
    const response = await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify(body) }))
    expect(response.status).toBe(401); expect(create).not.toHaveBeenCalled()
  })
  it('binds the verified employee independently of caller-provided labels', async () => {
    await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify(body) }))
    expect(create.mock.calls[0][0].employee).toEqual({ id: 'employee-1', sender: input.sender, team: input.submittedBy.team })
  })
  it('accepts a verified employee request without backend login and returns a receipt', async () => { const response = await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify(body) })); expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ orderNo: 'SO-20260922-ABC12345', status: 'awaiting_confirmation', receiptToken: 'a'.repeat(43) }) })
  it('preserves the submitter sender and resolves only the organization on the server', async () => { await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify(body) })); expect(create.mock.calls[0][0].orgId).toBe('org-1'); expect(create.mock.calls[0][0].input.sender).toEqual(input.sender); expect(create.mock.calls[0][0].input.customerName).toBe('星河科技') })
  it('requires the sales sender before creating a workorder', async () => { const response = await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify({ ...body, input: { ...input, sender: undefined } }) })); expect(response.status).toBe(400); expect(create).not.toHaveBeenCalled() })
  it('rejects inconsistent submitter and sender details', async () => { const response = await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify({ ...body, input: { ...input, sender: contact } }) })); expect(response.status).toBe(400); expect(create).not.toHaveBeenCalled() })
  it('rejects cross-origin submission', async () => { const response = await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify(body) })); expect(response.status).toBe(403); expect(create).not.toHaveBeenCalled() })
  it('rejects forged relation fields', async () => { const response = await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify({ ...body, salesRef: 'forged' }) })); expect(response.status).toBe(400); expect(create).not.toHaveBeenCalled() })
  it('rejects caller-supplied organization fields', async () => { const response = await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify({ ...body, orgId: 'org-foreign' }) })); expect(response.status).toBe(400); expect(create).not.toHaveBeenCalled() })
  it('enforces the durable anonymous intake rate limit', async () => { enforceRate.mockRejectedValue(new ShippingError(429, '提交过于频繁，请稍后再试。')); const response = await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify(body) })); expect(response.status).toBe(429); expect(create).not.toHaveBeenCalled() })
})
