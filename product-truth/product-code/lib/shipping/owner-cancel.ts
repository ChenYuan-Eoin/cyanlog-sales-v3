import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import { getCarrierAdapter } from './carrier-adapter'
import { recordShippingCapability } from './connections'

export async function cancelOriginalShipment(reference: string, actor: string, org: string, owner: boolean) {
  if (!org || !actor) throw new ShippingError(403, '当前账号没有组织寄件权限。')
  const attempt = randomUUID()
  const { data: claim, error } = await supabaseAdmin.rpc('claim_shipping_cancellation_v1', {
    p_org: org, p_actor: actor, p_reference: reference, p_owner: owner, p_attempt: attempt,
  })
  if (error || !claim) throw new ShippingError(503, '取消状态暂时无法读取，请刷新后核对。')
  const id = claim.id as string
  if (claim.result === 'missing') throw new ShippingError(404, '寄件单不存在。')
  if (claim.result === 'cancelled') return { id, status: 'cancelled' as const }
  if (claim.result === 'pending') throw new ShippingError(409, '已请求取消，结果待核实。请勿再次撤单。')
  if (claim.result === 'uncertain') throw new ShippingError(409, '下单结果未确定，请先核实原单。')
  if (claim.result === 'rejected') throw new ShippingError(409, '承运商已拒绝取消，请联系操作员核对原单。')
  if (claim.result !== 'dispatch') throw new ShippingError(409, '只有未揽收且已生成运单的订单可以取消；发运状态异常时请先核实原单。')
  async function finish(outcome: string, reason: string) {
    const res = await supabaseAdmin.rpc('finish_shipping_cancellation_v1', {
      p_org: org, p_order: id, p_attempt: attempt, p_outcome: outcome, p_reason: reason,
    })
    if (res.data === 'manual_review') throw new ShippingError(409, '承运商确认取消时本地状态已变化，请核对原单与取消回执。')
    if (res.error || res.data !== outcome) throw new ShippingError(503, '取消结果需要核实，已保留原请求，请勿重复取消。')
  }
  let sent = false
  try {
    const adapter = getCarrierAdapter(claim.provider)
    const carrier = await adapter.connect({allowHistorical:true, requireOrderCapability:false, expectedEnvironment:claim.environment,
      orgId:org, connectionId:claim.connectionId, billingAccountId:claim.billingAccountId})
    sent = true
    await carrier.cancel(claim.providerOrderId)
  } catch (cause) {
    const known = cause instanceof ShippingError ? cause : null
    const outcome = !sent || known?.requestStage === 'provider_not_sent' ? 'not_sent' : known?.requestStage === 'provider_rejected' ? 'rejected' : 'unknown'
    const message = known?.message ?? '未取得可核对的承运商回执。'
    await finish(outcome, message)
    throw new ShippingError(known?.status ?? 502, outcome === 'unknown' ? '未收到明确的取消回执，已保留原请求，请勿重复撤单。' : message, known?.requestStage)
  }
  await finish('accepted', '原单取消回执已核对。')
  try { await recordShippingCapability(org, claim.connectionId, 'cancel') }
  catch { console.error('shipping.capability.record_failed', { capability: 'cancel' }) }
  return { id, status: 'cancelled' as const }
}
