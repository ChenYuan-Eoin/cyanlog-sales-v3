// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const m=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn(),directory:vi.fn()}))
vi.mock('@/lib/supabase',()=>({supabaseAdmin:{from:m.from,rpc:m.rpc}}))
vi.mock('./connections',()=>({decryptShippingSecret:()=> 'test-secret',encryptShippingSecret:vi.fn()}))
vi.mock('./wecom-client',()=>({wecomDirectory:m.directory,inspectWecomApplication:vi.fn()}))
import { activateWecomConfiguration } from './wecom-settings'
const draftId='11111111-1111-4111-8111-111111111111'
let active:Record<string,unknown>|null,pending:Record<string,unknown>,writes:string[]
beforeEach(()=>{
 vi.clearAllMocks();writes=[];active={corp_id:'old-corp',agent_id:1,allowed_department_ids:[2]};pending={corp_id:'new-corp',agent_id:7,order_check_mode:1,credentials_ciphertext:'test-cipher'}
 m.directory.mockResolvedValue({departments:[{id:1,parentId:0},{id:3,parentId:1}],members:[]})
 m.rpc.mockResolvedValue({data:true,error:null})
 m.from.mockImplementation((table:string)=>{const q={select:()=>q,eq:()=>q,update:()=>{writes.push(table);return q},maybeSingle:async()=>({data:table==='shipping_wecom_settings'?active:{id:draftId,config:pending},error:null})};return q})
})
it('uses only the new application directory when explicitly activating a new enterprise',async()=>{
 await activateWecomConfiguration('org','manager',{draftId,scopeMode:'application'})
 expect(m.rpc).toHaveBeenCalledWith('activate_shipping_wecom_config',{p_org_id:'org',p_user_id:'manager',p_draft_id:draftId,p_department_ids:[1,3]})
 expect(writes).toEqual(['shipping_wecom_config_drafts'])
})
it('preserves an existing restriction when updating the same enterprise',async()=>{
 pending.corp_id='old-corp';await activateWecomConfiguration('org','manager',{draftId,scopeMode:'preserve'})
 expect(m.rpc.mock.calls[0][1].p_department_ids).toEqual([2])
})
it('does not silently expand the same enterprise to application-wide access',async()=>{
 pending.corp_id='old-corp';await expect(activateWecomConfiguration('org','manager',{draftId,scopeMode:'application'})).rejects.toMatchObject({status:409})
 expect(m.directory).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled()
})
it('does not convert a legacy person allowlist into department-wide grants',async()=>{
 pending.corp_id='old-corp';active!.allowed_department_ids=null
 await expect(activateWecomConfiguration('org','manager',{draftId,scopeMode:'preserve'})).rejects.toMatchObject({status:409})
 expect(writes).toEqual([]);expect(m.rpc).not.toHaveBeenCalled()
})
it('rejects caller-supplied department IDs and legacy open-access drafts',async()=>{
 await expect(activateWecomConfiguration('org','manager',{draftId,scopeMode:'application',departmentIds:[99]})).rejects.toThrow()
 pending.order_check_mode=0
 await expect(activateWecomConfiguration('org','manager',{draftId,scopeMode:'application'})).rejects.toMatchObject({status:409})
 expect(m.rpc).not.toHaveBeenCalled()
})
it('reports an activation race without falling back to separate configuration writes',async()=>{
 m.rpc.mockResolvedValue({data:false,error:null})
 await expect(activateWecomConfiguration('org','manager',{draftId,scopeMode:'application'})).rejects.toMatchObject({status:409})
 expect(writes).toEqual(['shipping_wecom_config_drafts'])
})
