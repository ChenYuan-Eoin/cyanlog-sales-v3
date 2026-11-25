import { supabaseAdmin } from '@/lib/supabase'
import { getCarrierAdapter } from './carrier-adapter'
import { ShippingError } from './config'
import { normalizeTrackingTime } from './tracking-status'
import { recordTrackingResult } from './tracking-store'
import type { TrackingResult } from './types'

export function latestVerifiedTrackingEvent(result: TrackingResult, waybill: string) {
  if (result.source !== 'carrier' || result.waybill !== waybill || !result.events.length) return null
  const sorted = result.events.map(event => ({ event, time: normalizeTrackingTime(event.time) }))
    .sort((a, b) => (b.time || '').localeCompare(a.time || ''))
  if (sorted.some(item => !item.time)) return null
  const latest = sorted[0].event
  return latest.status && latest.status !== 'unknown' ? latest : null
}

export async function refreshOwnerTracking(orgId: string, userId: string, orderNo: string) {
  if (!orgId || !userId) throw new ShippingError(403, '当前账号没有组织寄件权限。')
  const { data, error } = await supabaseAdmin.from('shipping_orders')
    .select('provider_key,provider_order_id,carrier_connection_id,billing_account_id,connection_environment,shipping_waybills(waybill_no,provider_order_id,carrier_key)')
    .eq('org_id', orgId).eq('created_by', userId).eq('intake_source', 'owner_web').eq('order_no', orderNo).maybeSingle()
  if (error) throw new ShippingError(503, '原运单状态暂时无法读取。')
  if (!data) throw new ShippingError(404, '本人提报记录中没有这张工单。')
  const waybills = Array.isArray(data.shipping_waybills) ? data.shipping_waybills : data.shipping_waybills ? [data.shipping_waybills] : []
  const wb = waybills[0]
  if (waybills.length !== 1 || !wb?.waybill_no || !data.carrier_connection_id || !data.provider_order_id?.trim()
    || !['production', 'sandbox'].includes(data.connection_environment)
    || wb.provider_order_id !== data.provider_order_id || wb.carrier_key !== data.provider_key) {
    throw new ShippingError(409, '原运单或顺丰连接快照不完整，暂不能核实物流状态。')
  }
  const carrier = await getCarrierAdapter(data.provider_key).connect({ orgId, connectionId: data.carrier_connection_id,
    billingAccountId: data.billing_account_id, expectedEnvironment: data.connection_environment, allowHistorical: true, requireOrderCapability: false })
  const result = await carrier.trackOrder(data.provider_order_id, wb.waybill_no)
  if (!latestVerifiedTrackingEvent(result, wb.waybill_no)) throw new ShippingError(503, '顺丰未返回可信的最新状态，请稍后刷新。')
  const saved = await recordTrackingResult(orgId, result, data.provider_key)
  if (!saved.recorded || !saved.shipmentStatus) throw new ShippingError(503, '顺丰状态尚未保存，请稍后刷新。')
  return { ...result, verified: true, shipmentStatus: saved.shipmentStatus }
}
