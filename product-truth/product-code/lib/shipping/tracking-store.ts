import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import type { TrackingResult } from './types'

export async function recordTrackingResult(orgId: string, result: TrackingResult, providerKey = 'sf') {
  if (typeof orgId !== 'string' || !orgId.trim()) throw new ShippingError(403, '当前请求缺少组织寄件授权。')
  const { data: waybill, error } = await supabaseAdmin.from('shipping_waybills')
    .select('id,shipping_order_id,shipping_orders!inner(org_id)')
    .eq('shipping_orders.org_id', orgId).eq('carrier_key', providerKey).eq('waybill_no', result.waybill).maybeSingle()
  if (error) throw new ShippingError(503, '物流事件归属查询失败。')
  if (!waybill) return { recorded: 0 }
  const order = Array.isArray(waybill.shipping_orders) ? waybill.shipping_orders[0] : waybill.shipping_orders
  if (!order || order.org_id !== orgId) return { recorded: 0 }
  const rows = result.events.map(event => ({ waybill_id: waybill.id, provider_key: providerKey, provider_event_id: createHash('sha256').update(`${event.time}|${event.location}|${event.description}`).digest('hex'), status: /签收|已收取/.test(event.description) ? 'delivered' : /派送|派件/.test(event.description) ? 'out_for_delivery' : 'in_transit', event_at: event.time, location: event.location || null, description: event.description }))
  if (rows.length) {
    const { error: insertError } = await supabaseAdmin.from('shipping_tracking_events').upsert(rows, { onConflict: 'waybill_id,provider_key,provider_event_id', ignoreDuplicates: true })
    if (insertError) throw new ShippingError(503, '物流事件保存失败。')
  }
  const latest = rows.sort((a, b) => b.event_at.localeCompare(a.event_at))[0]
  if (latest) {
    const { error: updateError } = await supabaseAdmin.from('shipping_waybills')
      .update({ latest_status: latest.status, latest_event_at: latest.event_at, updated_at: new Date().toISOString() })
      .eq('id', waybill.id).eq('shipping_order_id', waybill.shipping_order_id)
    if (updateError) throw new ShippingError(503, '物流状态保存失败。')
  }
  return { recorded: rows.length }
}
