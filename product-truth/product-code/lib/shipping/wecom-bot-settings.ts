import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { encryptShippingSecret, decryptShippingSecret } from './connections'
import { ShippingError } from './config'
import { readWecomSettings } from './wecom-settings'
import { newWecomCallbackKeys, validateWecomCallbackKeys, type WecomCallbackKeys } from './wecom-callback-crypto'
import { issueWecomRuntimeEnrollment, verifyWecomRuntimeEnrollment } from './wecom-runtime-enrollment'
export type WecomBot = { transport?:'long_connection'|'url_callback'; id:string;corp_id:string;bot_id:string;name:string;status:'draft'|'active'|'disabled';verified_at:string|null;last_message_at:string|null;updated_at:string }
export type WecomBotRow = WecomBot & { org_id:string;credentials_ciphertext:string }
const longConnectionPrefix='long-connection:v1:'
function publicBot(row:WecomBotRow):WecomBot {
 const {credentials_ciphertext,org_id,...bot}=row
 void org_id
 return {...bot,transport:credentials_ciphertext?.startsWith(longConnectionPrefix)?'long_connection':'url_callback'}
}
const publicColumns='id,corp_id,bot_id,name,status,verified_at,last_message_at,updated_at'
export async function listWecomBots(orgId:string):Promise<WecomBot[]> {
 const {data,error}=await supabaseAdmin.from('shipping_wecom_bots').select(`${publicColumns},credentials_ciphertext`).eq('org_id',orgId).order('updated_at',{ascending:false})
 if(error)throw new ShippingError(503,'机器人配置暂不可读取。')
 return (data||[]).map(row=>publicBot(row as WecomBotRow))
}
export async function prepareWecomBot(orgId:string,userId:string,input:unknown) {
 const data=z.object({name:z.string().trim().min(1).max(80),botId:z.string().trim().regex(/^[A-Za-z0-9_-]{4,128}$/),token:z.string().optional(),encodingAESKey:z.string().optional()}).strict().parse(input)
 const config=await readWecomSettings(orgId)
 if(!config?.directory_synced_at)throw new ShippingError(409,'请先启用企业应用并同步组织，再配置机器人。')
 if(Boolean(data.token)!==Boolean(data.encodingAESKey))throw new ShippingError(400,'回调Token和EncodingAESKey需同时填写，或同时留空生成新密钥。')
 const keys=data.token&&data.encodingAESKey?{token:data.token,encodingAESKey:data.encodingAESKey}:newWecomCallbackKeys()
 validateWecomCallbackKeys(keys)
 const {data:bot,error}=await supabaseAdmin.from('shipping_wecom_bots').insert({org_id:orgId,corp_id:config.corp_id,bot_id:data.botId,name:data.name,credentials_ciphertext:encryptShippingSecret(JSON.stringify(keys)),status:'draft',updated_by:userId}).select(publicColumns).single()
 if(error||!bot)throw new ShippingError(503,'机器人草稿未保存，现有机器人保持不变。')
 // Return setup keys only on the administrator's explicit creation response.
 return {bot:bot as WecomBot,setupKeys:keys}
}
export async function activateWecomBot(orgId:string,userId:string,id:unknown) {
 const botId=z.uuid().parse(id)
 const bots=await listWecomBots(orgId)
 if(bots.find(bot=>bot.id===botId)?.transport==='long_connection')throw new ShippingError(409,'长连接由接收服务启动，无需验证回调URL。')
 const {data,error}=await supabaseAdmin.rpc('activate_shipping_wecom_bot',{p_org_id:orgId,p_bot_id:botId,p_user_id:userId})
 if(error||!data)throw new ShippingError(409,'机器人未启用，请先在企微后台验证回调地址，且确保属于当前企业。')
}
export async function disableWecomBot(orgId:string,userId:string,id:unknown) {
 const botId=z.uuid().parse(id)
 const {data,error}=await supabaseAdmin.from('shipping_wecom_bots').update({status:'disabled',updated_by:userId,updated_at:new Date().toISOString()}).eq('org_id',orgId).eq('id',botId).select('id').maybeSingle()
 if(error||!data)throw new ShippingError(409,'机器人未停用，请刷新后重试。')
}
export async function readWecomBotForCallback(id:string):Promise<WecomBotRow> {
 if(!z.uuid().safeParse(id).success)throw new ShippingError(404,'机器人入口不存在。')
 const {data,error}=await supabaseAdmin.from('shipping_wecom_bots').select(`org_id,credentials_ciphertext,${publicColumns}`).eq('id',id).in('status',['draft','active']).maybeSingle()
 if(error)throw new ShippingError(503,'机器人入口暂不可用。')
 if(!data||data.credentials_ciphertext.startsWith(longConnectionPrefix))throw new ShippingError(404,'机器人回调入口不存在或已停用。')
 return data as WecomBotRow
}
export async function readWecomBotForProcessing(id:string):Promise<WecomBotRow> {
 if(!z.uuid().safeParse(id).success)throw new ShippingError(404,'机器人入口不存在。')
 const {data,error}=await supabaseAdmin.from('shipping_wecom_bots').select(`org_id,credentials_ciphertext,${publicColumns}`).eq('id',id).in('status',['draft','active']).maybeSingle()
 if(error)throw new ShippingError(503,'机器人入口暂不可用。')
 if(!data)throw new ShippingError(404,'机器人入口不存在或已停用。')
 return data as WecomBotRow
}
export async function readWecomBotForLongConnection(id:string):Promise<WecomBotRow> {
 const bot=await readWecomBotForProcessing(id)
 if(!bot.credentials_ciphertext.startsWith(longConnectionPrefix))throw new ShippingError(404,'长连接机器人入口不存在。')
 const config=await readWecomSettings(bot.org_id)
 if(!config||config.corp_id!==bot.corp_id)throw new ShippingError(403,'机器人所属企业已变更，请管理员核对绑定。')
 return bot
}
export function wecomBotKeys(row:WecomBotRow):WecomCallbackKeys {
 try {const keys=JSON.parse(decryptShippingSecret(row.credentials_ciphertext));validateWecomCallbackKeys(keys);return keys} catch {throw new ShippingError(503,'机器人安全配置暂不可用。')}
}
export function wecomLongConnectionSecret(row:WecomBotRow):string {
 if(!row.credentials_ciphertext.startsWith(longConnectionPrefix))throw new ShippingError(404,'长连接机器人入口不存在。')
 try {
  const value=z.object({transport:z.literal('long_connection'),secret:z.string().min(1).max(512).regex(/^\S+$/)}).parse(JSON.parse(decryptShippingSecret(row.credentials_ciphertext.slice(longConnectionPrefix.length))))
  return value.secret
 }catch{throw new ShippingError(503,'机器人长连接安全配置暂不可用。')}
}
export async function markWecomLongConnectionOnline(row:WecomBotRow) {
 const now=new Date().toISOString()
 const {data,error}=await supabaseAdmin.from('shipping_wecom_bots').update({status:'active',verified_at:now}).eq('id',row.id).eq('credentials_ciphertext',row.credentials_ciphertext).in('status',['draft','active']).select('id').maybeSingle()
 if(error||!data)throw new ShippingError(409,'机器人状态已变化，请重新连接。')
}
export async function markWecomLongConnectionMessage(row:WecomBotRow) {
 const now=new Date().toISOString()
 const {error}=await supabaseAdmin.from('shipping_wecom_bots').update({last_message_at:now,verified_at:row.verified_at||now}).eq('id',row.id).eq('credentials_ciphertext',row.credentials_ciphertext).eq('status','active')
 if(error)throw new ShippingError(503,'机器人消息状态暂未记录。')
}
export async function issueLongConnectionEnrollment(orgId:string,id:unknown) {
 const botId=z.uuid().parse(id),bot=await readWecomBotForLongConnection(botId)
 if(bot.org_id!==orgId)throw new ShippingError(404,'当前企业的长连接配置不存在。')
 return {botId:bot.id,remoteBotId:bot.bot_id,...issueWecomRuntimeEnrollment(bot.id,bot.updated_at)}
}
export async function redeemLongConnectionEnrollment(id:string,token:unknown) {
 const bot=await readWecomBotForLongConnection(id)
 verifyWecomRuntimeEnrollment(z.string().min(1).max(512).parse(token),bot.id,bot.updated_at)
 const secret=wecomLongConnectionSecret(bot)
 return {botId:bot.id,remoteBotId:bot.bot_id,secret}
}
export async function revealWecomBotSetup(orgId:string,id:unknown) {
 const botId=z.uuid().parse(id),config=await readWecomSettings(orgId)
 const {data,error}=await supabaseAdmin.from('shipping_wecom_bots').select(`org_id,credentials_ciphertext,${publicColumns}`).eq('id',botId).eq('org_id',orgId).eq('corp_id',config?.corp_id||'').maybeSingle()
 if(error||!data)throw new ShippingError(404,'当前企业的机器人配置不存在。')
 return {botId,setupKeys:wecomBotKeys(data as WecomBotRow)}
}

