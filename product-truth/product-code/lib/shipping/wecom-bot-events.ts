import { createHash, createHmac } from 'node:crypto'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import { encryptShippingSecret, decryptShippingSecret } from './connections'
import { readWecomBotForProcessing, type WecomBotRow } from './wecom-bot-settings'
import { readWecomSettings, wecomCredentials } from './wecom-settings'
import { findWecomMember, findWecomMemberById } from './wecom-session'
import { resolveWecomBotUserId } from './wecom-client'
import { loadIntakeOptionsForOrg } from './intake-options'
import { prepareWecomBotIntake, BOT_INTAKE_HELP } from './wecom-bot-intake'
import { wecomBotSubmissionKey } from './wecom-bot-dedup'
import { loadShippingSettings } from './runtime-config'
import { handleWecomBotQuery } from './wecom-bot-runtime'
import { createAnonymousShipment } from './collaboration'
const messageSchema=z.object({msgid:z.string().min(1).max(512),aibotid:z.string().min(1).max(128),from:z.object({userid:z.string().min(1).max(256)}),chattype:z.enum(['single','group']),chatid:z.string().max(256).optional(),msgtype:z.literal('text'),text:z.object({content:z.string().max(4000)})})
export type BotEvent={id:string;bot_id:string;state:'pending'|'processing'|'done'|'failed';payload_hash:string;payload_ciphertext:string;prepared_ciphertext:string|null;response_content:string;attempts:number;lease_id:string|null;created_at:string;updated_at:string}
const columns='id,bot_id,state,payload_hash,payload_ciphertext,prepared_ciphertext,response_content,attempts,lease_id,created_at,updated_at'
export function botStreamReply(event:Pick<BotEvent,'id'|'state'|'response_content'>) { return {msgtype:'stream',stream:{id:event.id,finish:event.state==='done'||event.state==='failed',content:event.response_content||'正在核对寄件资料，请勿重复提报。'}} }
export async function enqueueWecomBotEvent(bot:WecomBotRow,input:unknown):Promise<BotEvent> {
 const message=messageSchema.parse(input)
 if(message.chattype!=='single')throw new ShippingError(403,'为保护寄件隐私，请单聊机器人提报或查询。')
 if(message.aibotid!==bot.bot_id)throw new ShippingError(403,'机器人身份不匹配。')
 const payload=JSON.stringify(message),hash=createHash('sha256').update(payload).digest('hex')
 const inserted=await supabaseAdmin.from('shipping_wecom_bot_events').insert({bot_id:bot.id,message_id:message.msgid,payload_hash:hash,payload_ciphertext:encryptShippingSecret(payload)}).select(columns).single()
 if(!inserted.error&&inserted.data)return inserted.data as BotEvent
 if(inserted.error?.code!=='23505')throw new ShippingError(503,'消息暂未受理，请稍后查看提报记录。')
 const prior=await supabaseAdmin.from('shipping_wecom_bot_events').select(columns).eq('bot_id',bot.id).eq('message_id',message.msgid).single()
 if(prior.error||!prior.data)throw new ShippingError(503,'消息回执暂不可用。')
 if(prior.data.payload_hash!==hash)throw new ShippingError(409,'同一消息的内容发生变化，未重复提报。')
 return prior.data as BotEvent
}
export async function readWecomBotEvent(bot:WecomBotRow,id:string,source:{userid:string;chatid?:string;chattype:string}) {
 if(!z.uuid().safeParse(id).success)throw new ShippingError(404,'提报回执不存在。')
 const {data,error}=await supabaseAdmin.from('shipping_wecom_bot_events').select(columns).eq('id',id).eq('bot_id',bot.id).maybeSingle()
 if(error)throw new ShippingError(503,'回执暂不可读取。')
 if(!data)throw new ShippingError(404,'提报回执不存在。')
 const event=data as BotEvent,message=messageSchema.parse(JSON.parse(decryptShippingSecret(event.payload_ciphertext)))
 if(message.from.userid!==source.userid||message.chattype!==source.chattype||message.chatid!==source.chatid)throw new ShippingError(403,'不能读取其他会话的提报回执。')
 const config=await readWecomSettings(bot.org_id)
 if(bot.status!=='active'||!config||config.corp_id!==bot.corp_id)throw new ShippingError(403,'企业连接已变更，不能读取本次回执。')
 if(event.prepared_ciphertext){
  const prepared=JSON.parse(decryptShippingSecret(event.prepared_ciphertext))
  if(prepared.employee?.identity?.corpId!==bot.corp_id||!prepared.employee?.id||!await findWecomMemberById(config,prepared.employee.id))throw new ShippingError(403,'员工授权已变化，不能继续查询本次回执。')
 }else{
  if(message.chattype!=='single')throw new ShippingError(403,'为保护寄件隐私，请单聊机器人提报或查询。')
  let employee=await findWecomMember(config,message.from.userid)
  if(!employee){const mapped=await resolveWecomBotUserId(wecomCredentials(config),message.from.userid);if(mapped)employee=await findWecomMember(config,mapped)}
  if(!employee)throw new ShippingError(403,'您不在当前企业的提报范围内。')
 }
 if(['pending','processing'].includes(event.state)&&Date.now()-Date.parse(event.created_at)>6*60*1000)return {...event,state:'failed' as const,response_content:'本次处理未及时完成，请在员工提报页核对是否已有工单，避免重复提报。'}
 return event
}
export async function processWecomBotEvent(botId:string,eventId:string) {
 const claim=await supabaseAdmin.rpc('claim_shipping_wecom_bot_event',{p_event_id:eventId,p_bot_id:botId})
 if(claim.error)throw new ShippingError(503,'机器人处理暂不可用。')
 const event=(Array.isArray(claim.data)?claim.data[0]:null) as BotEvent|null
 if(!event)return
 const finish=async(state:BotEvent['state'],content:string,orderId?:string)=>{
  const {error}=await supabaseAdmin.from('shipping_wecom_bot_events').update({state,response_content:content,updated_at:new Date().toISOString(),...(orderId?{shipping_order_id:orderId}:{})}).eq('id',event.id).eq('lease_id',event.lease_id)
  if(error)throw new ShippingError(503,'机器人回执暂未保存。')
 }
 try {
  const bot=await readWecomBotForProcessing(botId),config=await readWecomSettings(bot.org_id)
  if(bot.status!=='active'||!config?.directory_synced_at||config.corp_id!==bot.corp_id)throw new ShippingError(403,'机器人未启用或企业连接已变更，本次未提报。')
  const message=messageSchema.parse(JSON.parse(decryptShippingSecret(event.payload_ciphertext)))
  if(message.chattype!=='single')throw new ShippingError(403,'为保护寄件隐私，请单聊机器人提报或查询。')
  let employee=await findWecomMember(config,message.from.userid)
  if(!employee){const mapped=await resolveWecomBotUserId(wecomCredentials(config),message.from.userid);if(mapped)employee=await findWecomMember(config,mapped)}
  if(!employee)throw new ShippingError(403,'您不在当前企业的提报授权范围内。')
  const queryReply=await handleWecomBotQuery(message.text.content,bot,employee)
  if(queryReply){await finish('done',queryReply);return}
  if(employee.phoneSource==='unavailable')throw new ShippingError(422,'请管理员补齐有效寄件电话或预置号码。')
  const options=await loadIntakeOptionsForOrg(bot.org_id)
  if(options.orgId!==bot.org_id)throw new ShippingError(403,'机器人企业与提报入口不一致。')
  type Prepared={submission:ReturnType<typeof prepareWecomBotIntake>;employee:{id:string;identity:{provider:'wecom';userId:string;corpId:string;botConnectionId:string;phoneSource:'wecom'|'preset'}}}
  let prepared:Prepared
  if(event.prepared_ciphertext){
   prepared=JSON.parse(decryptShippingSecret(event.prepared_ciphertext)) as Prepared
   if(prepared.employee.id!==employee.id||prepared.employee.identity.corpId!==config.corp_id)throw new ShippingError(403,'企业身份已变更，请在员工页核对原工单。')
  }else{
   const secret=process.env.SHIPPING_RECEIPT_SECRET
   if(!secret)throw new ShippingError(503,'机器人提报安全配置暂不可用。')
   const bucket=createHmac('sha256',secret).update(`shipping-bot:${bot.org_id}:${employee.id}`).digest('hex')
   const rate=await supabaseAdmin.rpc('claim_shipping_intake_rate',{p_bucket_hash:bucket,p_now:new Date().toISOString(),p_window_seconds:600,p_limit:20})
   if(rate.error)throw new ShippingError(503,'提报服务暂不可用。')
   if(rate.data!==true)throw new ShippingError(429,'提报过于频繁，请稍后再试。')
   const defaults=await loadShippingSettings(bot.org_id)
   prepared={submission:prepareWecomBotIntake(message.text.content,employee,options.rules,options.services,event.id,defaults.sender),employee:{id:employee.id,identity:{provider:'wecom',userId:employee.userId,corpId:config.corp_id,botConnectionId:bot.id,phoneSource:employee.phoneSource}}}
   prepared.submission.key=await wecomBotSubmissionKey(bot.org_id,employee.id,prepared.submission.input)
   const saved=await supabaseAdmin.from('shipping_wecom_bot_events').update({prepared_ciphertext:encryptShippingSecret(JSON.stringify(prepared))}).eq('id',event.id).eq('lease_id',event.lease_id).select('id').maybeSingle()
   if(saved.error||!saved.data)throw new ShippingError(503,'提报快照暂未保存。')
  }
  const result=await createAnonymousShipment({...prepared.submission,employee:prepared.employee,orgId:bot.org_id})
  const reply=await handleWecomBotQuery(`查询工单 ${result.order.orderNo}`,bot,employee)
  await finish('done',`${reply||`工单号：${result.order.orderNo}`}\n${result.order.status==='awaiting_confirmation'?'待管理员确认，尚未正式下单。确认下单成功后才会生成运单号，并非即时出号。':'已保留原工单，请勿重复提报。'}可单聊发送“查询我的工单”查看。`,result.order.id)
 }catch(error){
  const transient=!(error instanceof ShippingError)||error.status>=500
  const terminal=!transient||event.attempts>=3
  const content=transient?(terminal?'暂未确认提报结果，请在员工页查看本人记录，避免重复提报。':'服务暂时繁忙，正在用原请求核对结果。'):(error as ShippingError).message
  await finish(terminal?'failed':'pending',content)
 }
}
export { BOT_INTAKE_HELP }
