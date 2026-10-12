// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { encryptWecomCallback, decryptWecomCallback, newWecomCallbackKeys } from '@/lib/shipping/wecom-callback-crypto'
const mocks=vi.hoisted(()=>({read:vi.fn(),keys:vi.fn(),enqueue:vi.fn(),readEvent:vi.fn(),process:vi.fn(),after:vi.fn()}))
vi.mock('next/server',async original=>({...await original<typeof import('next/server')>(),after:mocks.after}))
vi.mock('@/lib/supabase',()=>({supabaseAdmin:{from:vi.fn()}}))
vi.mock('@/lib/shipping/wecom-bot-settings',()=>({readWecomBotForCallback:mocks.read,wecomBotKeys:mocks.keys}))
vi.mock('@/lib/shipping/wecom-bot-events',()=>({enqueueWecomBotEvent:mocks.enqueue,readWecomBotEvent:mocks.readEvent,processWecomBotEvent:mocks.process,botStreamReply:(event:{id:string})=>({msgtype:'stream',stream:{id:event.id,finish:false,content:'处理中'}}),BOT_INTAKE_HELP:'提报帮助'}))
import { GET, POST } from './route'
const id='11111111-1111-4111-8111-111111111111',keys=newWecomCallbackKeys()
const params={params:Promise.resolve({id})}
const body={msgid:'message-1',aibotid:'bot-1',from:{userid:'employee-1'},chattype:'single',msgtype:'text',text:{content:'寄件'}}
function request(message:unknown,method='POST',signature?:string){const encrypted=encryptWecomCallback(keys,typeof message==='string'?message:JSON.stringify(message),'nonce');const url=new URL(`https://sales.example/api/shipping/public/wecom/bot/${id}`);url.searchParams.set('msg_signature',signature||encrypted.msgsignature);url.searchParams.set('timestamp',String(encrypted.timestamp));url.searchParams.set('nonce',encrypted.nonce);if(method==='GET')url.searchParams.set('echostr',encrypted.encrypt);return new NextRequest(url,{method,...(method==='POST'?{body:JSON.stringify({encrypt:encrypted.encrypt})}:{})})}
beforeEach(()=>{vi.clearAllMocks();mocks.read.mockResolvedValue({id,bot_id:'bot-1',status:'active'});mocks.keys.mockReturnValue(keys);mocks.enqueue.mockResolvedValue({id:'22222222-2222-4222-8222-222222222222',state:'pending'})})
it('answers a verified URL challenge without JSON quoting',async()=>{const response=await GET(request('plain-challenge','GET'),params);expect(response.status).toBe(200);expect(await response.text()).toBe('plain-challenge');expect(mocks.enqueue).not.toHaveBeenCalled()})
it('rejects an invalid signature before scheduling work or marking verification',async()=>{const response=await POST(request(body,'POST','0'.repeat(40)),params);expect(response.status).toBe(403);expect(mocks.enqueue).not.toHaveBeenCalled();expect(mocks.after).not.toHaveBeenCalled()})
it('rejects a different bot even with valid encryption',async()=>{expect((await POST(request({...body,aibotid:'foreign-bot'}),params)).status).toBe(400);expect(mocks.enqueue).not.toHaveBeenCalled()})
it('returns an encrypted stream and schedules processing after the response',async()=>{const response=await POST(request(body),params),encrypted=await response.json();const reply=JSON.parse(decryptWecomCallback(keys,{signature:encrypted.msgsignature,timestamp:String(encrypted.timestamp),nonce:encrypted.nonce},encrypted.encrypt));expect(reply.stream.finish).toBe(false);expect(mocks.enqueue).toHaveBeenCalledOnce();expect(mocks.process).not.toHaveBeenCalled();expect(mocks.after).toHaveBeenCalledTimes(2)})
it('does not accept workorders before a draft is explicitly activated',async()=>{mocks.read.mockResolvedValue({id,bot_id:'bot-1',status:'draft'});expect((await POST(request(body),params)).status).toBe(200);expect(mocks.enqueue).not.toHaveBeenCalled()})
it('scopes stream refresh to the signed original sender and conversation',async()=>{mocks.readEvent.mockResolvedValue({id,state:'done'});await POST(request({...body,msgtype:'stream',stream:{id}}),params);expect(mocks.readEvent).toHaveBeenCalledWith(expect.objectContaining({bot_id:'bot-1'}),id,{userid:'employee-1',chattype:'single',chatid:undefined});expect(mocks.enqueue).not.toHaveBeenCalled()})
