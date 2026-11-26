// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ShippingError } from '@/lib/shipping/config'

const deptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const selected = { id: deptId, name: '真实销售部', path: '总部 / 真实销售部', parentId: null, isPrimary: true }
const sender = { name: '公司前台', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '公司路8号' }
const recipient = { name: '收件人', phone: '13900000000', province: '浙江省', city: '杭州市', county: '西湖区', address: '示例路1号' }
const m = vi.hoisted(() => ({ create: vi.fn(), departments: vi.fn(), resolve: vi.fn(), rules: vi.fn(), sender: vi.fn() }))
vi.mock('@/lib/shipping/http', () => ({
  shippingJson: (req: NextRequest) => req.json(),
  shippingHandler: async (_req: NextRequest, action: (user: { id: string; display_name: string; phone: string }, org: string, selfSubmit: boolean) => Promise<unknown>) => {
    try { return Response.json(await action({ id: 'employee-1', display_name: '真实员工', phone: '13600000000' }, 'org-1', true)) }
    catch (error) { return Response.json({ error: (error as Error).message }, { status: (error as ShippingError).status || 500 }) }
  },
}))
vi.mock('@/lib/shipping/intake-settings', () => ({ loadIntakeSettings: m.rules }))
vi.mock('@/lib/shipping/sender-profile', () => ({ loadDefaultShippingSender: m.sender }))
vi.mock('@/lib/shipping/department-access', () => ({ loadEmployeeShippingDepartments: m.departments, resolveEmployeeShippingDepartment: m.resolve }))
vi.mock('@/lib/shipping/collaboration', () => ({ createOwnerShipment: m.create, listOwnerShipmentReceipts: vi.fn(), publicShipmentReceipt: (order: { orderNo: string; status: string; waybill: null }) => order }))
import { POST } from './orders/route'

const request = () => new NextRequest('https://example.test/api/shipping/owner/orders', { method: 'POST', body: JSON.stringify({ key: '43a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0', input: { recipient, customerName: '星河科技', cargo: '文件', servicePreference: 'standard', submittedBy: { name: '伪造员工', phone: '13800000000', team: '伪造部门', departmentId: deptId } } }) })
beforeEach(() => {
  m.create.mockReset().mockResolvedValue({ id: 'order-1', orderNo: 'SO-1', status: 'awaiting_confirmation', waybill: null })
  m.sender.mockReset().mockResolvedValue(sender)
  m.rules.mockReset().mockResolvedValue({ companyName: { enabled: true, required: true, minLength: 4 }, team: { enabled: true, required: false, minLength: 1 }, teamOptions: ['伪造部门'], allowedDepartmentIds: [deptId] })
  m.departments.mockReset().mockResolvedValue([selected])
  m.resolve.mockReset().mockReturnValue(selected)
})

it('persists the current verified department and identity rather than submitted team text', async () => {
  expect((await POST(request())).status).toBe(202)
  expect(m.departments).toHaveBeenCalledWith('employee-1', 'org-1', expect.objectContaining({ allowedDepartmentIds: [deptId] }))
  expect(m.resolve).toHaveBeenCalledWith([selected], deptId, '伪造部门')
  expect(m.create.mock.calls[0][0].input.submittedBy).toEqual({ name: '真实员工', phone: '13600000000', team: '真实销售部', departmentId: deptId })
  expect(m.create.mock.calls[0][0].attributedDepartmentId).toBe(deptId)
})

it('blocks a revoked department before creating a work order', async () => {
  m.departments.mockResolvedValue([])
  m.resolve.mockImplementation(() => { throw new ShippingError(403, '所属部门未开放提报') })
  expect((await POST(request())).status).toBe(403)
  expect(m.create).not.toHaveBeenCalled()
})
