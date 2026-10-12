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
