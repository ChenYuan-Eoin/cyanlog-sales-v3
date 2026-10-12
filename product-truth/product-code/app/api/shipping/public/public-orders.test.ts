// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ShippingError } from '@/lib/shipping/config'

const { create, enforceRate, getEmployee, listMine, options } = vi.hoisted(() => ({ create: vi.fn(), enforceRate: vi.fn(), getEmployee: vi.fn(), listMine: vi.fn(), options: vi.fn() }))
vi.mock('@/lib/shipping/collaboration', () => ({
  createAnonymousShipment: create,
  listEmployeeShipmentReceipts: listMine,
  publicShipmentReceipt: (order: { orderNo: string; status: string; waybill: string | null; nextReviewAt: string | null; createdAt: string }) => ({ orderNo: order.orderNo, status: order.status, waybill: order.waybill, nextReviewAt: order.nextReviewAt, createdAt: order.createdAt }),
}))
vi.mock('@/lib/shipping/rate-limit', () => ({ enforceAnonymousShippingRate: enforceRate }))
vi.mock('@/lib/shipping/wecom-session', () => ({ getWecomSession: getEmployee }))
vi.mock('@/lib/shipping/intake-options', () => ({ loadPublicIntakeOptions: options }))
import { GET, POST } from './orders/route'

const contact = { name: '测试联系人', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '测试街道1号测试楼' }
const input = { sender: { ...contact, name: '张三', address: '销售本人寄件路9号' }, recipient: contact, cargo: '文件', weight: 1, remark: '', servicePreference: 'standard', source: 'manual', customerName: '星河科技', submittedBy: { name: '张三', phone: '13800000000', team: '华南销售部' }, specialRequirements: '样品易碎' }
const body = { key: '43a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0', input }

beforeEach(() => { options.mockReset(); options.mockResolvedValue({ orgId: 'org-1', requireVerification: false, emailAvailable: false, services: [{ id: 2, name: '顺丰标快', preference: 'standard' }, { id: 6, name: '顺丰即日', preference: 'urgent' }] }); create.mockReset(); enforceRate.mockReset(); enforceRate.mockResolvedValue(undefined); getEmployee.mockReset(); getEmployee.mockResolvedValue({ id: 'employee-1', orgId: 'org-1', userId: 'staff-a', name: input.sender.name, phone: input.sender.phone, phoneSource: 'wecom', companyName: input.customerName, sender: input.sender, team: input.submittedBy.team }); create.mockResolvedValue({ order: { orderNo: 'SO-20260922-ABC12345', status: 'awaiting_confirmation', waybill: null, nextReviewAt: '2026-09-22T09:00:00.000Z', createdAt: '2026-09-22T08:00:00.000Z' }, receiptToken: 'a'.repeat(43) }) })

