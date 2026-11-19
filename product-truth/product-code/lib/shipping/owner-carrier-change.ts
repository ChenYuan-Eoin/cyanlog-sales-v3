import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { getCarrierAdapter } from './carrier-adapter'
import { ShippingError } from './config'
import type { Contact } from './types'
import { contactSchema } from './validation'

const actions = ['modify_recipient', 'return_to_sender'] as const
export const carrierChangeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('modify_recipient'), key: z.string().uuid(), recipient: contactSchema }).strict(),
  z.object({ action: z.literal('return_to_sender'), key: z.string().uuid() }).strict(),
])
type Request = z.infer<typeof carrierChangeSchema>
type Scope = { orgId: string; userId: string; orderNo: string }
const receiptSchema = z.object({
  action: z.enum(actions), status: z.enum(['pending', 'accepted', 'unknown', 'rejected', 'not_sent']),
  requestedAt: z.string(), originalRecipient: contactSchema, destination: contactSchema,
  instructionId: z.string().nullable(), amount: z.string().nullable(),
})
export type CarrierChangeReceipt = z.infer<typeof receiptSchema>
export type CarrierChangeDetail = {
  orderNo: string; actions: Array<typeof actions[number]>; latest: CarrierChangeReceipt | null
  currentRecipient: Contact | null; returnDestination: Contact | null
}
const context = z.object({
  connectionId: z.string().uuid(), accountId: z.string().uuid(), waybill: z.string(), providerOrderId: z.string().min(1),
  environment: z.enum(['sandbox','production']), binding: z.string().regex(/^[a-f0-9]{64}$/),
})
const stateSchema = z.discriminatedUnion('result', [
  z.object({ result: z.literal('detail'), orderNo: z.string(), latest: receiptSchema.nullable(),
    currentRecipient: z.unknown(), returnDestination: z.unknown(), context: context.nullable() }),
  z.object({ result: z.literal('replay'), latest: receiptSchema }),
  z.object({ result: z.literal('dispatch') }),
])
function scopeArgs(scope: Scope) {
  return { p_org: scope.orgId, p_actor: scope.userId, p_order_no: scope.orderNo }
}
async function readOrClaim(scope: Scope, submission?: Request, binding?: string) {
  const { data, error } = await supabaseAdmin.rpc('owner_carrier_change_v1', {
    ...scopeArgs(scope), p_key: submission?.key ?? null, p_action: submission?.action ?? null,
    p_recipient: submission?.action === 'modify_recipient' ? submission.recipient : null, p_binding: binding ?? null,
  })
  if (error?.code === '22023') throw new ShippingError(422, '请核对需要修改的收件资料。')
  if (error?.code === '40001' || error?.code === '23505') throw new ShippingError(409, '工单状态、请求内容或承运商连接已变化，请刷新核对。')
  if (error) throw new ShippingError(503, '承运商操作记录暂时无法核对。')
  if (!data) throw new ShippingError(404, '本人提报记录中没有这张工单。')
  const state = stateSchema.safeParse(data)
  if (!state.success) throw new ShippingError(503, '承运商操作记录格式异常，请核对原单。')
  return state.data
}
function validContact(value: unknown) {
  const contact = contactSchema.safeParse(value)
  return contact.success ? contact.data : null
}
function connectOriginal(orgId: string, original: z.infer<typeof context>) {
  return getCarrierAdapter('sf').connect({ orgId, connectionId: original.connectionId,
    billingAccountId: original.accountId, payment: 'sender_monthly', requireOrderCapability: false,
    expectedEnvironment: original.environment })
}
export async function getOwnerCarrierChange(scope: Scope): Promise<CarrierChangeDetail> {
  const state = await readOrClaim(scope)
  if (state.result !== 'detail') throw new ShippingError(503, '工单状态暂时无法读取。')
  const currentRecipient = validContact(state.currentRecipient)
  const returnDestination = validContact(state.returnDestination)
  let allowed = Boolean(state.context && currentRecipient && returnDestination)
  if (allowed && state.context?.environment === 'sandbox') {
    const original = state.context
    const carrier = await connectOriginal(scope.orgId, original)
    allowed = await carrier.beforeDispatch(original.providerOrderId, original.waybill)
  }
  return { orderNo: state.orderNo, currentRecipient, returnDestination, latest: state.latest,
    actions: allowed ? [...actions] : [] }
}
export async function submitOwnerCarrierChange(scope: Scope, submission: Request): Promise<CarrierChangeReceipt> {
  const state = await readOrClaim(scope, submission)
  if (state.result === 'replay') return state.latest
  if (state.result !== 'detail' || !state.context || !validContact(state.currentRecipient) || !validContact(state.returnDestination)) {
    throw new ShippingError(409, '当前原单、承运商授权或运输阶段不支持此操作。')
  }
  const original = state.context
  const destination = submission.action === 'return_to_sender' ? contactSchema.parse(state.returnDestination) : submission.recipient
  const carrier = await connectOriginal(scope.orgId, original)
  if (!await carrier.beforeDispatch(original.providerOrderId, original.waybill)) {
    throw new ShippingError(409, '顺丰当前路由未能确认快件仍在派件出仓前。')
  }
  const claim = await readOrClaim(scope, submission, original.binding)
  if (claim.result === 'replay') return claim.latest
  if (claim.result !== 'dispatch') throw new ShippingError(409, '原单已变化，请刷新后核对。')

  let outcome: CarrierChangeReceipt['status'] = 'accepted'
  let receipt: { instructionId: string | null; amount: string | null } = { instructionId: null, amount: null }
  try {
    receipt = await carrier.changeRecipient(original.waybill, submission.action, destination)
  } catch (error) {
    const stage = error instanceof ShippingError ? error.requestStage : undefined
    outcome = stage === 'provider_not_sent' ? 'not_sent' : stage === 'provider_rejected' ? 'rejected' : 'unknown'
  }
  const finish = await supabaseAdmin.rpc('finish_owner_carrier_change_v1', {
    ...scopeArgs(scope), p_key: submission.key, p_status: outcome, p_instruction_id: receipt.instructionId, p_amount: receipt.amount,
  })
  if (finish.error || finish.data !== true) throw new ShippingError(503, '指令结果暂时无法保存，请用原请求核对，避免重复下发。')
  const saved = await readOrClaim(scope, submission)
  if (saved.result !== 'replay') throw new ShippingError(503, '请用原请求核对承运商回执。')
  return saved.latest
}

export async function getLedgerCarrierChange(orgId: string, orderId: string): Promise<{ latest: CarrierChangeReceipt | null }> {
  const { data, error } = await supabaseAdmin.from('shipping_carrier_changes')
    .select('action,status,originalRecipient:original_recipient,destination,requestedAt:requested_at,instructionId:instruction_id,amount,shipping_orders!inner(org_id)')
    .eq('shipping_orders.org_id', orgId).eq('order_id', orderId).order('requested_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new ShippingError(503, '承运商操作记录暂时无法读取。')
  if (!data) return { latest: null }
  const receipt = receiptSchema.safeParse(data)
  if (!receipt.success) throw new ShippingError(503, '承运商操作记录格式异常，请核对原单。')
  return { latest: receipt.data }
}
