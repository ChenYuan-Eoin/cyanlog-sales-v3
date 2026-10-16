// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
vi.mock('@/lib/supabase',()=>({supabaseAdmin:{from:vi.fn()}}))
import {chooseWecomPhone,createWecomState,verifyWecomState} from './wecom-session'
beforeEach(()=>vi.stubEnv('SHIPPING_CREDENTIALS_ENCRYPTION_KEY','12'.repeat(32)))
afterEach(()=>vi.unstubAllEnvs())
it('uses the actual staff phone independently of fallback configuration',()=>{expect(chooseWecomPhone('13800000000','13900000000')).toEqual({phone:'13800000000',source:'wecom'})})
it('uses an explicit or necessary preset without creating a fake identity',()=>{expect(chooseWecomPhone('invalid','13900000000')).toEqual({phone:'13900000000',source:'preset'});expect(chooseWecomPhone('13800000000','13900000000',true)).toEqual({phone:'13900000000',source:'preset'});expect(()=>chooseWecomPhone('invalid','')).toThrow('预置寄件电话')})
it('binds OAuth state to the same browser and enforces expiry and signature',()=>{
 expect(createWecomState('00000000-0000-4000-8000-000000000001').length).toBeLessThanOrEqual(128)
 const state=createWecomState('org-one',1000)
 expect(verifyWecomState(state,state,1001)).toEqual({orgId:'org-one'})
 expect(()=>verifyWecomState(state,undefined,1001)).toThrow()
 const other=createWecomState('org-one',1000);expect(()=>verifyWecomState(state,other,1001)).toThrow()
 expect(()=>verifyWecomState(state,state,601001)).toThrow('过期')
 const [body,sig]=state.split('.');const tampered=body+'.'+(sig[0]==='a'?'b':'a')+sig.slice(1);expect(()=>verifyWecomState(tampered,tampered,1001)).toThrow()
})

import { supabaseAdmin } from '@/lib/supabase'
import { findWecomMember, wecomProfileDto } from './wecom-session'
import type { WecomSettingsRow } from './wecom-settings'
it('exposes separate organization-scoped address choices with the authenticated sender identity',async()=>{
 const filters:unknown[]=[]
 const member={id:'member-1',org_id:'org-1',wecom_corp_id:'ww-example',wechat_userid:'user-1',is_active:true,wecom_allowed:true,wecom_name:'真实员工',mobile:'13800000000',sender_contact:{name:'旧姓名',phone:'13900000000',province:'广东省',city:'深圳市',county:'福田区',address:'个人路8号'},team:'销售组',session_version:1,updated_at:'2026-10-16T00:00:00Z'}
 vi.mocked(supabaseAdmin.from).mockImplementation((table:string)=>{const query={select:vi.fn(()=>query),eq:vi.fn((key:string,value:unknown)=>{filters.push([table,key,value]);return query}),maybeSingle:vi.fn(async()=>({data:table==='shipping_employee_profiles'?member:{province:'广东省',city:'深圳市',county:'南山区',address:'公司路16号'},error:null}))};return query as never})
 const config={org_id:'org-1',corp_id:'ww-example',directory_synced_at:new Date().toISOString(),fallback_phone:'',company_name:'示例企业'} as WecomSettingsRow
 const result=await findWecomMember(config,'user-1')
 expect(result?.senderSource).toBe('personal')
 expect(result?.senderChoices?.company).toMatchObject({name:'真实员工',phone:'13800000000',address:'公司路16号'})
 expect(result?.senderChoices?.personal).toMatchObject({name:'真实员工',phone:'13800000000',address:'个人路8号'})
 expect(filters).toContainEqual(['shipping_sender_profiles','org_id','org-1'])
 expect(wecomProfileDto(result!)).not.toHaveProperty('userId')
 expect(wecomProfileDto(result!)).not.toHaveProperty('orgId')
})
