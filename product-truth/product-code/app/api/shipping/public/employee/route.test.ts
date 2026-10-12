// @vitest-environment node
import {beforeEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
import {ShippingError} from '@/lib/shipping/config'
const m=vi.hoisted(()=>({get:vi.fn(),revoke:vi.fn(),from:vi.fn()}))
vi.mock('@/lib/shipping/wecom-session',()=>({getWecomSession:m.get,revokeWecomSession:m.revoke,wecomProfileDto:(p:unknown)=>p,WECOM_SESSION_COOKIE:'shipping_wecom_session'}))
vi.mock('@/lib/supabase',()=>({supabaseAdmin:{from:m.from}}))
import {GET,POST} from './route'
const req=(body:unknown,origin='https://shipping.example')=>new NextRequest('https://shipping.example/api/shipping/public/employee',{method:'POST',headers:{origin},body:JSON.stringify(body)})
beforeEach(()=>{vi.resetAllMocks();m.get.mockResolvedValue(null)})
it('retires both email challenge and verification actions',async()=>{for(const action of ['request_code','verify_code'])expect((await POST(req({action}))).status).toBe(410);expect(m.from).not.toHaveBeenCalled()})
it('rejects foreign origins',async()=>{expect((await POST(req({action:'logout'},'https://foreign.example'))).status).toBe(403);expect(m.revoke).not.toHaveBeenCalled()})
it('requires a verified member before profile writes',async()=>{expect((await POST(req({action:'save_profile',profile:{}}))).status).toBe(401);expect(m.from).not.toHaveBeenCalled()})
it('does not clear the cookie when server revocation fails',async()=>{m.revoke.mockRejectedValue(new ShippingError(503,'退出失败'));const r=await POST(req({action:'logout'}));expect(r.status).toBe(503);expect(r.headers.get('set-cookie')).toBeNull()})
it('clears only the employee session cookie after revocation',async()=>{const r=await POST(req({action:'logout'}));expect(m.revoke).toHaveBeenCalledOnce();expect(r.headers.get('set-cookie')).toContain('shipping_wecom_session=');expect(r.headers.get('set-cookie')).toContain('Max-Age=0')})
it('does not leak provider or database details',async()=>{m.get.mockRejectedValue(new Error('secret-value'));const r=await GET(new NextRequest('https://shipping.example/api/shipping/public/employee'));expect(r.status).toBe(503);expect(await r.text()).not.toContain('secret-value')})
