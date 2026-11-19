// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { checkSfBeforeDispatch, sendSfRecipientInstruction } from './sf-client'
import type { ShippingRuntimeConfig } from './runtime-config'
const dest = { name: '收件样例', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '科技路1号' }
const config: ShippingRuntimeConfig = { orgId:'org',connectionId:'c',connectionKey:'c',environment:'sandbox',partnerId:'sample',checkWord:'synthetic',billingAccount:'mock-monthly',billingAccountId:'account',billingAccountTail:'0000',senderProfileId:null,sender:dest,services:[],snapshot:{} }
const waybill='SF1111111111111'
function transport(data: unknown, outer = 'A1000') {
  const sent: URLSearchParams[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, request: RequestInit) => {
    if (url.endsWith('/oauth2/accessToken')) return Response.json({apiResultCode:'A1000',accessToken:'synthetic-token',expiresIn:7200})
    expect(url).toBe('https://sfapi-sbox.sf-express.com/std/service')
    sent.push(new URLSearchParams(String(request.body)))
    return Response.json({apiResultCode:outer,apiResultData:JSON.stringify(data)})
  }))
  return sent
}
afterEach(()=>vi.unstubAllGlobals())
it.each([['modify_recipient','1'],['return_to_sender','2']] as const)('sends sender-side %s to the linked sandbox and only acknowledges receipt', async(action,code)=>{
  const sent = transport({success:true,errorCode:'S0000',msgData:{amount:0,cusId:'test-001'}})
  expect(await sendSfRecipientInstruction(waybill,action,dest,config)).toEqual({ instructionId:'test-001',amount:'0' })
  expect(sent).toHaveLength(1)
  expect(sent[0].get('serviceCode')).toBe('EXP_RECE_WANTED_INTERCEPT')
  expect(JSON.parse(sent[0].get('msgData')!)).toEqual({waybillNo:waybill,serviceCode:code,role:'1',payMode:'4',monthlyCardNo:'mock-monthly',cancel:false,
    newDestAddress:{province:dest.province,city:dest.city,county:dest.county,address:dest.address,contact:dest.name,phone:dest.phone}})
})
it.each([['A1004',{},'provider_rejected'],['A1007',{},'provider_invalid_response'],
  ['A1000',{success:false,errorCode:'50018'},'provider_rejected'],['A1000',{success:true,msgData:{}},'provider_invalid_response']] as const)('distinguishes definite rejections from ambiguous responses',async(outer,body,stage)=>{
  transport(body,outer)
  await expect(sendSfRecipientInstruction(waybill,'return_to_sender',dest,config)).rejects.toMatchObject({requestStage:stage})
})
it('preserves SF sandbox S0000 with a nested generic response and no detailed receipt', async()=>{
  transport({success:true,errorCode:'S0000',msgData:{success:true,errorCode:'S0000',msgData:null,errorMsg:null}})
  await expect(sendSfRecipientInstruction(waybill,'return_to_sender',dest,config))
    .resolves.toEqual({instructionId:null,amount:null})
})
const route={acceptTime:'2026-11-18 10:01:00',remark:'顺丰已收取快件',opCode:'54',firstStatusName:'已揽收'}
it.each([
  [[route],true],[[{...route,remark:'等待揽收',opCode:'655',firstStatusName:'待揽收'}],false],
  [[route,{...route,acceptTime:'2026-11-18 10:02:00',opCode:'',firstStatusName:'',remark:'已到达'}],false],
  [[route,{...route,firstStatusName:'派送中',remark:'派件出仓'}],false],
  [[{...route,acceptTime:'not-a-time'}],false],
] as const)('requires unambiguous pre-delivery carrier evidence on the exact waybill',async(routes,allowed)=>{
  const sent=transport({success:true,msgData:{routeResps:[{mailNo:waybill,routes}]}})
  expect(await checkSfBeforeDispatch('original-id',waybill,config)).toBe(allowed)
  expect(JSON.parse(sent[0].get('msgData')!)).toMatchObject({trackingType:'2',trackingNumber:['original-id']})
})
