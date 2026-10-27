import { readWecomSettings } from './wecom-settings'
import { loadShippingSettings } from './runtime-config'
import { contactSchema } from './validation'
import { hasFreshWecomDirectory } from './wecom-access'
export type BotReadinessCheck = {key:string;label:string;ready:boolean;action:string}
export async function loadWecomBotReadiness(orgId:string):Promise<BotReadinessCheck[]> {
 const results=await Promise.allSettled([readWecomSettings(orgId),loadShippingSettings(orgId)])
 const config=results[0].status==='fulfilled'?results[0].value:null
 const shipping=results[1].status==='fulfilled'?results[1].value:null
 return [
  {key:'enterprise',label:'所属企业',ready:Boolean(config?.corp_id),action:config?.corp_id?`已绑定 ${config.company_name}`:'管理员在企业应用配置中连接所属企业'},
  {key:'members',label:'销售身份与提报范围',ready:Boolean(config&&hasFreshWecomDirectory(config)),action:config&&hasFreshWecomDirectory(config)?'成员目录已校验；仍逐人检查提报权限':'管理员同步成员并核对提报范围；可信 IP 错误在企业应用处处理'},
  {key:'sender',label:'默认寄件人',ready:contactSchema.safeParse(shipping?.sender).success,action:contactSchema.safeParse(shipping?.sender).success?'使用系统默认寄件人，提报销售单独记录':'管理员补齐默认寄件人姓名、电话及省市区和详细地址'},
  {key:'standard',label:'顺丰标快',ready:Boolean(shipping?.services.some(s=>s.id===2)),action:shipping?.services.some(s=>s.id===2)?'默认顺丰标快':'管理员在顺丰连接中配置已授权的顺丰标快'},
  {key:'dispatch',label:'管理员确认后下单',ready:Boolean(shipping?.environment==='production'&&shipping.canSubmit),action:shipping?.environment==='production'&&shipping.canSubmit?'生产连接与月结配置具备下单条件；仍需逐票确认，真实下单结果以顺丰回执为准':shipping?.reason||'管理员检查生产顺丰连接和月结配置'},
 ]
}
