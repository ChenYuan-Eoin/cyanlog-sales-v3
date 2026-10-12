// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { ShippingError } from './config'
const mocks=vi.hoisted(()=>({from:vi.fn(),inspect:vi.fn(),directory:vi.fn(),decrypt:vi.fn(),encrypt:vi.fn()}))
vi.mock('@/lib/supabase',()=>({supabaseAdmin:{from:mocks.from}}))
vi.mock('./connections',()=>({encryptShippingSecret:mocks.encrypt,decryptShippingSecret:mocks.decrypt}))
vi.mock('./wecom-client',()=>({inspectWecomApplication:mocks.inspect,wecomDirectory:mocks.directory}))
import { prepareWecomConfiguration, discardWecomConfiguration } from './wecom-settings'
const draftId='11111111-1111-4111-8111-111111111111',stamp='2026-10-12T00:00:00Z',activeCipher='example-active-cipher',draftCipher='example-draft-cipher'
const active={org_id:'org',corp_id:'ww0000000000000001',agent_id:1,credentials_ciphertext:activeCipher,updated_at:stamp}
const input={corpId:'ww0000000000000002',agentId:2,orderCheckMode:1,fallbackPhone:'',deniedMessage:'无权限',expectedUpdatedAt:stamp,draftId}
let operations:Array<{table:string;operation:string;filters:Record<string,unknown>;value?:unknown}>
beforeEach(()=>{
 vi.clearAllMocks();operations=[];mocks.decrypt.mockImplementation(x=>x);mocks.encrypt.mockReturnValue('example-encrypted-result');mocks.inspect.mockResolvedValue({appName:'新应用',redirectDomain:'shipping.example'});mocks.directory.mockResolvedValue({companyName:'新企业',departments:[{id:1,parentId:0,name:'新企业',order:0}],members:[]})
 mocks.from.mockImplementation((table:string)=>{let columns='',operation='read';const filters:Record<string,unknown>={};const chain={select:(c:string)=>{columns=c;return chain},eq:(key:string,value:unknown)=>{filters[key]=value;return chain},delete:()=>{operation='delete';return chain},upsert:async(value:unknown)=>{operations.push({table,operation:'upsert',filters,value});return {error:null}},maybeSingle:async()=>{operations.push({table,operation,filters});if(table==='shipping_wecom_settings')return {data:active,error:null};if(operation==='delete')return {data:{id:draftId},error:null};if(columns==='config')return {data:{config:{corp_id:input.corpId,agent_id:input.agentId,credentials_ciphertext:draftCipher}},error:null};return {data:null,error:null}}};return chain})
})
it('reuses only the matching owned draft secret while preparing edits',async()=>{
 await prepareWecomConfiguration('org','admin',input)
 expect(mocks.decrypt).toHaveBeenCalledWith(draftCipher)
 expect(mocks.inspect).toHaveBeenCalledWith({corpId:input.corpId,agentId:2,secret:draftCipher})
 expect(operations.find(x=>x.table==='shipping_wecom_config_drafts'&&x.operation==='read')?.filters).toEqual({org_id:'org',id:draftId})
 expect(operations.filter(x=>x.operation==='upsert').map(x=>x.table)).toEqual(['shipping_wecom_config_drafts'])
})
it('leaves active configuration and the existing draft untouched when verification fails',async()=>{
 mocks.inspect.mockRejectedValue(new ShippingError(502,'连接未通过'))
 await expect(prepareWecomConfiguration('org','admin',input)).rejects.toThrow('连接未通过')
 expect(operations.some(x=>x.operation==='upsert'||x.operation==='delete')).toBe(false)
})
it('does not reuse retained credentials after changing the draft enterprise',async()=>{
 await expect(prepareWecomConfiguration('org','admin',{...input,corpId:'ww0000000000000003'})).rejects.toThrow('填写新应用密钥')
 expect(mocks.decrypt).not.toHaveBeenCalled()
})
it('discards only the named draft in the authenticated organization',async()=>{
 await discardWecomConfiguration('org',draftId)
 expect(operations).toEqual([{table:'shipping_wecom_config_drafts',operation:'delete',filters:{org_id:'org',id:draftId}}])
})
