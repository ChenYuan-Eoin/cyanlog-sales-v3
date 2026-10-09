// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ShippingError } from '@/lib/shipping/config'
const mocks = vi.hoisted(() => ({ get: vi.fn(), request: vi.fn(), verify: vi.fn(), require: vi.fn(), save: vi.fn(), revoke: vi.fn() }))
vi.mock('@/lib/shipping/company-email-access', () => ({ getShippingEmployeeSession: mocks.get, requestEmployeeEmailCode: mocks.request, verifyEmployeeEmailCode: mocks.verify, requireShippingEmployee: mocks.require, saveShippingEmployeeProfile: mocks.save, revokeShippingEmployeeSession: mocks.revoke, employeePublicProfile: (e: {id: string; email: string}) => ({id: e.id, email: e.email}) }))
vi.mock('@/lib/shipping/http', () => ({ shippingJson: (req: NextRequest) => req.json() }))
import { GET, POST } from './route'
const employee = { id: 'employee-1', email: 'person@ones.cn', orgId: 'private-org', sessionVersion: 1 }
const req = (body: unknown, origin: string | null = 'https://shipping.example') => new NextRequest('https://shipping.example/api/shipping/public/employee', { method: 'POST', headers: origin ? { origin } : {}, body: JSON.stringify(body) })
beforeEach(() => { vi.resetAllMocks(); mocks.get.mockResolvedValue(null); mocks.require.mockResolvedValue({ employee }); mocks.save.mockResolvedValue(employee); mocks.verify.mockResolvedValue({ employee, sessionToken: 'x'.repeat(43) }) })
describe('employee email HTTP boundary', () => {
  it('returns signed-out state without backend login', async () => {
    const r = await GET(new NextRequest('https://shipping.example/api/shipping/public/employee'))
    expect(await r.json()).toEqual({ employee: null }); expect(r.headers.get('cache-control')).toContain('no-store')
  })
  it('rejects absent or foreign Origin before sending mail', async () => {
    for (const origin of [null, 'https://foreign.example']) expect((await POST(req({ action: 'request_code', email: employee.email }, origin))).status).toBe(403)
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('rejects organization override', async () => {
    expect((await POST(req({ action: 'request_code', email: employee.email, orgId: 'foreign' }))).status).toBe(400)
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('keeps session in an HttpOnly scoped cookie, without internal identity fields in JSON', async () => {
    const input = { email: employee.email, challengeId: '43a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0', code: '012345' }
    const r = await POST(req({ action: 'verify_code', ...input }))
    expect(await r.json()).toEqual({ employee: { id: employee.id, email: employee.email } })
    const cookie = r.headers.get('set-cookie')!
    for (const value of ['shipping_employee_session=', 'HttpOnly', 'SameSite=strict', 'Path=/api/shipping/public', 'Max-Age=5184000']) expect(cookie).toContain(value)
    expect(cookie).not.toContain('auth_token='); expect(mocks.verify).toHaveBeenCalledWith(input)
  })
  it('requires verified employee before profile writes', async () => {
    mocks.require.mockRejectedValue(new ShippingError(401, '请先验证公司邮箱。'))
    expect((await POST(req({ action: 'save_profile', profile: {} }))).status).toBe(401); expect(mocks.save).not.toHaveBeenCalled()
  })
  it('does not clear cookie when revocation fails', async () => {
    mocks.revoke.mockRejectedValue(new ShippingError(503, '退出暂未完成。'))
    const r = await POST(req({ action: 'logout' })); expect(r.status).toBe(503); expect(r.headers.get('set-cookie')).toBeNull()
  })
  it('revokes before clearing the employee cookie', async () => {
    const r = await POST(req({ action: 'logout' })); expect(mocks.revoke).toHaveBeenCalledOnce(); expect(r.headers.get('set-cookie')).toContain('Max-Age=0')
  })
  it('hides internal failures', async () => {
    mocks.get.mockRejectedValue(new Error('sensitive password'))
    const r = await GET(new NextRequest('https://shipping.example/api/shipping/public/employee'))
    expect(r.status).toBe(500); expect(await r.text()).not.toContain('sensitive')
  })
})
