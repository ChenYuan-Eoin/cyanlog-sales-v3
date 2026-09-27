import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import { normalizeTrackingStatus, normalizeTrackingTime } from './tracking-status'
import type { ShipmentOrderStatus, TrackingResult } from './types'

type TrackedOrder = { org_id: string | null; status: ShipmentOrderStatus }
type TrackedWaybill = {
  id: string
  shipping_order_id: string
  latest_event_at: string | null
  latest_status: string | null
  shipping_orders: TrackedOrder | TrackedOrder[] | null
}

function progress(status: string | null) {
  return status === 'delivered' ? 3 : status === 'out_for_delivery' ? 2 : status === 'in_transit' ? 1 : status === 'waybill_created' ? 0 : -1
}

function nextShipmentStatus(current: ShipmentOrderStatus, trackingStatus: string | null): ShipmentOrderStatus {
  if (current === 'waybill_created') {
    if (trackingStatus === 'delivered') return 'delivered'
    if (trackingStatus === 'in_transit' || trackingStatus === 'out_for_delivery') return 'in_transit'
  }
  if (current === 'in_transit' && trackingStatus === 'delivered') return 'delivered'
  return current
}

export async function recordTrackingResult(orgId: string, result: TrackingResult, providerKey = 'sf'): Promise<{ recorded: number; shipmentStatus?: ShipmentOrderStatus }> {
  if (typeof orgId !== 'string' || !orgId.trim()) throw new ShippingError(403, '当前请求缺少组织寄件授权。')

  async function readCurrent() {
    const { data, error } = await supabaseAdmin.from('shipping_waybills')
      .select('id,shipping_order_id,latest_event_at,latest_status,shipping_orders!inner(org_id,status)')
      .eq('shipping_orders.org_id', orgId).eq('carrier_key', providerKey).eq('waybill_no', result.waybill).maybeSingle()
    if (error) throw new ShippingError(503, '物流事件归属查询失败。')
    if (!data) return null
    const waybill = data as unknown as TrackedWaybill
    const order = Array.isArray(waybill.shipping_orders) ? waybill.shipping_orders[0] : waybill.shipping_orders
    return order?.org_id === orgId ? { waybill, order } : null
  }

  let current = await readCurrent()
  if (!current) return { recorded: 0 }
  const rows = result.events.flatMap(event => {
    const time = normalizeTrackingTime(event.time)
    if (!time) return []
    return [{
      waybill_id: current!.waybill.id,
      provider_key: providerKey,
      provider_event_id: createHash('sha256').update(`${time}|${event.location}|${event.description}`).digest('hex'),
      status: event.status ?? normalizeTrackingStatus({ description: event.description }),
      event_at: time,
      location: event.location || null,
      description: event.description,
    }]
  }).sort((left, right) => right.event_at.localeCompare(left.event_at) || progress(right.status) - progress(left.status))
  if (!rows.length) return { recorded: 0, shipmentStatus: current.order.status }

  const { error: insertError } = await supabaseAdmin.from('shipping_tracking_events')
    .upsert(rows, { onConflict: 'waybill_id,provider_key,provider_event_id', ignoreDuplicates: true })
  if (insertError) throw new ShippingError(503, '物流事件保存失败。')

  // Compare-and-set both timestamp and state. A concurrent cancellation may
  // change state without changing the last provider event timestamp.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { waybill, order } = current
    if (order.status === 'cancelled' || order.status === 'delivered' || waybill.latest_status === 'cancelled' || waybill.latest_status === 'delivered') break
    const savedTime = waybill.latest_event_at ? normalizeTrackingTime(waybill.latest_event_at) : null
    const eligible = rows.filter(event => !savedTime || event.event_at >= savedTime)
    if (!eligible.length) break
    const latestTime = eligible[0].event_at
    let latestStatus = waybill.latest_status || 'waybill_created'
    if (progress(order.status) > progress(latestStatus)) latestStatus = order.status
    for (const event of eligible) {
      if (progress(event.status) > progress(latestStatus)) latestStatus = event.status
    }
    if (savedTime === latestTime && latestStatus === waybill.latest_status) break

    let update = supabaseAdmin.from('shipping_waybills')
      .update({ latest_status: latestStatus, latest_event_at: latestTime, updated_at: new Date().toISOString() })
      .eq('id', waybill.id).eq('shipping_order_id', waybill.shipping_order_id)
    update = waybill.latest_event_at === null ? update.is('latest_event_at', null) : update.eq('latest_event_at', waybill.latest_event_at)
    update = waybill.latest_status === null ? update.is('latest_status', null) : update.eq('latest_status', waybill.latest_status)
    const { data: updated, error: updateError } = await update.select('id').maybeSingle()
    if (updateError) throw new ShippingError(503, '物流状态保存失败。')
    current = await readCurrent()
    if (!current) return { recorded: rows.length }
    if (updated) break
  }

  // Use the state that actually survived the waybill CAS, including another
  // request's newer result. A failed status CAS is re-read before one retry.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { waybill, order } = current
    const nextStatus = nextShipmentStatus(order.status, waybill.latest_status)
    if (nextStatus === order.status) return { recorded: rows.length, shipmentStatus: order.status }
    const { data: updated, error: updateError } = await supabaseAdmin.from('shipping_orders')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', waybill.shipping_order_id).eq('org_id', orgId).eq('status', order.status)
      .select('status').maybeSingle()
    if (updateError) throw new ShippingError(503, '寄件单物流状态保存失败。')
    if (updated?.status === nextStatus) return { recorded: rows.length, shipmentStatus: nextStatus }
    current = await readCurrent()
    if (!current) return { recorded: rows.length }
  }
  return { recorded: rows.length, shipmentStatus: current.order.status }
}