describe('employee shipment intake', () => {
  it('lists only receipts scoped by the verified identity, ignoring query overrides', async () => {
    listMine.mockResolvedValue([{ orderNo: 'SO-MINE', status: 'awaiting_confirmation' }])
    const response = await GET(new NextRequest('http://localhost/api/shipping/public/orders?employeeId=foreign&orgId=foreign'))
    expect(listMine).toHaveBeenCalledWith('org-1', 'employee-1')
    expect(await response.json()).toEqual({ orders: [{ orderNo: 'SO-MINE', status: 'awaiting_confirmation' }] })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
  it('rejects an unverified caller before creating a workorder', async () => {
    getEmployee.mockResolvedValue(null); options.mockResolvedValue({ orgId: 'org-1', requireVerification: true, services: [{ id: 2, name: '顺丰标快', preference: 'standard' }] })
    const response = await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify(body) }))
    expect(response.status).toBe(401); expect(create).not.toHaveBeenCalled()
  })
  it('binds the verified employee independently of caller-provided labels', async () => {
    await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify(body) }))
    expect(create.mock.calls[0][0].employee).toMatchObject({ id: 'employee-1', identity: { provider: 'wecom', userId: 'staff-a', phoneSource: 'wecom' } })
  })
  it('accepts a verified employee request without backend login and returns a receipt', async () => { const response = await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify(body) })); expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ orderNo: 'SO-20260922-ABC12345', status: 'awaiting_confirmation', receiptToken: 'a'.repeat(43) }) })
  it('preserves the submitter sender and resolves only the organization on the server', async () => { await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify(body) })); expect(create.mock.calls[0][0].orgId).toBe('org-1'); expect(create.mock.calls[0][0].input.sender).toEqual(input.sender); expect(create.mock.calls[0][0].input.customerName).toBe('星河科技') })
  it('requires the sales sender before creating a workorder', async () => { const response = await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify({ ...body, input: { ...input, sender: undefined } }) })); expect(response.status).toBe(400); expect(create).not.toHaveBeenCalled() })
  it('rejects inconsistent submitter and sender details', async () => { const response = await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify({ ...body, input: { ...input, sender: contact } }) })); expect(response.status).toBe(400); expect(create).not.toHaveBeenCalled() })
  it('rejects cross-origin submission', async () => { const response = await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify(body) })); expect(response.status).toBe(403); expect(create).not.toHaveBeenCalled() })
  it('rejects forged relation fields', async () => { const response = await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify({ ...body, salesRef: 'forged' }) })); expect(response.status).toBe(400); expect(create).not.toHaveBeenCalled() })
  it('rejects caller-supplied organization fields', async () => { const response = await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify({ ...body, orgId: 'org-foreign' }) })); expect(response.status).toBe(400); expect(create).not.toHaveBeenCalled() })
  it('enforces the durable anonymous intake rate limit', async () => { enforceRate.mockRejectedValue(new ShippingError(429, '提交过于频繁，请稍后再试。')); const response = await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify(body) })); expect(response.status).toBe(429); expect(create).not.toHaveBeenCalled() })
  it('accepts an anonymous workorder with no email session and no login', async () => {
    getEmployee.mockResolvedValue(null)
    const response = await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify(body) }))
    expect(response.status).toBe(202); expect(create.mock.calls[0][0]).not.toHaveProperty('employee')
    expect(create.mock.calls[0][0]).toMatchObject({ orgId: 'org-1', input: { serviceId: 2, serviceName: '顺丰标快' } })
  })
  it('accepts configured products beyond the old standard/urgent choices and rejects unconfigured codes', async () => {
    getEmployee.mockResolvedValue(null)
    const req = (serviceId: number) => new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify({ ...body, input: { ...input, serviceId } }) })
    expect((await POST(req(6))).status).toBe(202)
    expect(create.mock.calls[0][0].input).toMatchObject({ serviceId: 6, serviceName: '顺丰即日' })
    create.mockClear(); expect((await POST(req(999))).status).toBe(400); expect(create).not.toHaveBeenCalled()
  })
  it('rejects another organization WeCom session without creating a workorder', async () => {
    getEmployee.mockResolvedValue({ id: 'other', orgId: 'foreign' })
    const response = await POST(new NextRequest('http://localhost/api/shipping/public/orders', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify(body) }))
    expect(response.status).toBe(403); expect(create).not.toHaveBeenCalled()
  })

})

it('rejects consistently forged sender identity against the authenticated WeCom member', async () => {
 const response=await POST(new NextRequest('http://localhost/api/shipping/public/orders',{method:'POST',headers:{origin:'http://localhost'},body:JSON.stringify({...body,input:{...input,sender:{...input.sender,name:'冒充同事'},submittedBy:{...input.submittedBy,name:'冒充同事'}}})}))
 expect(response.status).toBe(403);expect(create).not.toHaveBeenCalled()
})

it('does not require a current valid phone to read existing owned orders',async()=>{
 getEmployee.mockResolvedValue({id:'employee-1',orgId:'org-1',phoneSource:'unavailable'})
 listMine.mockResolvedValue([])
 expect((await GET(new NextRequest('http://localhost/api/shipping/public/orders'))).status).toBe(200)
 expect((await POST(new NextRequest('http://localhost/api/shipping/public/orders',{method:'POST',headers:{origin:'http://localhost'},body:JSON.stringify(body)}))).status).toBe(422)
 expect(create).not.toHaveBeenCalled()
})
