import { parseAddress } from './address'
import { ShippingError } from './config'
import { shippingInputSchema, contactSchema } from './validation'
import type { IntakeRules } from './intake-rules'
import type { WecomProfile } from './wecom-session'
import type { ShippingServiceOption } from './sf-service-catalog'
import type { Contact } from './types'
export const BOT_INTAKE_HELP='请单聊发送收件人、电话和完整地址。寄件人使用管理员保存的默认资料，服务为顺丰标快；保存工单后仍需管理员确认，确认下单成功后才有运单号。'
// Bot submission is a trusted employee acting on behalf of the configured sender.
// Keep the personal web-form identity constraint unchanged.
export function prepareWecomBotIntake(text:string,profile:WecomProfile,_rules:IntakeRules,services:ShippingServiceOption[],key:string,defaultSender:Contact) {
 if(profile.phoneSource==='unavailable')throw new ShippingError(422,'提报员工电话未配置，请管理员补齐员工资料或预置号码；本次未提报。')
 const sender=contactSchema.safeParse(defaultSender)
 if(!sender.success)throw new ShippingError(409,'默认寄件资料不完整，请管理员在配置中心补齐；本次未提报。')
 const content=text.trim().replace(/^@\S+\s+/, '')
 if(content.length>2000)throw new ShippingError(400,'每次请提报一票，文本不超过2000字。')
 const lines=content.replace(/^(?:寄件|协助寄件|提报快递|提报工单)[：:\s]*/, '').split(/\r?\n/).filter(line=>!/^\s*(?:帮我下单|请下单|帮我寄件)\s*$/.test(line))
 const field=(pattern:RegExp)=>lines.map(line=>line.match(pattern)?.[1]?.trim()).find(value=>value!==undefined)
 const customerName=field(/^(?:客户公司|公司名称|客户)[：:]\s*(.*)$/)||''
 const cargo=field(/^(?:物品|托寄物)[：:]\s*(.*)$/)||'文件/合同'
 const weightText=field(/^重量[：:]\s*(.*)$/)||'1kg',weightMatch=weightText.match(/^(\d+(?:\.\d+)?)\s*(kg|千克|公斤|g|克)?$/i)
 if(!weightMatch)throw new ShippingError(400,'重量请填写数字及kg或g，例如1kg。')
 const weight=Number(weightMatch[1])/(/^(g|克)$/i.test(weightMatch[2]||'')?1000:1)
 const service=services.find(s=>s.id===2)
 if(!service)throw new ShippingError(409,'顺丰标快尚未配置，请管理员检查服务产品；本次未提报。')
 const serviceName=field(/^服务产品[：:]\s*(.*)$/)
 if(serviceName&&serviceName!==service.name)throw new ShippingError(400,'机器人当前仅受理顺丰标快，其他服务请联系管理员，未自动替换。')
 const remark=field(/^(?:备注|特殊需求)[：:]\s*(.*)$/)||''
 const addressText=lines.filter(line=>! /^(?:客户公司|公司名称|客户|物品|托寄物|重量|服务产品|备注|特殊需求)[：:]/.test(line)).join('\n')
 const parsed=parseAddress(addressText)
 const recipient=contactSchema.safeParse(parsed.contact)
 if(!recipient.success)throw new ShippingError(400,`收件信息尚不完整：${[...new Set(recipient.error.issues.map(issue=>({name:'收件人',phone:'电话',province:'省份',city:'城市',county:'区县',address:'详细地址'}[String(issue.path[0])]||'收件资料')))].join('、')}。请补齐后发送。`)
 const result=shippingInputSchema.safeParse({sender:sender.data,recipient:recipient.data,cargo,weight,serviceId:service.id,servicePreference:'standard',source:'manual',payment:'sender_monthly',customerName,submittedBy:{name:profile.name,phone:profile.phone,team:profile.team||profile.companyName},specialRequirements:remark,remark:''})
 if(!result.success)throw new ShippingError(400,'寄件资料格式不正确，请核对物品、重量和备注；本次未提报。')
 return {key,rawInput:content,input:result.data}
}
