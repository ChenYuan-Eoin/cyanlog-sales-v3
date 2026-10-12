import { z } from 'zod'
import { wecomApplicationCallbackUrl } from './wecom-callback-url'
import { supabaseAdmin } from '@/lib/supabase'
import { encryptShippingSecret,decryptShippingSecret } from './connections'
import { ShippingError } from './config'
import { normalizeDomesticShippingPhone,DOMESTIC_SHIPPING_PHONE_PATTERN } from './phone'
import { inspectWecomApplication,wecomDirectory,type WecomCredentials } from './wecom-client'
export type WecomSettingsRow = { department_snapshot?:import('./wecom-directory').WecomDepartment[];allowed_department_ids?:number[]|null;org_id:string;corp_id:string;agent_id:number;credentials_ciphertext:string;order_check_mode:0|1;fallback_phone:string;denied_message:string;redirect_domain:string;company_name:string;directory_synced_at:string|null;updated_at:string }
export type WecomSettings = { departments:import('./wecom-directory').WecomDepartment[];allowedDepartmentIds:number[]|null;corpId:string;agentId:number|null;hasSecret:boolean;orderCheckMode:0|1;fallbackPhone:string;deniedMessage:string;redirectDomain:string;companyName:string;directorySyncedAt:string|null;updatedAt:string|null }
export type WecomMember = { id:string;wechat_userid:string;wecom_name:string;mobile:string;department_names:string[];department_ids?:number[];is_active:boolean;wecom_allowed:boolean;use_preset_phone:boolean }
const columns='org_id,corp_id,agent_id,credentials_ciphertext,order_check_mode,fallback_phone,denied_message,redirect_domain,company_name,directory_synced_at,updated_at,department_snapshot,allowed_department_ids'
export async function readWecomSettings(orgId:string):Promise<WecomSettingsRow|null> {
 const {data,error}=await supabaseAdmin.from('shipping_wecom_settings').select(columns).eq('org_id',orgId).maybeSingle()
 if(error)throw new ShippingError(503,'企微配置暂不可用。')
 return data as WecomSettingsRow|null
}
export function publicWecomSettings(row:WecomSettingsRow|null):WecomSettings { return {departments:row?.department_snapshot||[],allowedDepartmentIds:row?.allowed_department_ids??null,corpId:row?.corp_id||'',agentId:row?.agent_id||null,hasSecret:Boolean(row?.credentials_ciphertext),orderCheckMode:row?.order_check_mode??1,fallbackPhone:row?.fallback_phone||'',deniedMessage:row?.denied_message||'抱歉，您非本企业授权员工，无权使用自寄服务',redirectDomain:row?.redirect_domain||'',companyName:row?.company_name||'',directorySyncedAt:row?.directory_synced_at||null,updatedAt:row?.updated_at||null} }
export function wecomCredentials(row:WecomSettingsRow):WecomCredentials { return {corpId:row.corp_id,agentId:row.agent_id,secret:decryptShippingSecret(row.credentials_ciphertext)} }
export async function listWecomMembers(orgId:string) {
 const config=await readWecomSettings(orgId)
 if(!config)return []
 const {data,error}=await supabaseAdmin.from('shipping_employee_profiles').select('id,wechat_userid,wecom_name,mobile,department_names,department_ids,is_active,wecom_allowed,use_preset_phone').eq('org_id',orgId).eq('wecom_corp_id',config.corp_id).order('wecom_name')
 if(error)throw new ShippingError(503,'企微名单暂不可读取。')
 return (data||[]) as WecomMember[]
}
const saveSchema=z.object({corpId:z.string().trim().regex(/^ww[a-zA-Z0-9]{8,64}$/),agentId:z.number().int().positive(),secret:z.string().trim().min(1).max(256).optional(),orderCheckMode:z.union([z.literal(0),z.literal(1)]),fallbackPhone:z.string().trim().max(32),deniedMessage:z.string().trim().min(1).max(200),expectedUpdatedAt:z.string().nullable(),draftId:z.uuid().optional()}).strict()
export async function syncWecomDirectory(orgId:string) {
 const row=await readWecomSettings(orgId)
 if(!row)throw new ShippingError(409,'请先保存企微应用配置。')
 const directory=await wecomDirectory(wecomCredentials(row))
 const {error}=await supabaseAdmin.rpc('sync_shipping_wecom_directory_v2',{p_org_id:orgId,p_corp_id:row.corp_id,p_agent_id:row.agent_id,p_config_updated_at:row.updated_at,p_company_name:directory.companyName,p_departments:directory.departments,p_members:directory.members})
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

export type WecomConfigDraft = { id: string; corpId: string; agentId: number; appName: string; fallbackPhone:string;deniedMessage:string;orderCheckMode:0|1; companyName: string; preparedAt: string; departments: import('./wecom-directory').WecomDepartment[]; memberCount: number }
type DraftRow = { id:string;org_id:string;config:Record<string,unknown>;departments:import('./wecom-directory').WecomDepartment[];members:import('./wecom-directory').WecomDirectoryMember[];prepared_at:string }
export async function readWecomDraft(orgId:string):Promise<WecomConfigDraft|null> {
 const {data,error}=await supabaseAdmin.from('shipping_wecom_config_drafts').select('id,org_id,config,departments,members,prepared_at').eq('org_id',orgId).maybeSingle()
 if(error)throw new ShippingError(503,'企微待启用配置暂不可读取。')
 if(!data)return null
 const row=data as DraftRow
 // Never serialize pending credentials, raw directory phone numbers or secrets.
 return {id:row.id,corpId:String(row.config.corp_id),agentId:Number(row.config.agent_id),appName:String(row.config.app_name||''),fallbackPhone:String(row.config.fallback_phone||''),deniedMessage:String(row.config.denied_message||''),orderCheckMode:Number(row.config.order_check_mode)===0?0:1,companyName:String(row.config.company_name||''),preparedAt:row.prepared_at,departments:row.departments,memberCount:row.members.filter(m=>m.active).length}
}
export async function prepareWecomConfiguration(orgId:string,userId:string,input:unknown) {
 const data=saveSchema.parse(input),current=await readWecomSettings(orgId)
 if((current?.updated_at??null)!==data.expectedUpdatedAt)throw new ShippingError(409,'当前配置已变化，请刷新后再准备新配置。')
 const sameIdentity=current?.corp_id===data.corpId&&current?.agent_id===data.agentId
 let retainedCipher=sameIdentity?current?.credentials_ciphertext:undefined
 if(data.draftId&&!data.secret){
  const pending=await supabaseAdmin.from('shipping_wecom_config_drafts').select('config').eq('org_id',orgId).eq('id',data.draftId).maybeSingle()
  if(pending.error||!pending.data)throw new ShippingError(409,'待启用配置已变化，请刷新后重试。')
  if(pending.data.config.corp_id!==data.corpId||Number(pending.data.config.agent_id)!==data.agentId)throw new ShippingError(400,'更换草稿的企业或应用时，请填写新应用密钥。')
  retainedCipher=pending.data.config.credentials_ciphertext
 }
 if(!data.secret&&!retainedCipher)throw new ShippingError(400,'更换企业或应用时，请填写新应用对应的密钥。')
 const phone=normalizeDomesticShippingPhone(data.fallbackPhone)
 if(phone&&!DOMESTIC_SHIPPING_PHONE_PATTERN.test(phone))throw new ShippingError(400,'预置电话必须是有效国内手机号或座机。')
 const secret=data.secret||decryptShippingSecret(retainedCipher!)
 const credentials={corpId:data.corpId,agentId:data.agentId,secret}
 const app=await inspectWecomApplication(credentials)
 wecomApplicationCallbackUrl(app.redirectDomain)
 const directory=await wecomDirectory(credentials)
 const config={corp_id:data.corpId,agent_id:data.agentId,credentials_ciphertext:encryptShippingSecret(secret),order_check_mode:data.orderCheckMode,fallback_phone:phone,denied_message:data.deniedMessage,redirect_domain:app.redirectDomain,company_name:directory.companyName,app_name:app.appName}
 // Preparing a candidate never touches the active settings or active grants.
 const {error}=await supabaseAdmin.from('shipping_wecom_config_drafts').upsert({org_id:orgId,id:crypto.randomUUID(),config,departments:directory.departments,members:directory.members,base_updated_at:current?.updated_at??null,prepared_by:userId,prepared_at:new Date().toISOString()},{onConflict:'org_id'})
 if(error)throw new ShippingError(503,'待启用配置未保存，当前连接保持不变。')
 return readWecomDraft(orgId)
}
export async function activateWecomConfiguration(orgId:string,userId:string,input:unknown) {
 const data=z.object({draftId:z.uuid(),departmentIds:z.array(z.number().int().positive().safe()).max(10000)}).strict().parse(input)
 const pending=await supabaseAdmin.from('shipping_wecom_config_drafts').select('config').eq('org_id',orgId).eq('id',data.draftId).maybeSingle()
 if(pending.error||!pending.data)throw new ShippingError(409,'待启用配置不存在，请重新测试。')
 const config=pending.data.config as Record<string,string>
 const directory=await wecomDirectory({corpId:config.corp_id,agentId:Number(config.agent_id),secret:decryptShippingSecret(config.credentials_ciphertext)})
 const refreshed=await supabaseAdmin.from('shipping_wecom_config_drafts').update({departments:directory.departments,members:directory.members}).eq('org_id',orgId).eq('id',data.draftId).select('id').maybeSingle()
 if(refreshed.error||!refreshed.data)throw new ShippingError(409,'待启用配置已变化，请刷新后重试。')
 const {data:changed,error}=await supabaseAdmin.rpc('activate_shipping_wecom_config',{p_org_id:orgId,p_draft_id:data.draftId,p_user_id:userId,p_department_ids:data.departmentIds})
 if(error||!changed)throw new ShippingError(409,'配置未启用：待启用配置可能已过期或当前设置已变化。请重新测试后启用，原连接保持不变。')
}
export async function saveWecomDepartmentScope(orgId:string,selected:unknown) {
 const departmentIds=z.array(z.number().int().positive().safe()).max(10000).parse(selected)
 const row=await readWecomSettings(orgId)
 if(!row)throw new ShippingError(409,'请先配置企微应用。')
 // Refresh the authoritative hierarchy before granting new access; no name matching.
 const directory=await wecomDirectory(wecomCredentials(row))
 const {error}=await supabaseAdmin.rpc('sync_shipping_wecom_directory_v2',{p_org_id:orgId,p_corp_id:row.corp_id,p_agent_id:row.agent_id,p_config_updated_at:row.updated_at,p_company_name:directory.companyName,p_departments:directory.departments,p_members:directory.members,p_selected_department_ids:departmentIds})
 if(error)throw new ShippingError(409,'组织授权未保存：部门或配置已变化，请同步后重新选择。')
}

export async function discardWecomConfiguration(orgId:string,id:unknown) {
 const draftId=z.uuid().parse(id)
 const {data,error}=await supabaseAdmin.from('shipping_wecom_config_drafts').delete().eq('org_id',orgId).eq('id',draftId).select('id').maybeSingle()
 if(error||!data)throw new ShippingError(409,'待启用配置已变化，请刷新后重试。')
}
