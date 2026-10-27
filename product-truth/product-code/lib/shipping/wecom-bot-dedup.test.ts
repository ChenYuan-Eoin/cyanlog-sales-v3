import { beforeEach,expect,it,vi } from 'vitest'
import type { ShippingInput } from './types'
const m=vi.hoisted(()=>({from:vi.fn()}))
vi.mock('@/lib/supabase',()=>({supabaseAdmin:{from:m.from}}))
import { wecomBotSubmissionKey } from './wecom-bot-dedup'
let closed:string|null=null,fail=false
beforeEach(()=>{closed=null;fail=false;m.from.mockImplementation(()=>{const q={select:()=>q,eq:vi.fn(()=>q),in:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:closed?{id:closed}:null,error:fail?{}:null})};return q})})
const input={recipient:{name:'甲'},cargo:'文件'} as ShippingInput
it('reuses the key for separate incoming messages and scopes it to employee and org',async()=>{
 const key=await wecomBotSubmissionKey('org','employee',input)
 expect(await wecomBotSubmissionKey('org','employee',input)).toBe(key)
 expect(await wecomBotSubmissionKey('other','employee',input)).not.toBe(key)
 expect(await wecomBotSubmissionKey('org','other',input)).not.toBe(key)
})
it('opens a new lifecycle only after a previous matching shipment ended',async()=>{
 const key=await wecomBotSubmissionKey('org','employee',input);closed='closed-order'
 expect(await wecomBotSubmissionKey('org','employee',input)).not.toBe(key)
})
it('refuses to guess when prior records cannot be checked',async()=>{fail=true;await expect(wecomBotSubmissionKey('org','employee',input)).rejects.toMatchObject({status:503})})