export async function repairWecomBotSetup(orgId:string,userId:string,id:unknown) {
 const botId=z.uuid().parse(id),config=await readWecomSettings(orgId)
 const {data,error}=await supabaseAdmin.from('shipping_wecom_bots').select(`org_id,credentials_ciphertext,${publicColumns}`).eq('id',botId).eq('org_id',orgId).eq('corp_id',config?.corp_id||'').maybeSingle()
 if(error||!data)throw new ShippingError(404,'当前企业的机器人配置不存在。')
 if(data.status!=='draft'||data.verified_at)throw new ShippingError(409,'仅可修复尚未验证的机器人草稿，已验证通道不会改动。')
 const keys=wecomBotKeys(data as WecomBotRow)
 if(/^[A-Za-z0-9]{43}$/.test(keys.encodingAESKey))return {botId,setupKeys:keys}
 keys.encodingAESKey=newWecomCallbackKeys().encodingAESKey
 const result=await supabaseAdmin.from('shipping_wecom_bots').update({credentials_ciphertext:encryptShippingSecret(JSON.stringify(keys)),updated_by:userId,updated_at:new Date().toISOString()}).eq('id',botId).eq('org_id',orgId).eq('status','draft').is('verified_at',null).eq('updated_at',data.updated_at).select('id').maybeSingle()
 if(result.error||!result.data)throw new ShippingError(409,'配置已变化，请刷新后重试。')
 return {botId,setupKeys:keys}
}

