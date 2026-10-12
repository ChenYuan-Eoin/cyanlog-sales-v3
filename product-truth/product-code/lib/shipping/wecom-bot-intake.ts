import { parseAddress } from './address'
import { ShippingError } from './config'
import { makeAnonymousShipmentSchema } from './validation'
import type { IntakeRules } from './intake-rules'
import type { WecomProfile } from './wecom-session'
import type { ShippingServiceOption } from './sf-service-catalog'
export const BOT_INTAKE_HELP='请发送：\n寄件\n客户公司：客户名称\n收件人：姓名\n电话：手机号\n地址：省市区及详细地址\n\n寄方自动使用已保存资料；提交后仍由操作员审核，不会直接叫件。'
export function prepareWecomBotIntake(text:string,profile:WecomProfile,rules:IntakeRules,services:ShippingServiceOption[],key:string) {
 if(profile.phoneSource==='unavailable')throw new ShippingError(422,'寄件电话暂不可用，请管理员补齐或配置预置号码。')
 const content=text.trim().replace(/^@\S+\s+/, '')
 if(content.length>2000)throw new ShippingError(400,'每次请提报一票，文本不超过2000字。')
 if(!/^(?:寄件|提报快递|提报工单)(?:[：:\s]|$)/.test(content))throw new ShippingError(400,BOT_INTAKE_HELP)
 const lines=content.replace(/^(?:寄件|提报快递|提报工单)[：:\s]*/, '').split(/\r?\n/)
 const field=(pattern:RegExp)=>lines.map(line=>line.match(pattern)?.[1]?.trim()).find(value=>value!==undefined)
 const customerName=field(/^(?:客户公司|公司名称|客户)[：:]\s*(.*)$/)||''
 const cargo=field(/^(?:物品|托寄物)[：:]\s*(.*)$/)||'文件/合同'
 const weightText=field(/^重量[：:]\s*(.*)$/)||'1kg',weightMatch=weightText.match(/^(\d+(?:\.\d+)?)\s*(kg|千克|公斤|g|克)?$/i)
 if(!weightMatch)throw new ShippingError(400,'重量请填写数字及kg或g，例如1kg。')
 const weight=Number(weightMatch[1])/(/^(g|克)$/i.test(weightMatch[2]||'')?1000:1)
 const serviceName=field(/^服务产品[：:]\s*(.*)$/),service=serviceName?services.find(s=>s.name===serviceName):services[0]
 if(!service)throw new ShippingError(400,'所选快递服务未开放，请在员工提报页选择可用服务。')
 const remark=field(/^(?:备注|特殊需求)[：:]\s*(.*)$/)||''
 const addressText=lines.filter(line=>! /^(?:客户公司|公司名称|客户|物品|托寄物|重量|服务产品|备注|特殊需求)[：:]/.test(line)).join('\n')
 const parsed=parseAddress(addressText)
 const result=makeAnonymousShipmentSchema({...rules,team:{enabled:true,required:true,minLength:1},teamOptions:[]}).safeParse({key,rawInput:content,input:{sender:profile.sender,recipient:parsed.contact,cargo,weight,serviceId:service.id,source:'manual',payment:'sender_monthly',customerName,submittedBy:{name:profile.name,phone:profile.phone,team:profile.team},specialRequirements:remark,remark:''}})
 if(!result.success){
  const labels:Record<string,string>={sender:'已保存的寄方资料',recipient:'收件资料',customerName:'客户公司',submittedBy:'员工资料',weight:'重量',cargo:'物品',specialRequirements:'备注'}
  const errors=[...new Set(result.error.issues.map(issue=>`${labels[String(issue.path[1])]||'提报资料'}：${issue.message}`))]
  throw new ShippingError(400,errors.join('；')+'。请补齐后重新提报，或打开员工提报页核对。')
 }
 return result.data
}
