import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import { checkShippingPolicy, submitShipping } from './service'
import { shippingStoreForOrg } from './store'
import { getCarrierAdapter } from './carrier-adapter'
import { recordShippingCapability } from './connections'
import { contactSchema } from './validation'
import type { ShippingInput } from './types'

type ProcessRow = {
  id: string
  org_id: string | null
  status: string
  intake_source: string
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

async function loadForAction(id: string, orgId: string): Promise<ProcessRow> {
  if (!orgId?.trim()) throw new ShippingError(403, '当前操作员没有组织寄件权限。')
  const { data, error } = await supabaseAdmin.from('shipping_orders').select('id,org_id,status,intake_source,shipment_payload,provider_key,provider_order_id,carrier_connection_id,billing_account_id,sender_profile_id,connection_environment,billing_account_tail,shipping_config_snapshot').eq('id', id).eq('org_id', orgId).single()
  if (error || !data || data.org_id !== orgId) throw new ShippingError(404, '寄件单不存在。')
  return data as ProcessRow
}

async function orderRuntime(row: ProcessRow, orgId: string, selection?: ConfirmationSelection) {
  const sender = contactSchema.safeParse(row.shipment_payload.sender)
  const rawSender = row.shipment_payload.sender
  const senderMissing = rawSender == null || (typeof rawSender === 'object' && !Array.isArray(rawSender) && Object.values(rawSender).every(value => value == null || (typeof value === 'string' && !value.trim())))
  if (!sender.success && !(row.intake_source === 'owner_web' && senderMissing)) throw new ShippingError(400, '工单寄件人资料不完整或格式无效，请退回补齐。', 'validation')
  const recipient = contactSchema.safeParse(row.shipment_payload.recipient)
  if (!recipient.success) throw new ShippingError(400, '工单收件人资料不完整或格式无效，请退回补齐。', 'validation')
  if (row.billing_account_id && selection?.billingAccountId && row.billing_account_id !== selection.billingAccountId) throw new ShippingError(409, '寄件单已绑定月结账号，请勿更换；如需更换请退回后重新提交。')
  const billingAccountId = row.billing_account_id || selection?.billingAccountId
  if (row.carrier_connection_id && selection?.connectionId && row.carrier_connection_id !== selection.connectionId) throw new ShippingError(409, '寄件单已绑定快递连接，不能在确认时切换。')
  const carrier = await getCarrierAdapter(row.provider_key).connect({ orgId, billingAccountId, connectionId: row.carrier_connection_id || selection?.connectionId, ...(sender.success ? { senderOverride: sender.data } : {}) })
  const connection = carrier.context
  const service = carrier.selectService(row.shipment_payload.servicePreference || 'standard', selection?.serviceId || row.shipment_payload.serviceId)
  const input: ShippingInput = { ...row.shipment_payload, sender: sender.success ? sender.data : connection.sender, recipient: recipient.data, serviceId: service.id, serviceName: service.name }
  checkShippingPolicy(input, connection.services)
  const snapshot = { ...connection.snapshot, senderSource: sender.success ? 'workorder' : 'company_default', serviceId: service.id, serviceName: service.name, servicePreference: service.preference }
  return { orgId, connection, carrier, input, snapshot }
}

export async function returnShipmentOrder(id: string, userId: string, orgId: string, reason: string) {
  await loadForAction(id, orgId)
  const { data, error } = await supabaseAdmin.from('shipping_orders').update({ status: 'returned', returned_reason: reason, confirmed_by: userId, updated_at: new Date().toISOString() }).eq('id', id).eq('org_id', orgId).eq('status', 'awaiting_confirmation').select('id,order_no,status,returned_reason').maybeSingle()
  if (error) throw new ShippingError(503, '寄件单退回失败。')
  if (!data) throw new ShippingError(409, '寄件单状态已变化，请刷新后重试。')
  return data
}

export async function confirmAndSubmitShipment(id: string, userId: string, orgId: string, selection?: ConfirmationSelection) {
  const row = await loadForAction(id, orgId)
  getCarrierAdapter(row.provider_key)
  if (!['accepted', 'awaiting_confirmation', 'confirmed', 'order_unknown'].includes(row.status)) throw new ShippingError(409, '当前寄件单不能确认下单。')
  if (row.status === 'order_unknown') return reconcileShipmentOrder(id, orgId)
  const { connection, carrier, input, snapshot } = await orderRuntime(row, orgId, selection)

  if (row.status === 'accepted' || row.status === 'awaiting_confirmation') {
    const { data, error } = await supabaseAdmin.from('shipping_orders').update({
      status: 'ordering', shipment_payload: input, carrier_connection_id: connection.connectionId,
      billing_account_id: connection.billingAccountId, sender_profile_id: connection.senderProfileId,
      connection_environment: connection.environment, billing_account_tail: connection.billingAccountTail,
      shipping_config_snapshot: snapshot, confirmed_by: userId, confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }).eq('id', id).eq('org_id', orgId).in('status', ['accepted', 'awaiting_confirmation']).select('id').maybeSingle()
    if (error) throw new ShippingError(503, '寄件单确认失败。')
    if (!data) throw new ShippingError(409, '寄件单已被其他操作处理，请刷新。')
  } else {
    const { data, error } = await supabaseAdmin.from('shipping_orders').update({
      status: 'ordering', shipment_payload: input, carrier_connection_id: connection.connectionId,
      billing_account_id: connection.billingAccountId, sender_profile_id: connection.senderProfileId,
      connection_environment: connection.environment, billing_account_tail: connection.billingAccountTail,
      shipping_config_snapshot: snapshot, updated_at: new Date().toISOString()
    }).eq('id', id).eq('org_id', orgId).eq('status', 'confirmed').select('id').maybeSingle()
    if (error) throw new ShippingError(503, '寄件单重试准备失败。')
    if (!data) throw new ShippingError(409, '寄件单已被其他操作处理，请刷新。')
  }

  try {
    const provider = await submitShipping({ userId, key: id, input, connection: connection.connectionKey, environment: connection.environment, runtimeConfig: connection, store: shippingStoreForOrg(orgId), send: carrier.create })
    if (provider.status !== 'accepted' || !provider.waybill) {
      await supabaseAdmin.from('shipping_orders').update({ status: 'order_unknown', provider_order_id: provider.id, updated_at: new Date().toISOString() }).eq('id', id).eq('org_id', orgId)
      return { id, status: 'order_unknown' as const, waybill: null }
    }
    const { error: waybillError } = await supabaseAdmin.from('shipping_waybills').upsert({ shipping_order_id: id, carrier_key: carrier.key, waybill_no: provider.waybill, provider_order_id: provider.id, latest_status: 'waybill_created', updated_at: new Date().toISOString() }, { onConflict: 'shipping_order_id' })
    if (waybillError) throw new ShippingError(503, '承运商已受理，但运单保存失败；请勿重复下单。')
    const { error: orderError } = await supabaseAdmin.from('shipping_orders').update({ status: 'waybill_created', provider_order_id: provider.id, updated_at: new Date().toISOString() }).eq('id', id).eq('org_id', orgId)
    if (orderError) throw new ShippingError(503, '运单已生成，但寄件单状态保存失败。')
    try { await recordShippingCapability(orgId, connection.connectionId, 'order') }
    catch { console.error('shipping.capability.record_failed', { capability: 'order' }) }
    return { id, status: 'waybill_created' as const, waybill: provider.waybill }
  } catch (error) {
    await supabaseAdmin.from('shipping_orders').update({ status: error instanceof ShippingError && error.requestStage === 'provider_rejected' ? 'order_failed' : 'order_unknown', updated_at: new Date().toISOString() }).eq('id', id).eq('org_id', orgId)
    throw error
  }
}

export async function reconcileShipmentOrder(id: string, orgId: string) {
  const row = await loadForAction(id, orgId)
  if (row.status === 'waybill_created') {
    const { data } = await supabaseAdmin.from('shipping_waybills').select('waybill_no').eq('shipping_order_id', id).maybeSingle()
    return { id, status: 'waybill_created' as const, waybill: data?.waybill_no || null }
  }
  if (row.status !== 'order_unknown' || !row.provider_order_id || !row.org_id || !row.carrier_connection_id || !row.billing_account_id) throw new ShippingError(409, '当前寄件单没有可查回的配置快照。')
  const carrier = await getCarrierAdapter(row.provider_key).connect({ expectedEnvironment: row.connection_environment, orgId: row.org_id, billingAccountId: row.billing_account_id, connectionId: row.carrier_connection_id, allowHistorical: true, requireOrderCapability: false })
  const connection = carrier.context
  const waybill = await carrier.lookup(row.provider_order_id)
  try { await recordShippingCapability(row.org_id, connection.connectionId, 'query') }
  catch { console.error('shipping.capability.record_failed', { capability: 'query' }) }
  if (!waybill) return { id, status: 'order_unknown' as const, waybill: null }
  const { error: waybillError } = await supabaseAdmin.from('shipping_waybills').upsert({ shipping_order_id: id, carrier_key: carrier.key, waybill_no: waybill, provider_order_id: row.provider_order_id, latest_status: 'waybill_created', updated_at: new Date().toISOString() }, { onConflict: 'shipping_order_id' })
  if (waybillError) throw new ShippingError(503, '查回运单后保存失败，请勿重新下单。')
  const { error } = await supabaseAdmin.from('shipping_orders').update({ status: 'waybill_created', updated_at: new Date().toISOString() }).eq('id', id).eq('org_id', orgId).eq('status', 'order_unknown')
  if (error) throw new ShippingError(503, '查回运单后寄件单更新失败。')
  try { await recordShippingCapability(row.org_id, connection.connectionId, 'order') }
  catch { console.error('shipping.capability.record_failed', { capability: 'order' }) }
  return { id, status: 'waybill_created' as const, waybill }
}

export async function cancelShipmentOrder(id: string, userId: string, orgId: string) {
  const row = await loadForAction(id, orgId)
  if (row.status === 'cancelled') return { id, status: 'cancelled' as const }
  getCarrierAdapter(row.provider_key)
  if (row.status !== 'waybill_created' || !row.provider_order_id) throw new ShippingError(409, '只有未揽收且已生成运单的订单可以取消。')
  if (!row.org_id || !row.carrier_connection_id || !row.billing_account_id) throw new ShippingError(409, '历史订单缺少快递连接快照，无法安全取消。')
  const carrier = await getCarrierAdapter(row.provider_key).connect({ expectedEnvironment: row.connection_environment, orgId: row.org_id, billingAccountId: row.billing_account_id, connectionId: row.carrier_connection_id, allowHistorical: true, requireOrderCapability: false })
  const connection = carrier.context
  await carrier.cancel(row.provider_order_id)
  const now = new Date().toISOString()
  // The carrier has accepted this request. Tracking may have advanced during that call;
  // persist the confirmed cancellation without overwriting a delivered order.
  const { data, error } = await supabaseAdmin.from('shipping_orders').update({ status: 'cancelled', confirmed_by: userId, updated_at: now }).eq('id', id).eq('org_id', orgId).in('status', ['waybill_created', 'in_transit']).select('id').maybeSingle()
  if (error) throw new ShippingError(503, '承运商已受理取消，但本地状态保存失败，请勿重复操作。')
  if (!data) {
    const current = await loadForAction(id, orgId)
    if (current.status === 'cancelled') return { id, status: 'cancelled' as const }
    throw new ShippingError(409, '承运商已受理取消，但寄件单状态已变化，请刷新后核对。')
  }
  const { error: waybillError } = await supabaseAdmin.from('shipping_waybills').update({ latest_status: 'cancelled', updated_at: now }).eq('shipping_order_id', id)
  if (waybillError) throw new ShippingError(503, '承运商已取消运单，但物流状态保存失败，请刷新核对。')
  try { await recordShippingCapability(row.org_id, connection.connectionId, 'cancel') }
  catch { console.error('shipping.capability.record_failed', { capability: 'cancel' }) }
  return { id, status: 'cancelled' as const }
}
