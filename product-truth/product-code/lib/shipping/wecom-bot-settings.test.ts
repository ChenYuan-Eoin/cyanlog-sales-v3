// @vitest-environment node
import {beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({from:vi.fn(),settings:vi.fn(),encrypt:vi.fn(),decrypt:vi.fn()}))
vi.mock('@/lib/supabase',()=>({supabaseAdmin:{from:mocks.from}}))
vi.mock('./connections',()=>({encryptShippingSecret:mocks.encrypt,decryptShippingSecret:mocks.decrypt}))
vi.mock('./wecom-settings',()=>({readWecomSettings:mocks.settings}))
import {repairWecomBotSetup} from './wecom-bot-settings'
const id='11111111-1111-4111-8111-111111111111'
let row:Record<string,unknown>,writes:Array<{value:Record<string,unknown>;filters:Record<string,unknown>}>,race:boolean
beforeEach(()=>{
 vi.clearAllMocks();race=false;writes=[];row={id,status:'draft',verified_at:null,updated_at:'2026-10-12T00:00:00Z',credentials_ciphertext:'cipher'}
 mocks.settings.mockResolvedValue({corp_id:'ww0000000000000001'})
 mocks.decrypt.mockReturnValue(JSON.stringify({token:'exampleToken',encodingAESKey:Buffer.alloc(32,255).toString('base64').slice(0,-1)}));mocks.encrypt.mockReturnValue('new-cipher')
 mocks.from.mockImplementation(()=>{let value:Record<string,unknown>|undefined;const filters:Record<string,unknown>={};const chain={select:()=>chain,eq:(k:string,v:unknown)=>{filters[k]=v;return chain},is:(k:string,v:unknown)=>{filters[k]=v;return chain},update:(v:Record<string,unknown>)=>{value=v;return chain},maybeSingle:async()=>{if(value){writes.push({value,filters});return {data:race?null:{id},error:null}}return {data:row,error:null}}};return chain})
})
it('repairs only an unverified owned draft while retaining its token and URL identity',async()=>{
 const result=await repairWecomBotSetup('org','admin',id)
 expect(result.botId).toBe(id);expect(result.setupKeys.token).toBe('exampleToken');expect(result.setupKeys.encodingAESKey).toMatch(/^[A-Za-z0-9]{43}$/)
 expect(writes[0].filters).toEqual({id,org_id:'org',status:'draft',verified_at:null,updated_at:row.updated_at})
})
it.each([{status:'active',verified_at:null},{status:'draft',verified_at:'2026-10-12T01:00:00Z'}])('does not rotate a live or verified connection %j',async(change)=>{
 Object.assign(row,change);await expect(repairWecomBotSetup('org','admin',id)).rejects.toThrow('仅可修复');expect(writes).toHaveLength(0)
})
it('refuses a stale repair if verification or another edit won the race',async()=>{
 race=true;await expect(repairWecomBotSetup('org','admin',id)).rejects.toThrow('配置已变化')
})
