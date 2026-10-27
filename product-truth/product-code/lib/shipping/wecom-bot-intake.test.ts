import { expect, it } from 'vitest'
import { prepareWecomBotIntake } from './wecom-bot-intake'
import { DEFAULT_INTAKE_RULES } from './intake-rules'
import type { WecomProfile } from './wecom-session'
const profile:WecomProfile={id:'employee',orgId:'org',userId:'staff',name:'员工甲',phone:'13800000000',phoneSource:'wecom',companyName:'员工所属企业',team:'企微同步部门',sender:{name:'员工甲',phone:'13800000000',province:'广东省',city:'深圳市',county:'南山区',address:'公司办公楼20层'},updatedAt:'2026-10-12',sessionVersion:1}
const services=[{id:2,name:'顺丰标快',preference:'standard' as const}],key='12345678-1234-4234-8234-123456789abc'
const text='寄件\n客户公司：测试客户公司\n收件人：张三\n电话：13900000000\n地址：深圳市南山区测试路88号\n重量：500g'
it('uses the verified sender and configured service while keeping customer separate',()=>{
 const result=prepareWecomBotIntake(text,profile,DEFAULT_INTAKE_RULES,services,key,profile.sender)
 expect(result.input).toMatchObject({sender:profile.sender,customerName:'测试客户公司',serviceId:2,weight:0.5,submittedBy:{team:'企微同步部门'},recipient:{province:'广东省',city:'深圳市',county:'南山区'}})
})
it('does not convert casual conversation, multiple recipients into an order',()=>{
 for(const value of ['你好',text+'\n李四 13800000001'])expect(()=>prepareWecomBotIntake(value,profile,DEFAULT_INTAKE_RULES,services,key,profile.sender)).toThrow()
})
it('refuses unavailable sender profiles and unopened services',()=>{
 expect(()=>prepareWecomBotIntake(text,{...profile,phoneSource:'unavailable'},DEFAULT_INTAKE_RULES,services,key,profile.sender)).toThrow('员工电话')
 expect(()=>prepareWecomBotIntake(text+'\n服务产品：未开放服务',profile,DEFAULT_INTAKE_RULES,services,key,profile.sender)).toThrow('仅受理')
})

it('accepts only recipient details using the administrator sender and standard service, independent of employee name',()=>{
 const sender={...profile.sender,name:'管理员',phone:'13800000009'}
 const result=prepareWecomBotIntake('收件人：张三\n电话：13900000000\n地址：深圳市南山区测试路88号',profile,DEFAULT_INTAKE_RULES,[{id:1,name:'顺丰特快',preference:'urgent'},...services],key,sender)
 expect(result.input).toMatchObject({sender,serviceId:2,customerName:'',submittedBy:{name:'员工甲'},cargo:'文件/合同',weight:1})
})
it('never substitutes another service when standard service or administrator sender is missing',()=>{
 expect(()=>prepareWecomBotIntake(text,profile,DEFAULT_INTAKE_RULES,[],key,profile.sender)).toThrow('标快尚未配置')
 expect(()=>prepareWecomBotIntake(text,profile,DEFAULT_INTAKE_RULES,services,key,{...profile.sender,name:''})).toThrow('默认寄件资料')
})
