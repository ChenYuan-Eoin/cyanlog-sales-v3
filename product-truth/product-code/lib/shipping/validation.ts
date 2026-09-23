import { z } from 'zod'
const text = (max: number) => z.string().trim().min(1, '请填写完整信息').max(max)
export const contactSchema = z.object({ name: text(60), phone: text(30).regex(/^(?:1[3-9]\d{9}|0\d{2,3}[- ]?\d{7,8}(?:[- ]\d{1,6})?)$/, '请填写国内手机号或带区号的座机'), province: text(30), city: text(30), county: text(30), address: text(200).min(5, '请补充街道和门牌号') }).strict()
const shippingSubmitterSchema = z.object({ name: text(60), phone: text(30).regex(/^1[3-9]\d{9}$/, '请填写提报人手机号'), team: text(80) }).strict()
export const shippingInputSchema = z.object({ sender: contactSchema, recipient: contactSchema, cargo: text(60), weight: z.number().finite().positive().max(20), serviceId: z.number().int().positive(), remark: z.string().trim().max(100), source: z.literal('manual'), payment: z.enum(['sender_cash', 'recipient', 'sender_monthly']).optional(), customerName: z.string().trim().max(120).optional(), submittedBy: shippingSubmitterSchema.optional(), specialRequirements: z.string().trim().max(500).optional(), pickupWindow: z.string().trim().max(80).optional() }).strict()
export const createSchema = z.object({ key: z.string().uuid(), input: shippingInputSchema, confirmed: z.literal(true) }).strict()
const anonymousShippingInputSchema = shippingInputSchema.extend({
  sender: contactSchema.optional(),
  payment: z.literal('sender_monthly').optional(),
  customerName: text(120),
  submittedBy: shippingSubmitterSchema,
  specialRequirements: z.string().trim().max(500).optional(),
})
export const anonymousShipmentSchema = z.object({
  key: z.string().uuid(),
  rawInput: z.string().trim().max(2000).optional(),
  input: anonymousShippingInputSchema,
  contextToken: z.string().trim().max(2048).optional(),
  businessCode: z.string().trim().regex(/^[A-Za-z0-9_-]{4,40}$/).optional(),
}).strict()
export const shipmentLedgerQuerySchema = z.object({
  salesRef: z.string().trim().max(120).optional(),
  customerRef: z.string().trim().max(120).optional(),
  contact: z.string().trim().max(60).optional(),
  status: z.enum(['accepted','awaiting_confirmation','returned','confirmed','ordering','order_unknown','waybill_created','in_transit','delivered','cancelled','order_failed']).optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict()
export const returnShipmentSchema = z.object({ reason: z.string().trim().min(2, '请填写退回原因').max(300) }).strict()
export const assignShipmentSchema = z.object({ salesRef: z.string().trim().min(1, '请填写销售标识').max(120), customerRef: z.string().trim().max(120).optional() }).strict()
export const trackingSchema = z.object({ waybill: z.string().trim().toUpperCase().regex(/^(?:SF)?\d{10,15}$/, '请输入一个有效顺丰运单号'), phoneSuffix: z.string().regex(/^\d{4}$/, '请输入收寄任一方手机号后四位').optional() }).strict()

// Imported address records may be incomplete; actual shipment creation still uses contactSchema.
export const savedContactSchema = z.object({ name: z.string().max(60), phone: z.string().max(30), province: z.string().max(30), city: z.string().max(30), county: z.string().max(30), address: z.string().max(200) })
