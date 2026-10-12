import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { encryptShippingSecret,decryptShippingSecret } from './connections'
import { ShippingError } from './config'
import { normalizeDomesticShippingPhone,DOMESTIC_SHIPPING_PHONE_PATTERN } from './phone'
import { inspectWecomApplication,wecomDirectory,type WecomCredentials } from './wecom-client'
export type WecomSettingsRow = { org_id:string;corp_id:string;agent_id:number;credentials_ciphertext:string;order_check_mode:0|1;fallback_phone:string;denied_message:string;redirect_domain:string;company_name:string;directory_synced_at:string|null;updated_at:string }
export type WecomSettings = { corpId:string;agentId:number|null;hasSecret:boolean;orderCheckMode:0|1;fallbackPhone:string;deniedMessage:string;redirectDomain:string;companyName:string;directorySyncedAt:string|null;updatedAt:string|null }
export type WecomMember = { id:string;wechat_userid:string;wecom_name:string;mobile:string;department_names:string[];is_active:boolean;wecom_allowed:boolean;use_preset_phone:boolean }
const columns='org_id,corp_id,agent_id,credentials_ciphertext,order_check_mode,fallback_phone,denied_message,redirect_domain,company_name,directory_synced_at,updated_at'
export async function readWecomSettings(orgId:string):Promise<WecomSettingsRow|null> {
 const {data,error}=await supabaseAdmin.from('shipping_wecom_settings').select(columns).eq('org_id',orgId).maybeSingle()
 if(error)throw new ShippingError(503,'企微配置暂不可用。')
 return data as WecomSettingsRow|null
}
export function publicWecomSettings(row:WecomSettingsRow|null):WecomSettings { return {corpId:row?.corp_id||'',agentId:row?.agent_id||null,hasSecret:Boolean(row?.credentials_ciphertext),orderCheckMode:row?.order_check_mode??1,fallbackPhone:row?.fallback_phone||'',deniedMessage:row?.denied_message||'抱歉，您非本企业授权员工，无权使用自寄服务',redirectDomain:row?.redirect_domain||'',companyName:row?.company_name||'',directorySyncedAt:row?.directory_synced_at||null,updatedAt:row?.updated_at||null} }
export function wecomCredentials(row:WecomSettingsRow):WecomCredentials { return {corpId:row.corp_id,agentId:row.agent_id,secret:decryptShippingSecret(row.credentials_ciphertext)} }
export async function listWecomMembers(orgId:string) {
 const config=await readWecomSettings(orgId)
 if(!config)return []
 const {data,error}=await supabaseAdmin.from('shipping_employee_profiles').select('id,wechat_userid,wecom_name,mobile,department_names,is_active,wecom_allowed,use_preset_phone').eq('org_id',orgId).eq('wecom_corp_id',config.corp_id).order('wecom_name')
 if(error)throw new ShippingError(503,'企微名单暂不可读取。')
 return (data||[]) as WecomMember[]
}
const saveSchema=z.object({corpId:z.string().trim().regex(/^ww[a-zA-Z0-9]{8,64}$/),agentId:z.number().int().positive(),secret:z.string().trim().min(1).max(256).optional(),orderCheckMode:z.union([z.literal(0),z.literal(1)]),fallbackPhone:z.string().trim().max(32),deniedMessage:z.string().trim().min(1).max(200),expectedUpdatedAt:z.string().nullable()}).strict()
export async function saveWecomSettings(orgId:string,userId:string,input:unknown) {
 const data=saveSchema.parse(input),current=await readWecomSettings(orgId)
 if((current?.updated_at??null)!==data.expectedUpdatedAt)throw new ShippingError(409,'配置已变化，请刷新后保存。')
 const phone=normalizeDomesticShippingPhone(data.fallbackPhone)
 if(phone&&!DOMESTIC_SHIPPING_PHONE_PATTERN.test(phone))throw new ShippingError(400,'预置电话必须是真实可联系的国内手机号或座机。')
 const identityChanged=current?.corp_id!==data.corpId||current?.agent_id!==data.agentId
 if((!current||identityChanged)&&!data.secret)throw new ShippingError(400,'请填写此应用对应的Secret。')
 const secret=data.secret || decryptShippingSecret(current!.credentials_ciphertext)
 const verified=await inspectWecomApplication({corpId:data.corpId,agentId:data.agentId,secret})
 const row={corp_id:data.corpId,agent_id:data.agentId,credentials_ciphertext:data.secret?encryptShippingSecret(secret):current!.credentials_ciphertext,order_check_mode:data.orderCheckMode,fallback_phone:phone,denied_message:data.deniedMessage,redirect_domain:verified.redirectDomain,directory_synced_at:identityChanged||data.secret?null:current?.directory_synced_at,updated_by:userId,updated_at:new Date().toISOString()}
 const result=current?await supabaseAdmin.from('shipping_wecom_settings').update(row).eq('org_id',orgId).eq('updated_at',current.updated_at).select('org_id').maybeSingle():await supabaseAdmin.from('shipping_wecom_settings').insert({org_id:orgId,...row}).select('org_id').single()
 if(result.error||!result.data)throw new ShippingError(409,'配置未保存或已被其他管理员修改，请刷新后重试。')
 return {settings:publicWecomSettings(await readWecomSettings(orgId)),appName:verified.appName}
}
export async function syncWecomDirectory(orgId:string) {
 const row=await readWecomSettings(orgId)
 if(!row)throw new ShippingError(409,'请先保存企微应用配置。')
 const directory=await wecomDirectory(wecomCredentials(row))
 const {error}=await supabaseAdmin.rpc('sync_shipping_wecom_members',{p_org_id:orgId,p_corp_id:row.corp_id,p_agent_id:row.agent_id,p_config_updated_at:row.updated_at,p_company_name:directory.companyName,p_members:directory.members})
 if(error)throw new ShippingError(409,'名单未更新，可能配置刚刚变更；请刷新后重新同步。')
 return {settings:publicWecomSettings(await readWecomSettings(orgId)),members:await listWecomMembers(orgId)}
}
export async function updateWecomMember(orgId:string,input:unknown) {
 const data=z.object({id:z.uuid(),allowed:z.boolean(),usePresetPhone:z.boolean()}).strict().parse(input)
 const config=await readWecomSettings(orgId)
 if(!config)throw new ShippingError(409,'请先配置企微。')
 if(data.usePresetPhone&&!config.fallback_phone)throw new ShippingError(400,'请先保存有效的预置电话。')
 const {data:changed,error}=await supabaseAdmin.rpc('set_shipping_wecom_member',{p_org_id:orgId,p_member_id:data.id,p_allowed:data.allowed,p_use_preset:data.usePresetPhone})
 if(error||!changed)throw new ShippingError(409,'名单未更新，请刷新后重试。')
 return listWecomMembers(orgId)
}
