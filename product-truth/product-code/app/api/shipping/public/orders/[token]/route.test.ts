// @vitest-environment node
import {beforeEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const m=vi.hoisted(()=>({options:vi.fn(),session:vi.fn(),receipt:vi.fn()}))
vi.mock('@/lib/shipping/intake-options',()=>({loadPublicIntakeOptions:m.options}))
vi.mock('@/lib/shipping/wecom-session',()=>({getWecomSession:m.session}))
vi.mock('@/lib/shipping/collaboration',()=>({getShipmentByReceipt:m.receipt,publicShipmentReceipt:(v:unknown)=>v}))
import {GET} from './route'
const request=()=>new NextRequest('https://shipping.example/api/shipping/public/orders/token?employeeId=foreign')
beforeEach(()=>{vi.resetAllMocks();m.options.mockResolvedValue({requireVerification:true,orgId:'org'});m.session.mockResolvedValue(null)})
it('does not accept a bare receipt link as identity in whitelist mode',async()=>{expect((await GET(request(),{params:Promise.resolve({token:'a'.repeat(43)})})).status).toBe(401);expect(m.receipt).not.toHaveBeenCalled()})
it('scopes lookup to the authenticated owner rather than a query parameter',async()=>{m.session.mockResolvedValue({orgId:'org',id:'staff'});m.receipt.mockResolvedValue(null);expect((await GET(request(),{params:Promise.resolve({token:'a'.repeat(43)})})).status).toBe(404);expect(m.receipt).toHaveBeenCalledWith('a'.repeat(43),{orgId:'org',employeeId:'staff'})})

it('allows a private anonymous receipt link without checking an unrelated or stale WeCom session',async()=>{
 m.options.mockResolvedValue({requireVerification:false,orgId:'org'})
 m.session.mockRejectedValue(new Error('WeCom unavailable'))
 m.receipt.mockResolvedValue({orderNo:'SO-TEST',status:'awaiting_confirmation',waybill:null})
 const response=await GET(request(),{params:Promise.resolve({token:'a'.repeat(43)})})
 expect(response.status).toBe(200)
 expect(m.session).not.toHaveBeenCalled()
 expect(m.receipt).toHaveBeenCalledWith('a'.repeat(43),undefined)
})
it('does not return a receipt for an invalid anonymous token',async()=>{
 m.options.mockResolvedValue({requireVerification:false,orgId:'org'});m.receipt.mockResolvedValue(null)
 expect((await GET(request(),{params:Promise.resolve({token:'invalid'})})).status).toBe(404)
})
