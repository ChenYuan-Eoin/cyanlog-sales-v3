import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { encryptShippingSecret, decryptShippingSecret } from './connections'
import { ShippingError } from './config'
import { readWecomSettings } from './wecom-settings'
import { newWecomCallbackKeys, validateWecomCallbackKeys, type WecomCallbackKeys } from './wecom-callback-crypto'
export type WecomBot = { id:string;corp_id:string;bot_id:string;name:string;status:'draft'|'active'|'disabled';verified_at:string|null;last_message_at:string|null;updated_at:string }
export type WecomBotRow = WecomBot & { org_id:string;credentials_ciphertext:string }
const publicColumns='id,corp_id,bot_id,name,status,verified_at,last_message_at,updated_at'
export async function listWecomBots(orgId:string):Promise<WecomBot[]> {
 const {data,error}=await supabaseAdmin.from('shipping_wecom_bots').select(publicColumns).eq('org_id',orgId).order('updated_at',{ascending:false})
 if(error)throw new ShippingError(503,'机器人配置暂不可读取。')
 return (data||[]) as WecomBot[]
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
 if(!data)throw new ShippingError(404,'机器人入口不存在或已停用。')
 return data as WecomBotRow
}
export function wecomBotKeys(row:WecomBotRow):WecomCallbackKeys {
 try {const keys=JSON.parse(decryptShippingSecret(row.credentials_ciphertext));validateWecomCallbackKeys(keys);return keys} catch {throw new ShippingError(503,'机器人安全配置暂不可用。')}
}
export async function revealWecomBotSetup(orgId:string,id:unknown) {
 const botId=z.uuid().parse(id),config=await readWecomSettings(orgId)
 const {data,error}=await supabaseAdmin.from('shipping_wecom_bots').select(`org_id,credentials_ciphertext,${publicColumns}`).eq('id',botId).eq('org_id',orgId).eq('corp_id',config?.corp_id||'').maybeSingle()
 if(error||!data)throw new ShippingError(404,'当前企业的机器人配置不存在。')
 return {botId,setupKeys:wecomBotKeys(data as WecomBotRow)}
}
