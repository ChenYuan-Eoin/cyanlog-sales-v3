import { supabaseAdmin } from '@/lib/supabase'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { ShippingError } from './config'
import { checkShippingPolicy, submitShipping } from './service'
import { shippingStore } from './store'
import { cancelSfOrder, createSfOrder, lookupSfOrder } from './sf-client'
import { getShippingRuntimeConfig, selectAuthorizedShippingService } from './runtime-config'
import { recordShippingCapability } from './connections'
import type { ShippingInput } from './types'

type ProcessRow = {
  id: string
  org_id: string | null
  status: string
  shipment_payload: ShippingInput
  provider_key: string
  provider_order_id: string | null
  carrier_connection_id: string | null
  billing_account_id: string | null
  sender_profile_id: string | null
  connection_environment: 'sandbox' | 'production' | null
  billing_account_tail: string | null
  shipping_config_snapshot: Record<string, unknown> | null
}
type ConfirmationSelection = { connectionId?: string; billingAccountId?: string; serviceId?: number }

async function loadForAction(id: string): Promise<ProcessRow> {
  const { data, error } = await supabaseAdmin.from('shipping_orders').select('id,org_id,status,shipment_payload,provider_key,provider_order_id,carrier_connection_id,billing_account_id,sender_profile_id,connection_environment,billing_account_tail,shipping_config_snapshot').eq('id', id).single()
  if (error || !data) throw new ShippingError(404, '寄件单不存在。')
  return data as ProcessRow
}

async function orderRuntime(row: ProcessRow, userId: string, selection?: ConfirmationSelection) {
  const orgId = row.org_id || await getDefaultOrgId(userId)
  if (!orgId) throw new ShippingError(403, '当前操作员没有组织寄件配置。')
  if (row.billing_account_id && selection?.billingAccountId && row.billing_account_id !== selection.billingAccountId) throw new ShippingError(409, '寄件单已绑定月结账号，请勿更换；如需更换请退回后重新提交。')
  const billingAccountId = row.billing_account_id || selection?.billingAccountId
  if (row.carrier_connection_id && selection?.connectionId && row.carrier_connection_id !== selection.connectionId) throw new ShippingError(409, '寄件单已绑定快递连接，不能在确认时切换。')
  const connection = await getShippingRuntimeConfig({ orgId, billingAccountId, connectionId: row.carrier_connection_id || selection?.connectionId })
  const service = selectAuthorizedShippingService(connection.services, row.shipment_payload.servicePreference || 'standard', selection?.serviceId || row.shipment_payload.serviceId)
  const input: ShippingInput = { ...row.shipment_payload, sender: connection.sender, serviceId: service.id, serviceName: service.name }
  checkShippingPolicy(input, connection.services)
  const snapshot = { ...connection.snapshot, serviceId: service.id, serviceName: service.name, servicePreference: service.preference }
  return { orgId, connection, input, snapshot }
}

