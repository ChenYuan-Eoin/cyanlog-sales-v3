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

it('saves long connection credentials encrypted without exposing them or changing callback drafts',async()=>{
 const {saveWecomLongConnection}=await import('./wecom-bot-settings')
 let inserted:Record<string,unknown>|undefined
 mocks.from.mockImplementation(()=>({insert:(value:Record<string,unknown>)=>{inserted=value;return {select:()=>({single:async()=>({data:{id,bot_id:'robot-1',status:'draft'},error:null})})}}}))
 const result=await saveWecomLongConnection('org','admin',{name:'Bot',botId:'robot-1',secret:'test-secret'})
 expect(mocks.encrypt).toHaveBeenCalledWith(JSON.stringify({transport:'long_connection',secret:'test-secret'}))
 expect(inserted).toMatchObject({org_id:'org',corp_id:'ww0000000000000001',credentials_ciphertext:'long-connection:v1:new-cipher',verified_at:null,status:'draft'})
 expect(result.bot.transport).toBe('long_connection')
 expect(JSON.stringify(result)).not.toContain('test-secret')
})

it('retains the encrypted Secret when editing a saved long connection with an empty Secret',async()=>{
 const {saveWecomLongConnection}=await import('./wecom-bot-settings')
 row={...row,bot_id:'robot-1',credentials_ciphertext:'long-connection:v1:existing-cipher'}
 mocks.from.mockImplementation(()=>{const filters:Record<string,unknown>={};let value:Record<string,unknown>|undefined;const chain={select:()=>chain,eq:(key:string,v:unknown)=>{filters[key]=v;return chain},update:(v:Record<string,unknown>)=>{value=v;return chain},maybeSingle:async()=>({data:row,error:null}),single:async()=>{writes.push({value:value!,filters});return {data:{id},error:null}}};return chain})
 await saveWecomLongConnection('org','admin',{id,name:'Renamed',botId:'robot-1',secret:''})
 expect(writes[0].value.credentials_ciphertext).toBe('long-connection:v1:existing-cipher')
 expect(writes[0].filters).toMatchObject({org_id:'org',id,updated_at:row.updated_at})
 expect(mocks.encrypt).not.toHaveBeenCalled()
 await expect(saveWecomLongConnection('org','admin',{id,name:'Renamed',botId:'different-bot',secret:''})).rejects.toThrow('更换Bot ID')
})

it('does not overwrite callback credentials when given their ID for a long connection',async()=>{
 const {saveWecomLongConnection}=await import('./wecom-bot-settings')
 await expect(saveWecomLongConnection('org','admin',{id,name:'Bot',botId:'robot-1',secret:'test-secret'})).rejects.toThrow('URL回调配置')
 expect(writes).toHaveLength(0)
})

it('lists legacy and long-connection transports without any ciphertext or plaintext',async()=>{
 const {listWecomBots}=await import('./wecom-bot-settings')
 mocks.from.mockImplementation(()=>{const chain={select:()=>chain,eq:()=>chain,order:async()=>({data:[{...row,credentials_ciphertext:'old-cipher'},{...row,id:'second',credentials_ciphertext:'long-connection:v1:secret-cipher'}],error:null})};return chain})
 const bots=await listWecomBots('org')
 expect(bots.map(bot=>bot.transport)).toEqual(['url_callback','long_connection'])
 expect(JSON.stringify(bots)).not.toContain('cipher')
 expect(mocks.decrypt).not.toHaveBeenCalled()
})

it('refuses a long connection after its enterprise binding changed',async()=>{
 const {readWecomBotForLongConnection}=await import('./wecom-bot-settings')
 mocks.from.mockImplementation(()=>{const q={select:()=>q,eq:()=>q,in:()=>q,maybeSingle:async()=>({data:{...row,org_id:'org',corp_id:'old-corp',credentials_ciphertext:'long-connection:v1:cipher'},error:null})};return q})
 await expect(readWecomBotForLongConnection(id)).rejects.toMatchObject({status:403})
})
it('renews a business heartbeat without changing the configuration version',async()=>{
 const {markWecomLongConnectionOnline}=await import('./wecom-bot-settings')
 let value:Record<string,unknown>={}
 mocks.from.mockImplementation(()=>{const q={update:(v:Record<string,unknown>)=>{value=v;return q},eq:()=>q,in:()=>q,select:()=>q,maybeSingle:async()=>({data:{id},error:null})};return q})
 await markWecomLongConnectionOnline({...row,status:'active',verified_at:'2026-01-01'} as never)
 expect(value.status).toBe('active');expect(value.verified_at).not.toBe('2026-01-01');expect(value).not.toHaveProperty('updated_at')
})
