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
type Scope = { orgId: string; userId: string } & (
  | { orderNo: string; orderId?: never }
  | { orderId: string; orderNo?: never }
)
const receiptSchema = z.object({
  action: z.enum(actions), status: z.enum(['pending', 'accepted', 'unknown', 'rejected', 'not_sent']),
  requestedAt: z.string(), originalRecipient: contactSchema, destination: contactSchema,
  instructionId: z.string().nullable(), amount: z.string().nullable(),
})
export type CarrierChangeReceipt = z.infer<typeof receiptSchema>
export type CarrierChangeDetail = {
  orderNo: string; actions: Array<typeof actions[number]>; latest: CarrierChangeReceipt | null
  currentRecipient: Contact | null; returnDestination: Contact | null
  unavailableReason?: 'intercept_disabled'
}
const context = z.object({
  connectionId: z.string().uuid(), accountId: z.string().uuid(), waybill: z.string(), providerOrderId: z.string().min(1),
  environment: z.enum(['sandbox','production']), binding: z.string().regex(/^[a-f0-9]{64}$/),
})
const stateSchema = z.discriminatedUnion('result', [
  z.object({ result: z.literal('detail'), orderNo: z.string(), latest: receiptSchema.nullable(),
    currentRecipient: z.unknown(), returnDestination: z.unknown(), context: context.nullable(),
    unavailableReason: z.literal('intercept_disabled').nullish() }),
  z.object({ result: z.literal('replay'), latest: receiptSchema }),
  z.object({ result: z.literal('dispatch') }),
])
function scopeArgs(scope: Scope) {
  const identity = scope.orderId
    ? { p_order_no: null, p_order_id: scope.orderId }
    : { p_order_no: scope.orderNo }
  return { p_org: scope.orgId, p_actor: scope.userId, ...identity }
}
async function readOrClaim(scope: Scope, submission?: Request, binding?: string) {
  const { data, error } = await supabaseAdmin.rpc(scope.orderId ? 'shipping_carrier_change_v1' : 'owner_carrier_change_v1', {
    ...scopeArgs(scope), p_key: submission?.key ?? null, p_action: submission?.action ?? null,
    p_recipient: submission?.action === 'modify_recipient' ? submission.recipient : null, p_binding: binding ?? null,
  })
  if (error?.code === '22023') throw new ShippingError(422, '请核对需要修改的收件资料。')
  if (error?.code === '40001' || error?.code === '23505') throw new ShippingError(409, '工单状态、请求内容或承运商连接已变化，请刷新核对。')
  if (error) throw new ShippingError(503, '承运商操作记录暂时无法核对。')
  if (!data) throw new ShippingError(404, scope.orderId ? '寄件记录中没有这张工单。' : '本人提报记录中没有这张工单。')
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
export async function getCarrierChange(scope: Scope, { checkAvailability }: { checkAvailability: boolean }): Promise<CarrierChangeDetail> {
  const state = await readOrClaim(scope)
  if (state.result !== 'detail') throw new ShippingError(503, '工单状态暂时无法读取。')
  const currentRecipient = validContact(state.currentRecipient)
  const returnDestination = validContact(state.returnDestination)
  let allowed = checkAvailability && Boolean(state.context && currentRecipient && returnDestination)
  if (allowed && state.context?.environment === 'sandbox') {
    const original = state.context
    const carrier = await connectOriginal(scope.orgId, original)
    allowed = await carrier.beforeDispatch(original.providerOrderId, original.waybill)
  }
  return { orderNo: state.orderNo, currentRecipient, returnDestination, latest: state.latest,
    actions: allowed ? [...actions] : [],
    ...(state.unavailableReason ? { unavailableReason: state.unavailableReason } : {}) }
}
export async function submitCarrierChange(scope: Scope, submission: Request): Promise<CarrierChangeReceipt> {
  const state = await readOrClaim(scope, submission)
  if (state.result === 'replay') return state.latest
  if (state.result === 'detail' && state.unavailableReason === 'intercept_disabled') {
    throw new ShippingError(409, '原单的顺丰连接尚未在寄件配置中启用在途转寄与退回。')
  }
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
  const finish = await supabaseAdmin.rpc(scope.orderId ? 'finish_shipping_carrier_change_v1' : 'finish_owner_carrier_change_v1', {
    ...scopeArgs(scope), p_key: submission.key, p_status: outcome, p_instruction_id: receipt.instructionId, p_amount: receipt.amount,
  })
  if (finish.error || finish.data !== true) throw new ShippingError(503, '指令结果暂时无法保存，请用原请求核对，避免重复下发。')
  const saved = await readOrClaim(scope, submission)
  if (saved.result !== 'replay') throw new ShippingError(503, '请用原请求核对承运商回执。')
  return saved.latest
}