export async function returnShipmentOrder(id: string, userId: string, reason: string) {
  const { data, error } = await supabaseAdmin.from('shipping_orders').update({ status: 'returned', returned_reason: reason, confirmed_by: userId, updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'awaiting_confirmation').select('id,order_no,status,returned_reason').maybeSingle()
  if (error) throw new ShippingError(503, '寄件单退回失败。')
  if (!data) throw new ShippingError(409, '寄件单状态已变化，请刷新后重试。')
  return data
}

export async function confirmAndSubmitShipment(id: string, userId: string, selection?: ConfirmationSelection) {
  const row = await loadForAction(id)
  if (row.provider_key !== 'sf') throw new ShippingError(400, '当前承运商尚未配置下单Adapter。')
  if (!['accepted', 'awaiting_confirmation', 'confirmed', 'order_unknown'].includes(row.status)) throw new ShippingError(409, '当前寄件单不能确认下单。')
  if (row.status === 'order_unknown') return reconcileShipmentOrder(id)
  const { orgId, connection, input, snapshot } = await orderRuntime(row, userId, selection)

  if (row.status === 'accepted' || row.status === 'awaiting_confirmation') {
    const { data, error } = await supabaseAdmin.from('shipping_orders').update({
      status: 'ordering', org_id: orgId, shipment_payload: input, carrier_connection_id: connection.connectionId,
      billing_account_id: connection.billingAccountId, sender_profile_id: connection.senderProfileId,
      connection_environment: connection.environment, billing_account_tail: connection.billingAccountTail,
      shipping_config_snapshot: snapshot, confirmed_by: userId, confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }).eq('id', id).in('status', ['accepted', 'awaiting_confirmation']).select('id').maybeSingle()
    if (error) throw new ShippingError(503, '寄件单确认失败。')
    if (!data) throw new ShippingError(409, '寄件单已被其他操作处理，请刷新。')
  } else {
    const { error } = await supabaseAdmin.from('shipping_orders').update({
      status: 'ordering', org_id: orgId, shipment_payload: input, carrier_connection_id: connection.connectionId,
      billing_account_id: connection.billingAccountId, sender_profile_id: connection.senderProfileId,
      connection_environment: connection.environment, billing_account_tail: connection.billingAccountTail,
      shipping_config_snapshot: snapshot, updated_at: new Date().toISOString()
    }).eq('id', id).eq('status', 'confirmed')
    if (error) throw new ShippingError(503, '寄件单重试准备失败。')
  }

  try {
    const provider = await submitShipping({ userId, key: id, input, connection: connection.connectionKey, environment: connection.environment, runtimeConfig: connection, store: shippingStore, send: (requestId, frozenInput) => createSfOrder(requestId, frozenInput, connection) })
    if (provider.status !== 'accepted' || !provider.waybill) {
      await supabaseAdmin.from('shipping_orders').update({ status: 'order_unknown', provider_order_id: provider.id, updated_at: new Date().toISOString() }).eq('id', id)
      return { id, status: 'order_unknown' as const, waybill: null }
    }
    const { error: waybillError } = await supabaseAdmin.from('shipping_waybills').upsert({ shipping_order_id: id, carrier_key: 'sf', waybill_no: provider.waybill, provider_order_id: provider.id, latest_status: 'waybill_created', updated_at: new Date().toISOString() }, { onConflict: 'shipping_order_id' })
    if (waybillError) throw new ShippingError(503, '顺丰已受理，但运单保存失败；请勿重复下单。')
    const { error: orderError } = await supabaseAdmin.from('shipping_orders').update({ status: 'waybill_created', provider_order_id: provider.id, updated_at: new Date().toISOString() }).eq('id', id)
    if (orderError) throw new ShippingError(503, '运单已生成，但寄件单状态保存失败。')
    try { await recordShippingCapability(orgId, connection.connectionId, 'order') }
    catch { console.error('shipping.capability.record_failed', { capability: 'order' }) }
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
  if (row.status !== 'order_unknown' || !row.provider_order_id || !row.org_id || !row.carrier_connection_id || !row.billing_account_id) throw new ShippingError(409, '当前寄件单没有可查回的配置快照。')
  const connection = await getShippingRuntimeConfig({ orgId: row.org_id, billingAccountId: row.billing_account_id, connectionId: row.carrier_connection_id, allowHistorical: true, requireOrderCapability: false })
  const waybill = await lookupSfOrder(row.provider_order_id, connection)
  try { await recordShippingCapability(row.org_id, connection.connectionId, 'query') }
  catch { console.error('shipping.capability.record_failed', { capability: 'query' }) }
  if (!waybill) return { id, status: 'order_unknown' as const, waybill: null }
  const { error: waybillError } = await supabaseAdmin.from('shipping_waybills').upsert({ shipping_order_id: id, carrier_key: 'sf', waybill_no: waybill, provider_order_id: row.provider_order_id, latest_status: 'waybill_created', updated_at: new Date().toISOString() }, { onConflict: 'shipping_order_id' })
  if (waybillError) throw new ShippingError(503, '查回运单后保存失败，请勿重新下单。')
  const { error } = await supabaseAdmin.from('shipping_orders').update({ status: 'waybill_created', updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'order_unknown')
  if (error) throw new ShippingError(503, '查回运单后寄件单更新失败。')
  try { await recordShippingCapability(row.org_id, connection.connectionId, 'order') }
  catch { console.error('shipping.capability.record_failed', { capability: 'order' }) }
  return { id, status: 'waybill_created' as const, waybill }
}

export async function cancelShipmentOrder(id: string, userId: string) {
  const row = await loadForAction(id)
  if (row.status === 'cancelled') return { id, status: 'cancelled' as const }
  if (row.provider_key !== 'sf') throw new ShippingError(400, '当前承运商尚未配置取消Adapter。')
  if (row.status !== 'waybill_created' || !row.provider_order_id) throw new ShippingError(409, '只有未揽收且已生成运单的订单可以取消。')
  if (!row.org_id || !row.carrier_connection_id || !row.billing_account_id) throw new ShippingError(409, '历史订单缺少快递连接快照，无法安全取消。')
  const connection = await getShippingRuntimeConfig({ orgId: row.org_id, billingAccountId: row.billing_account_id, connectionId: row.carrier_connection_id, allowHistorical: true, requireOrderCapability: false })
  await cancelSfOrder(row.provider_order_id, connection)
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin.from('shipping_orders').update({ status: 'cancelled', confirmed_by: userId, updated_at: now }).eq('id', id).eq('status', 'waybill_created').select('id').maybeSingle()
  if (error) throw new ShippingError(503, '顺丰已受理取消，但本地状态保存失败，请勿重复操作。')
  if (!data) throw new ShippingError(409, '寄件单状态已变化，请刷新后核对。')
  const { error: waybillError } = await supabaseAdmin.from('shipping_waybills').update({ latest_status: 'cancelled', updated_at: now }).eq('shipping_order_id', id)
  if (waybillError) throw new ShippingError(503, '顺丰已取消运单，但物流状态保存失败，请刷新核对。')
  try { await recordShippingCapability(row.org_id, connection.connectionId, 'cancel') }
  catch { console.error('shipping.capability.record_failed', { capability: 'cancel' }) }
  return { id, status: 'cancelled' as const }
}
