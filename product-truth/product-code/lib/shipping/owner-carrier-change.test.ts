// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { ShippingError } from './config'
const m = vi.hoisted(()=>({rpc:vi.fn(),connect:vi.fn(),route:vi.fn(),send:vi.fn(),auth:vi.fn(),operator:vi.fn()}))
vi.mock('@/lib/supabase',()=>({supabaseAdmin:{rpc:m.rpc}}))
vi.mock('./carrier-adapter',()=>({ getCarrierAdapter:()=>({connect:m.connect}) }))
vi.mock('@/lib/auth',()=>({requireAuth:m.auth, AuthError:class extends Error{}}))
vi.mock('./operator-access',()=>({ requireShippingOperator:m.operator }))
vi.mock('./entry-access',()=>({
  resolveShippingOwnerAccess:async () => ({ orgId: await m.operator(), ownerPermissions: ['shipping:owner_change'] }),
}))
import { GET, POST } from '@/app/api/shipping/owner/orders/[orderNo]/carrier-changes/route'
import { GET as ledgerGet, POST as ledgerPost } from '@/app/api/shipping/ledger/[id]/carrier-changes/route'
const owner='6f321e6a-2240-4074-ab2a-659b07af0aac',org='09367238-10fd-45cb-8501-96ec7778185d',key='a6215cc6-142b-4de8-8e6b-e22dce66346d'
const operator='82bee2dd-7de8-45a2-afd3-ca0408526f42'
const orderNo='SO-20261118-AB128539'
const contact={name:'样例',phone:'13800000000',province:'广东省',city:'深圳市',county:'南山区',address:'测试路1号'}
const target={...contact,address:'测试路2号'}
const ctx={params:Promise.resolve({orderNo})}
const routeUrl='https://example.test/api/shipping/owner/orders/'+orderNo+'/carrier-changes'
const req=(body?:unknown)=>new NextRequest(routeUrl,body?{method:'POST',body:JSON.stringify(body)}:{})
const context={connectionId:key,accountId:org,environment:'production',binding:'a'.repeat(64),providerOrderId:'original',waybill:'SF1234567890123'}
const detail={result:'detail',orderNo,context,returnDestination:contact,currentRecipient:target,latest:null}
const latest={ action:'return_to_sender',status:'pending',destination:contact,originalRecipient:target,requestedAt:'2026-11-18T01:00:00Z',instructionId:null,amount:null }
const submission={action:'return_to_sender',key}
beforeEach(()=>{
  vi.resetAllMocks()
  m.auth.mockResolvedValue({id:owner})
  m.operator.mockResolvedValue(org)
  m.connect.mockResolvedValue({beforeDispatch:m.route,changeRecipient:m.send})
  m.route.mockResolvedValue(true)
  m.send.mockResolvedValue({instructionId:'CUS1',amount:'2.55'})
})
const resolves=(data:unknown)=>({data,error:null})
it('returns only server-established actions, hides unverified environments and makes no visits to SF on read',async()=>{
  m.rpc.mockResolvedValueOnce(resolves({...detail,context:null,returnDestination:null,currentRecipient:null}))
    .mockResolvedValueOnce(resolves(detail))
  expect(await (await GET(req(),ctx)).json()).toEqual({orderNo,actions:[],currentRecipient:null,returnDestination:null,latest:null})
  expect(await (await GET(req(),ctx)).json()).toMatchObject({orderNo,actions:['modify_recipient','return_to_sender']})
  expect(m.connect).not.toHaveBeenCalled()
})
it('checks sandbox routes only after explicitly loading a single authorized sandbox order, and never submits on read',async()=>{
  m.rpc.mockResolvedValue(resolves({...detail,context:{...context,environment:'sandbox'}}))
  m.route.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  expect(await (await GET(req(),ctx)).json()).toMatchObject({actions:[]})
  expect(await (await GET(req(),ctx)).json()).toMatchObject({actions:['modify_recipient','return_to_sender']})
  expect(m.connect).toHaveBeenCalledWith(expect.objectContaining({expectedEnvironment:'sandbox'}))
  expect(m.send).not.toHaveBeenCalled()
})
it('replays without querying the carrier; request shape rejects client-selected payers, return destinations and fake identity',async()=>{
  m.rpc.mockResolvedValueOnce(resolves({result:'replay',latest}))
  expect(await (await POST(req(submission),ctx)).json()).toEqual(latest)
  for(const invalid of [{...submission,recipient:target},{...submission,orgId:org},{...submission,payMode:1},{key,action:'modify_recipient',recipient:{...target,phone:'bad'}}]) {
    expect((await POST(req(invalid),ctx)).status).toBe(400)
  }
  expect(m.connect).not.toHaveBeenCalled()
})
it('never dispatches a different waybill or an out-of-delivery order when preflight or the lock fails',async()=>{
  m.rpc.mockResolvedValueOnce(resolves(detail))
  m.route.mockResolvedValueOnce(false)
  expect((await POST(req(submission),ctx)).status).toBe(409)
  m.rpc.mockResolvedValueOnce(resolves(detail)).mockResolvedValueOnce({error:{code:'40001'}})
  expect((await POST(req(submission),ctx)).status).toBe(409)
  expect(m.route).toHaveBeenCalledWith('original','SF1234567890123')
  expect(m.send).not.toHaveBeenCalled()
})
it.each(['accepted','unknown','not_sent','rejected'] as const)('persists %s on the original order using the original connection and server-selected sender',async outcome=>{
  m.rpc.mockResolvedValueOnce(resolves(detail)).mockResolvedValueOnce(resolves({result:'dispatch'})).mockResolvedValueOnce(resolves(true))
    .mockResolvedValueOnce(resolves({result:'replay',latest:{...latest,status:outcome}}))
  if(outcome!=='accepted')m.send.mockRejectedValue(new ShippingError(502,'transport',outcome==='unknown'?'provider_unreachable':outcome==='not_sent'?'provider_not_sent':'provider_rejected'))
  const response=await POST(req(submission),ctx)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({status:outcome})
  expect(m.connect).toHaveBeenCalledWith(expect.objectContaining({orgId:org,connectionId:key,billingAccountId:org,expectedEnvironment:'production',payment:'sender_monthly'}))
  expect(m.send).toHaveBeenCalledWith(context.waybill,'return_to_sender',contact)
  expect(m.rpc).toHaveBeenCalledWith('finish_owner_carrier_change_v1',expect.objectContaining({p_org:org,p_actor:owner,p_order_no:orderNo,p_status:outcome}))
})
it('does not show a worker ledger snapshot to an employee without a shipping operator role',async()=>{
  m.operator.mockRejectedValue(new ShippingError(403,'未授权'))
  const response=await ledgerGet(req(),{params:Promise.resolve({id:owner})})
  expect(response.status).toBe(403)
  expect((await ledgerPost(req(submission),{params:Promise.resolve({id:owner})})).status).toBe(403)
  expect(m.rpc).not.toHaveBeenCalled()
  expect(m.send).not.toHaveBeenCalled()
})
it('reads only the requested work order from the operator organization and passes no carrier connection to the browser',async()=>{
  const ledgerCtx={params:Promise.resolve({id:key})}
  m.rpc.mockResolvedValueOnce(resolves({...detail, context:null, latest, unavailableReason:'intercept_disabled'}))
    .mockResolvedValueOnce(resolves(null))
  const response=await ledgerGet(req(),ledgerCtx)
  expect(await response.json()).toEqual({orderNo,latest,actions:[],returnDestination:contact,currentRecipient:target,unavailableReason:'intercept_disabled'})
  expect(m.rpc).toHaveBeenCalledWith('shipping_carrier_change_v1', {
    p_org:org, p_actor:owner, p_order_id:key, p_order_no:null, p_key:null, p_action:null, p_recipient:null, p_binding:null,
  })
  expect((await ledgerGet(req(),ledgerCtx)).status).toBe(404)
  expect(m.connect).not.toHaveBeenCalled()
})
it('submits operator forwarding under the authenticated actor and saves the original shipment receipt',async()=>{
  const accepted={...latest,action:'modify_recipient',status:'accepted',destination:target,instructionId:'CUS1',amount:'2.55'}
  m.auth.mockResolvedValueOnce({id:operator})
  m.rpc.mockResolvedValueOnce(resolves(detail)).mockResolvedValueOnce(resolves({result:'dispatch'}))
    .mockResolvedValueOnce(resolves(true)).mockResolvedValueOnce(resolves({result:'replay',latest:accepted}))
  const response=await ledgerPost(req({action:'modify_recipient',key,recipient:target}),{params:Promise.resolve({id:key})})
  expect(await response.json()).toEqual(accepted)
  expect(m.send).toHaveBeenCalledExactlyOnceWith(context.waybill,'modify_recipient',target)
  expect(m.rpc).toHaveBeenCalledWith('finish_shipping_carrier_change_v1',expect.objectContaining({
    p_org:org,p_actor:operator,p_order_id:key,p_order_no:null,p_key:key,p_status:'accepted',
  }))
})
it('returns an in-transit order only to the original sender and rechecks its exact carrier route',async()=>{
  const ledgerCtx={params:Promise.resolve({id:key})}
  expect((await ledgerPost(req({...submission,recipient:target}),ledgerCtx)).status).toBe(400)
  expect(m.rpc).not.toHaveBeenCalled()
  const accepted={...latest,status:'accepted',instructionId:'CUS1',amount:'2.55'}
  m.rpc.mockResolvedValueOnce(resolves(detail)).mockResolvedValueOnce(resolves({result:'dispatch'}))
    .mockResolvedValueOnce(resolves(true)).mockResolvedValueOnce(resolves({result:'replay',latest:accepted}))
  expect(await (await ledgerPost(req(submission),ledgerCtx)).json()).toEqual(accepted)
  expect(m.route).toHaveBeenCalledExactlyOnceWith('original',context.waybill)
  expect(m.send).toHaveBeenCalledExactlyOnceWith(context.waybill,'return_to_sender',contact)
})
