import { z } from 'zod'
const text = (max: number) => z.string().trim().min(1, '请填写完整信息').max(max)
export const contactSchema = z.object({ name: text(60), phone: text(30).regex(/^(?:1[3-9]\d{9}|0\d{2,3}[- ]?\d{7,8}(?:[- ]\d{1,6})?)$/, '请填写国内手机号或带区号的座机'), province: text(30), city: text(30), county: text(30), address: text(200).min(5, '请补充街道和门牌号') }).strict()
export const shippingInputSchema = z.object({ sender: contactSchema, recipient: contactSchema, cargo: text(60), weight: z.number().finite().positive().max(20), serviceId: z.number().int().positive(), remark: z.string().trim().max(100), source: z.literal('manual') }).strict()
export const createSchema = z.object({ key: z.string().uuid(), input: shippingInputSchema, confirmed: z.literal(true) }).strict()
export const trackingSchema = z.object({ waybill: z.string().trim().toUpperCase().regex(/^(?:SF)?\d{10,15}$/, '请输入一个有效顺丰运单号'), phoneSuffix: z.string().regex(/^\d{4}$/, '请输入收寄任一方手机号后四位').optional() }).strict()
