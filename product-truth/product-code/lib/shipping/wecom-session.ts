import { createHash,createHmac,randomBytes,timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import { readWecomSettings,type WecomSettingsRow } from './wecom-settings'
import { normalizeDomesticShippingPhone,DOMESTIC_SHIPPING_PHONE_PATTERN } from './phone'
import { emptyContact,type Contact } from './types'
export const WECOM_SESSION_COOKIE='shipping_wecom_session'
export const WECOM_STATE_COOKIE='shipping_wecom_state'
export const WECOM_SESSION_SECONDS=60*24*60*60
export type WecomProfile={id:string;orgId:string;userId:string;name:string;phone:string;phoneSource:'wecom'|'preset'|'unavailable';companyName:string;team:string;sender:Contact;senderChoices?:{company:Contact|null;personal:Contact|null};senderSource?:'company'|'personal'|'custom';updatedAt:string;sessionVersion:number}
const profileColumns='id,org_id,wecom_corp_id,wechat_userid,wecom_name,mobile,company_name,department_names,team,sender_contact,is_active,wecom_allowed,use_preset_phone,session_version,updated_at'
export function chooseWecomPhone(mobile:string,fallback:string,usePreset=false) {
 const personal=normalizeDomesticShippingPhone(mobile),preset=normalizeDomesticShippingPhone(fallback)
 if(!usePreset&&DOMESTIC_SHIPPING_PHONE_PATTERN.test(personal))return {phone:personal,source:'wecom' as const}
 if(DOMESTIC_SHIPPING_PHONE_PATTERN.test(preset))return {phone:preset,source:'preset' as const}
 throw new ShippingError(409,'通讯录电话无效，且尚未配置可用的预置寄件电话，请联系管理员。')
}
function hash(token:string){return createHash('sha256').update(token).digest('hex')}
function stateKey(){const key=process.env.SHIPPING_CREDENTIALS_ENCRYPTION_KEY||'';if(!/^[a-fA-F0-9]{64}$/.test(key))throw new ShippingError(503,'企微身份安全配置尚未就绪。');return Buffer.from(key,'hex')}
export function createWecomState(orgId:string,now=Date.now()) {
 const payload=[orgId,randomBytes(16).toString('hex'),(now+10*60*1000).toString(36)].join('.')
 return `${payload}.${createHmac('sha256',stateKey()).update('wecom-oauth:'+payload).digest('base64url')}`
}
export function verifyWecomState(state:string,cookie:string|undefined,now=Date.now()):{orgId:string} {
 if(!cookie||state!==cookie||state.length>1000)throw new ShippingError(403,'登录校验已失效，请重新从寄件入口进入。')
 const [orgId,nonce,expiry,signature,extra]=state.split('.')
 const payload=[orgId,nonce,expiry].join('.')
 if(!orgId||!nonce||!expiry||!signature||extra)throw new ShippingError(403,'登录校验无效。')
 const expected=createHmac('sha256',stateKey()).update('wecom-oauth:'+payload).digest()
 const actual=Buffer.from(signature,'base64url')
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new ShippingError(403,'登录校验无效。')
 const expires=parseInt(expiry,36)
 if(!Number.isFinite(expires)||expires<=now)throw new ShippingError(403,'登录校验已过期。')
 return {orgId}
}
async function profileFromRow(row:Record<string,unknown>,config:WecomSettingsRow):Promise<WecomProfile|null> {
 if(row.wecom_corp_id!==config.corp_id||row.is_active!==true||row.wecom_allowed!==true||typeof row.wechat_userid!=='string'||!config.directory_synced_at)return null
 let resolved:{phone:string;source:'wecom'|'preset'|'unavailable'}
 try{resolved=chooseWecomPhone(String(row.mobile||''),config.fallback_phone,row.use_preset_phone===true)}catch(error){if(!(error instanceof ShippingError)||error.status!==409)throw error;resolved={phone:'',source:'unavailable'}}
 const stored=row.sender_contact && typeof row.sender_contact==='object' ? row.sender_contact as Partial<Contact> : null
 const {data:companyAddress,error:companyError}=await supabaseAdmin.from('shipping_sender_profiles').select('province,city,county,address').eq('org_id',config.org_id).eq('is_default',true).maybeSingle()
 if(companyError&&!stored?.address)throw new ShippingError(503,'默认寄件地址暂不可读取。')
 // Address choices never replace the authenticated employee's name or phone.
 const contact=(address:Partial<Contact>|null):Contact=>({...emptyContact(),province:address?.province||'',city:address?.city||'',county:address?.county||'',address:address?.address||'',name:String(row.wecom_name||''),phone:resolved.phone})
 const personal=stored?.address?contact(stored):null
 const company=!companyError&&companyAddress?.address?contact(companyAddress):null
 const sender=personal||company||contact(null)
 const senderChoices={company,personal}
 const senderSource=personal?'personal' as const:company?'company' as const:'custom' as const
 return {id:String(row.id),orgId:config.org_id,userId:row.wechat_userid,name:sender.name,phone:sender.phone,phoneSource:resolved.source,companyName:String(row.company_name||config.company_name),team:String(row.team||''),sender,senderChoices,senderSource,updatedAt:String(row.updated_at),sessionVersion:Number(row.session_version)}
}
export async function findWecomMember(config:WecomSettingsRow,userId:string) {
 const {data,error}=await supabaseAdmin.from('shipping_employee_profiles').select(profileColumns).eq('org_id',config.org_id).eq('wecom_corp_id',config.corp_id).eq('wechat_userid',userId).maybeSingle()
 if(error)throw new ShippingError(503,'员工白名单暂不可读取。')
 return data?profileFromRow(data,config):null
}
export async function issueWecomSession(profile:WecomProfile) {
 const token=randomBytes(32).toString('base64url')
 const {error}=await supabaseAdmin.from('shipping_employee_sessions').insert({token_hash:hash(token),org_id:profile.orgId,employee_id:profile.id,issued_version:profile.sessionVersion,expires_at:new Date(Date.now()+WECOM_SESSION_SECONDS*1000).toISOString()})
 if(error)throw new ShippingError(503,'员工会话暂未建立，请重新进入。')
 return token
}
export async function getWecomSession(req:NextRequest) {
 const token=req.cookies.get(WECOM_SESSION_COOKIE)?.value
 if(!token||!/^[-_A-Za-z0-9]{43}$/.test(token))return null
 const {data,error}=await supabaseAdmin.from('shipping_employee_sessions').select('org_id,employee_id,issued_version,expires_at,revoked_at').eq('token_hash',hash(token)).maybeSingle()
 if(error)throw new ShippingError(503,'员工身份暂不可验证，请稍后重试。')
 if(!data||data.revoked_at||!Number.isFinite(Date.parse(data.expires_at))||Date.parse(data.expires_at)<=Date.now())return null
 const config=await readWecomSettings(data.org_id)
 if(!config)return null
 const result=await supabaseAdmin.from('shipping_employee_profiles').select(profileColumns).eq('org_id',data.org_id).eq('id',data.employee_id).maybeSingle()
 if(result.error)throw new ShippingError(503,'员工身份暂不可验证。')
 if(!result.data||Number(result.data.session_version)!==Number(data.issued_version))return null
 return profileFromRow(result.data,config)
}
export async function revokeWecomSession(req:NextRequest) {
 const token=req.cookies.get(WECOM_SESSION_COOKIE)?.value
 if(!token)return
 const {error}=await supabaseAdmin.from('shipping_employee_sessions').update({revoked_at:new Date().toISOString()}).eq('token_hash',hash(token))
 if(error)throw new ShippingError(503,'退出暂未完成，请重试。')
}
export function wecomProfileDto(profile:WecomProfile){return {id:profile.id,email:'',sender:profile.sender,senderChoices:profile.senderChoices,senderSource:profile.senderSource,team:profile.team,updatedAt:profile.updatedAt,wecom:true,companyName:profile.companyName,phoneSource:profile.phoneSource}}