// Transport marker preserves existing callback ciphertext and requires no destructive migration.
// Bot credentials stay encrypted; list/read responses never contain the Secret.
export async function saveWecomLongConnection(orgId:string,userId:string,input:unknown) {
 const data=z.object({id:z.uuid().optional(),name:z.string().trim().min(1).max(80),botId:z.string().trim().regex(/^[A-Za-z0-9_-]{4,128}$/),secret:z.string().max(512).optional()}).strict().parse(input)
 const config=await readWecomSettings(orgId)
 if(!config?.corp_id)throw new ShippingError(409,'请先配置所属企业，再保存机器人。')
 let previous:WecomBotRow|null=null
 if(data.id){
  const result=await supabaseAdmin.from('shipping_wecom_bots').select(`org_id,credentials_ciphertext,${publicColumns}`).eq('id',data.id).eq('org_id',orgId).eq('corp_id',config.corp_id).maybeSingle()
  if(result.error||!result.data)throw new ShippingError(404,'当前企业的长连接配置不存在。')
  previous=result.data as WecomBotRow
  if(!previous.credentials_ciphertext.startsWith(longConnectionPrefix))throw new ShippingError(409,'此项是URL回调配置，请新增长连接配置。')
 }
 const secret=data.secret?.trim()
 if(secret&&/\s/.test(secret))throw new ShippingError(400,'Secret不能包含空白字符。')
 if(!secret&&(!previous||previous.bot_id!==data.botId))throw new ShippingError(400,'首次配置或更换Bot ID时，请填写对应的机器人Secret。')
 const credentials=secret?longConnectionPrefix+encryptShippingSecret(JSON.stringify({transport:'long_connection',secret})):previous!.credentials_ciphertext
 const value={org_id:orgId,corp_id:config.corp_id,bot_id:data.botId,name:data.name,credentials_ciphertext:credentials,status:'draft',verified_at:null,updated_by:userId,updated_at:new Date().toISOString()}
 const query=previous?supabaseAdmin.from('shipping_wecom_bots').update(value).eq('id',previous.id).eq('org_id',orgId).eq('updated_at',previous.updated_at):supabaseAdmin.from('shipping_wecom_bots').insert(value)
 const result=await query.select(publicColumns).single()
 if(result.error||!result.data)throw new ShippingError(409,'长连接配置未保存或已被修改，请刷新后重试。')
 return {bot:{...result.data,transport:'long_connection'} as WecomBot}
}
