import { supabaseAdmin } from '@/lib/supabase'
import { requireShippingConnection, ShippingError } from './config'
import { checkShippingPolicy, submitShipping } from './service'
import { shippingStore } from './store'
import { cancelSfOrder, createSfOrder, lookupSfOrder } from './sf-client'
import type { ShippingInput } from './types'

type ProcessRow = {
  id: string
  status: string
  shipment_payload: ShippingInput
  provider_key: string
  provider_order_id: string | null
}

async function loadForAction(id: string): Promise<ProcessRow> {
  const { data, error } = await supabaseAdmin.from('shipping_orders').select('id,status,shipment_payload,provider_key,provider_order_id').eq('id', id).single()
  if (error || !data) throw new ShippingError(404, '寄件单不存在。')
  return data as ProcessRow
}

export async function returnShipmentOrder(id: string, userId: string, reason: string) {
  const { data, error } = await supabaseAdmin.from('shipping_orders').update({ status: 'returned', returned_reason: reason, confirmed_by: userId, updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'awaiting_confirmation').select('id,order_no,status,returned_reason').maybeSingle()
  if (error) throw new ShippingError(503, '寄件单退回失败。')
  if (!data) throw new ShippingError(409, '寄件单状态已变化，请刷新后重试。')
  return data
}

export async function confirmAndSubmitShipment(id: string, userId: string) {
  const row = await loadForAction(id)
  if (row.provider_key !== 'sf') throw new ShippingError(400, '当前承运商尚未配置下单Adapter。')
  if (row.status !== 'accepted' && row.status !== 'awaiting_confirmation' && row.status !== 'confirmed' && row.status !== 'order_unknown') throw new ShippingError(409, '当前寄件单不能确认下单。')
  if (row.status === 'order_unknown') return reconcileShipmentOrder(id)
  const config = requireShippingConnection(true)
  checkShippingPolicy(row.shipment_payload, config.services)
  if ((!row.shipment_payload.payment || row.shipment_payload.payment === 'sender_monthly') && !config.monthly) throw new ShippingError(400, '公司月结账号尚未配置。')

  if (row.status === 'accepted' || row.status === 'awaiting_confirmation') {
    const { data, error } = await supabaseAdmin.from('shipping_orders').update({ status: 'ordering', confirmed_by: userId, confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id).in('status', ['accepted', 'awaiting_confirmation']).select('id').maybeSingle()
    if (error) throw new ShippingError(503, '寄件单确认失败。')
    if (!data) throw new ShippingError(409, '寄件单已被其他操作处理，请刷新。')
  } else {
    const { error } = await supabaseAdmin.from('shipping_orders').update({ status: 'ordering', updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw new ShippingError(503, '寄件单重试准备失败。')
  }

  try {
    const provider = await submitShipping({ userId, key: id, input: row.shipment_payload, connection: config.connectionKey, environment: config.environment, store: shippingStore, send: createSfOrder })
    if (provider.status !== 'accepted' || !provider.waybill) {
      await supabaseAdmin.from('shipping_orders').update({ status: 'order_unknown', provider_order_id: provider.id, updated_at: new Date().toISOString() }).eq('id', id)
      return { id, status: 'order_unknown' as const, waybill: null }
    }
    const { error: waybillError } = await supabaseAdmin.from('shipping_waybills').upsert({ shipping_order_id: id, carrier_key: 'sf', waybill_no: provider.waybill, provider_order_id: provider.id, latest_status: 'waybill_created', updated_at: new Date().toISOString() }, { onConflict: 'shipping_order_id' })
    if (waybillError) throw new ShippingError(503, '顺丰已受理，但运单保存失败；请勿重复下单。')
    const { error: orderError } = await supabaseAdmin.from('shipping_orders').update({ status: 'waybill_created', provider_order_id: provider.id, updated_at: new Date().toISOString() }).eq('id', id)
    if (orderError) throw new ShippingError(503, '运单已生成，但寄件单状态保存失败。')
    return { id, status: 'waybill_created' as const, waybill: provider.waybill }
  } catch (error) {
    await supabaseAdmin.from('shipping_orders').update({ status: error instanceof ShippingError && error.requestStage === 'provider_rejected' ? 'order_failed' : 'order_unknown', updated_at: new Date().toISOString() }).eq('id', id)
    throw error
  }
}

export async function reconcileShipmentOrder(id: string) {
  const row = await loadForAction(id)
  if (row.status === 'waybill_created') {
    const { data } = await supabaseAdmin.from('shipping_waybills').select('waybill_no').eq('shipping_order_id', id).maybeSingle()
    return { id, status: 'waybill_created' as const, waybill: data?.waybill_no || null }
  }
  if (row.status !== 'order_unknown' || !row.provider_order_id) throw new ShippingError(409, '当前寄件单没有待查回结果。')
  const waybill = await lookupSfOrder(row.provider_order_id)
  if (!waybill) return { id, status: 'order_unknown' as const, waybill: null }
  const { error: waybillError } = await supabaseAdmin.from('shipping_waybills').upsert({ shipping_order_id: id, carrier_key: 'sf', waybill_no: waybill, provider_order_id: row.provider_order_id, latest_status: 'waybill_created', updated_at: new Date().toISOString() }, { onConflict: 'shipping_order_id' })
  if (waybillError) throw new ShippingError(503, '查回运单后保存失败，请勿重新下单。')
  const { error } = await supabaseAdmin.from('shipping_orders').update({ status: 'waybill_created', updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'order_unknown')
  if (error) throw new ShippingError(503, '查回运单后寄件单更新失败。')
  return { id, status: 'waybill_created' as const, waybill }
}

export async function cancelShipmentOrder(id: string, userId: string) {
  const row = await loadForAction(id)
  if (row.status === 'cancelled') return { id, status: 'cancelled' as const }
  if (row.provider_key !== 'sf') throw new ShippingError(400, '当前承运商尚未配置取消Adapter。')
  if (row.status !== 'waybill_created' || !row.provider_order_id) throw new ShippingError(409, '只有未揽收且已生成运单的订单可以取消。')
  await cancelSfOrder(row.provider_order_id)
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin.from('shipping_orders').update({ status: 'cancelled', confirmed_by: userId, updated_at: now }).eq('id', id).eq('status', 'waybill_created').select('id').maybeSingle()
  if (error) throw new ShippingError(503, '顺丰已受理取消，但本地状态保存失败，请勿重复操作。')
  if (!data) throw new ShippingError(409, '寄件单状态已变化，请刷新后核对。')
  const { error: waybillError } = await supabaseAdmin.from('shipping_waybills').update({ latest_status: 'cancelled', updated_at: now }).eq('shipping_order_id', id)
  if (waybillError) throw new ShippingError(503, '顺丰已取消运单，但物流状态保存失败，请刷新核对。')
  return { id, status: 'cancelled' as const }
}
