// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const m=vi.hoisted(()=>({from:vi.fn(),config:vi.fn(),byId:vi.fn(),byUser:vi.fn()}))
vi.mock('@/lib/supabase',()=>({supabaseAdmin:{from:m.from}}))
vi.mock('./connections',()=>({decryptShippingSecret:(value:string)=>value,encryptShippingSecret:(value:string)=>value}))
vi.mock('./wecom-session',()=>({findWecomMember:m.byUser,findWecomMemberById:m.byId}))
vi.mock('./wecom-settings',()=>({readWecomSettings:m.config,wecomCredentials:vi.fn()}))
vi.mock('./wecom-bot-settings',()=>({readWecomBotForCallback:vi.fn()}))
vi.mock('./wecom-client',()=>({resolveWecomBotUserId:vi.fn()}))
vi.mock('./intake-options',()=>({loadIntakeOptionsForOrg:vi.fn()}))
vi.mock('./collaboration',()=>({createAnonymousShipment:vi.fn()}))
import { readWecomBotEvent } from './wecom-bot-events'
import type { WecomBotRow } from './wecom-bot-settings'
const id='11111111-1111-4111-8111-111111111111',bot={id:'bot-row',org_id:'org-a',corp_id:'corp-a',status:'active'} as WecomBotRow
const source={userid:'user-a',chattype:'single'}
let event:Record<string,unknown>
beforeEach(()=>{
 vi.clearAllMocks();m.config.mockResolvedValue({org_id:'org-a',corp_id:'corp-a'});m.byId.mockResolvedValue({id:'employee-a'});m.byUser.mockResolvedValue({id:'employee-a'})
 event={id,state:'done',payload_ciphertext:JSON.stringify({msgid:'msg',aibotid:'bot',from:{userid:'user-a'},chattype:'single',msgtype:'text',text:{content:'寄件'}}),prepared_ciphertext:JSON.stringify({employee:{id:'employee-a',identity:{corpId:'corp-a'}}})}
 m.from.mockImplementation(()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:event,error:null})};return q})
})
it('uses the shared current-member policy for a prepared receipt',async()=>{
 await expect(readWecomBotEvent(bot,id,source)).resolves.toMatchObject({id})
 expect(m.byId).toHaveBeenCalledWith({org_id:'org-a',corp_id:'corp-a'},'employee-a')
})
it('rejects a removed member instead of trusting the prepared snapshot',async()=>{
 m.byId.mockResolvedValue(null);await expect(readWecomBotEvent(bot,id,source)).rejects.toMatchObject({status:403})
})
it('rejects another sender before reading employee identity',async()=>{
 await expect(readWecomBotEvent(bot,id,{...source,userid:'foreign'})).rejects.toMatchObject({status:403})
 expect(m.byId).not.toHaveBeenCalled();expect(m.config).not.toHaveBeenCalled()
})
it('does not reuse a receipt after the organization switches enterprises',async()=>{
 m.config.mockResolvedValue({org_id:'org-a',corp_id:'corp-b'})
 await expect(readWecomBotEvent(bot,id,source)).rejects.toMatchObject({status:403})
 expect(m.byId).not.toHaveBeenCalled()
})
it('checks members on pending receipts too',async()=>{
 event.prepared_ciphertext=null
 await readWecomBotEvent(bot,id,source)
 expect(m.byUser).toHaveBeenCalledWith({org_id:'org-a',corp_id:'corp-a'},'user-a')
})
