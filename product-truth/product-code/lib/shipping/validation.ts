import { z } from 'zod'
import { DEFAULT_INTAKE_RULES, intakeFieldSchema, type IntakeRules } from './intake-rules'
import { DOMESTIC_SHIPPING_PHONE_PATTERN } from './phone'
const text = (max: number) => z.string().trim().min(1, '请填写完整信息').max(max)
export const contactSchema = z.object({ name: text(60), phone: text(30).regex(DOMESTIC_SHIPPING_PHONE_PATTERN, '请填写国内手机号或带区号的座机'), province: text(30), city: text(30), county: text(30), address: text(200).min(5, '请补充街道和门牌号') }).strict()
const shippingSubmitterSchema = z.object({ name: text(60), phone: text(30).regex(DOMESTIC_SHIPPING_PHONE_PATTERN, '请填写国内手机号或带区号的座机'), team: text(80) }).strict()
export const shippingInputSchema = z.object({ sender: contactSchema, recipient: contactSchema, cargo: text(60), weight: z.number().finite().positive().max(20), serviceId: z.number().int().positive().optional(), servicePreference: z.enum(['standard', 'urgent']).optional(), remark: z.string().trim().max(100), source: z.literal('manual'), payment: z.enum(['sender_cash', 'recipient', 'sender_monthly']).optional(), customerName: z.string().trim().max(120).optional(), submittedBy: shippingSubmitterSchema.optional(), specialRequirements: z.string().trim().max(500).optional(), pickupWindow: z.string().trim().max(80).optional() }).strict()
const ownerShippingInputSchema = shippingInputSchema.extend({ serviceId: z.number().int().positive() })
export const createSchema = z.object({ key: z.string().uuid(), input: ownerShippingInputSchema, confirmed: z.literal(true) }).strict()
const operatorIntakeInputSchema = shippingInputSchema.extend({
  sender: contactSchema.optional(),
  weight: z.number().finite().positive().max(20).default(1),
  servicePreference: z.enum(['standard', 'urgent']).default('standard'),
  remark: z.string().trim().max(100).default(''),
  source: z.literal('manual').default('manual'),
  payment: z.enum(['sender_cash', 'recipient', 'sender_monthly']).default('sender_monthly'),
})
// Legacy fields are accepted for existing clients; they never authorize carrier
// submission. Actual connection/account/service selection happens at review.
export const ownerOrderSchema = z.object({ key: z.string().uuid(), input: operatorIntakeInputSchema, confirmed: z.literal(true).optional(), connectionId: z.string().uuid().optional(), billingAccountId: z.string().uuid().optional() }).strict()
export const orderSelectionSchema = z.object({ payment: z.enum(['sender_cash', 'recipient', 'sender_monthly']).optional(), connectionId: z.string().uuid().optional(), billingAccountId: z.string().uuid().optional(), serviceId: z.number().int().positive().optional() }).strict()
const anonymousShippingInputSchema = (rules: IntakeRules) => shippingInputSchema.extend({
  sender: contactSchema,
  servicePreference: z.enum(['standard', 'urgent']).default('standard'),
  payment: z.literal('sender_monthly').optional(),
  customerName: intakeFieldSchema(rules.companyName, '公司名称', 120),
  submittedBy: shippingSubmitterSchema.extend({ team: intakeFieldSchema(rules.team, '所属团队', 80, rules.teamOptions) }),
  specialRequirements: z.string().trim().max(500).optional(),
}).superRefine((input, ctx) => {
  if (input.sender.name !== input.submittedBy.name) ctx.addIssue({ code: 'custom', path: ['sender', 'name'], message: '寄件人姓名须与提报人个人资料一致。' })
  if (input.sender.phone !== input.submittedBy.phone) ctx.addIssue({ code: 'custom', path: ['sender', 'phone'], message: '寄件人电话须与提报人个人资料一致。' })
})
export const makeAnonymousShipmentSchema = (rules: IntakeRules = DEFAULT_INTAKE_RULES) => z.object({
  key: z.string().uuid(),
  rawInput: z.string().trim().max(2000).optional(),
  input: anonymousShippingInputSchema(rules),
  contextToken: z.string().trim().max(2048).optional(),
  businessCode: z.string().trim().regex(/^[A-Za-z0-9_-]{4,40}$/).optional(),
}).strict()
export const anonymousShipmentSchema = makeAnonymousShipmentSchema()
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
