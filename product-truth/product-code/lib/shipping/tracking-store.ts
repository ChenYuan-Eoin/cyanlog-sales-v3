import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import type { TrackingResult } from './types'

export async function recordTrackingResult(result: TrackingResult, providerKey = 'sf') {
  const { data: waybill, error } = await supabaseAdmin.from('shipping_waybills').select('id').eq('carrier_key', providerKey).eq('waybill_no', result.waybill).maybeSingle()
  if (error) throw new ShippingError(503, '物流事件归属查询失败。')
  if (!waybill) return { recorded: 0 }
  const rows = result.events.map(event => ({ waybill_id: waybill.id, provider_key: providerKey, provider_event_id: createHash('sha256').update(`${event.time}|${event.location}|${event.description}`).digest('hex'), status: /签收|已收取/.test(event.description) ? 'delivered' : /派送|派件/.test(event.description) ? 'out_for_delivery' : 'in_transit', event_at: event.time, location: event.location || null, description: event.description }))
  if (rows.length) {
    const { error: insertError } = await supabaseAdmin.from('shipping_tracking_events').upsert(rows, { onConflict: 'waybill_id,provider_key,provider_event_id', ignoreDuplicates: true })
    if (insertError) throw new ShippingError(503, '物流事件保存失败。')
  }
  const latest = rows.sort((a, b) => b.event_at.localeCompare(a.event_at))[0]
  if (latest) await supabaseAdmin.from('shipping_waybills').update({ latest_status: latest.status, latest_event_at: latest.event_at, updated_at: new Date().toISOString() }).eq('id', waybill.id)
  return { recorded: rows.length }
}
