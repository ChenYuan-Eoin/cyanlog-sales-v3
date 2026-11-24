import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import { getCarrierAdapter } from './carrier-adapter'
import { recordShippingCapability } from './connections'
import { recordTrackingResult } from './tracking-store'
import { latestVerifiedTrackingEvent } from './owner-tracking'

const observedState = z.object({
  revision: z.number().int().min(1),
  status: z.enum(['accepted','awaiting_confirmation','confirmed','returned','order_failed','waybill_created']),
  waybill: z.string().min(1).nullable(),
}).strict()
const staleMessage = '这张寄件单已变化或页面版本过旧，请刷新提报记录后重新确认。'

export async function cancelOriginalShipment(reference: string, actor: string, org: string, owner: boolean, expected?: unknown) {
  if (!org || !actor) throw new ShippingError(403, '当前账号没有组织寄件权限。')
  const snapshot = owner ? observedState.safeParse(expected) : null
  if (snapshot && !snapshot.success) throw new ShippingError(409, staleMessage)
  const attempt = randomUUID()
  const { data: claim, error } = await supabaseAdmin.rpc('claim_shipping_cancellation_v1', {
    p_org: org, p_actor: actor, p_reference: reference, p_owner: owner, p_attempt: attempt,
    ...(snapshot?.success ? { p_expected: snapshot.data } : {}),
  })
  if (error || !claim) throw new ShippingError(503, '取消状态暂时无法读取，请刷新后核对。')
  const id = claim.id as string
  if (claim.result === 'missing') throw new ShippingError(404, '寄件单不存在。')
  if (claim.result === 'stale') throw new ShippingError(409, staleMessage)
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
    if (claim.environment !== 'sandbox') {
      if (claim.environment !== 'production') throw new ShippingError(409, '原单环境不完整；没有发送取消请求。')
      const { data: row, error: readError } = await supabaseAdmin.from('shipping_orders')
        .select('status,provider_key,provider_order_id,carrier_connection_id,billing_account_id,connection_environment,shipping_waybills(waybill_no,provider_order_id,carrier_key)')
        .eq('org_id', org).eq('id', id).maybeSingle()
      const waybills = Array.isArray(row?.shipping_waybills) ? row.shipping_waybills : row?.shipping_waybills ? [row.shipping_waybills] : []
      const wb = waybills[0]
      if (readError || !row || waybills.length !== 1 || !wb?.waybill_no) throw new ShippingError(503, '取消前无法核实原运单；没有发送取消请求。')
      if (row.status !== 'waybill_created' || row.carrier_connection_id !== claim.connectionId
        || row.billing_account_id !== claim.billingAccountId || row.connection_environment !== claim.environment
        || row.provider_key !== claim.provider || row.provider_order_id !== claim.providerOrderId
        || wb.provider_order_id !== claim.providerOrderId || wb.carrier_key !== claim.provider
        || (snapshot?.success && wb.waybill_no !== snapshot.data.waybill)) throw new ShippingError(409, staleMessage)
      const latest = await carrier.track(wb.waybill_no)
      const latestEvent = latestVerifiedTrackingEvent(latest, wb.waybill_no)
      if (!latestEvent) throw new ShippingError(503, '顺丰没有返回可信的最新状态；没有发送取消请求。')
      const saved = await recordTrackingResult(org, latest, claim.provider)
      if (!saved.recorded || !saved.shipmentStatus) throw new ShippingError(503, '顺丰状态未能可靠保存；没有发送取消请求。')
      if (latestEvent.status !== 'waybill_created' || saved.shipmentStatus !== 'waybill_created') {
        throw new ShippingError(409, saved.shipmentStatus === 'delivered'
          ? '顺丰最新轨迹显示已签收，已阻止取消。请刷新提报记录。'
          : '顺丰最新状态不允许取消；没有发送取消请求。请刷新提报记录。')
      }
    }
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
