import { createHash, createHmac, randomBytes } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import { resolveBusinessContext, verifyShipmentContext } from './context'
import type { ShipmentOrder, ShipmentOrderStatus, ShipmentReceipt, ShippingInput } from './types'

const select = 'id,order_no,intake_source,confirmation_policy,status,sales_ref,customer_ref,assignment_status,shipment_payload,payload_hash,next_review_at,created_at,org_id,carrier_connection_id,billing_account_id,sender_profile_id,connection_environment,billing_account_tail,shipping_config_snapshot,shipping_waybills(waybill_no)'
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
type ShipmentRow = {
  id: string
  order_no: string
  intake_source: ShipmentOrder['intakeSource']
  confirmation_policy: ShipmentOrder['confirmationPolicy']
  status: ShipmentOrderStatus
  sales_ref: string | null
  customer_ref: string | null
  assignment_status: 'assigned' | 'unassigned'
  shipment_payload: ShippingInput
  payload_hash: string
  next_review_at: string | null
  created_at: string
  org_id?: string | null
  carrier_connection_id?: string | null
  billing_account_id?: string | null
  sender_profile_id?: string | null
  connection_environment?: 'sandbox' | 'production' | null
  billing_account_tail?: string | null
  shipping_config_snapshot?: Record<string, unknown> | null
  shipping_waybills?: { waybill_no: string }[] | { waybill_no: string } | null
}
function receiptFor(key: string, env: Record<string, string | undefined> = process.env) {
  const secret = env.SHIPPING_RECEIPT_SECRET
  if (!secret || secret.length < 32) throw new ShippingError(503, '匿名寄件回执尚未配置。')
  return createHmac('sha256', secret).update(`shipment:${key}`).digest('base64url')
}

export function nextShippingReviewAt(now = new Date()) {
  const shanghai = new Date(now.getTime() + 8 * 60 * 60 * 1000), hour = shanghai.getUTCHours()
  if (hour < 11) shanghai.setUTCHours(11, 0, 0, 0)
  else if (hour < 17) shanghai.setUTCHours(17, 0, 0, 0)
  else { shanghai.setUTCDate(shanghai.getUTCDate() + 1); shanghai.setUTCHours(11, 0, 0, 0) }
  return new Date(shanghai.getTime() - 8 * 60 * 60 * 1000).toISOString()
}

function orderNo(now = new Date()) {
  const ymd = now.toISOString().slice(0, 10).replaceAll('-', '')
  return `SO-${ymd}-${randomBytes(5).toString('hex').slice(0, 8).toUpperCase()}`
}

function map(row: ShipmentRow): ShipmentOrder {
  const waybillRows = Array.isArray(row.shipping_waybills) ? row.shipping_waybills : row.shipping_waybills ? [row.shipping_waybills] : []
  return { id: row.id, orderNo: row.order_no, intakeSource: row.intake_source, confirmationPolicy: row.confirmation_policy, status: row.status, relation: { salesRef: row.sales_ref, customerRef: row.customer_ref, assignmentStatus: row.assignment_status }, input: row.shipment_payload, waybill: waybillRows[0]?.waybill_no || null, nextReviewAt: row.next_review_at, createdAt: row.created_at }
}

export function publicShipmentReceipt(order: ShipmentOrder): ShipmentReceipt {
  return { orderNo: order.orderNo, status: order.status, waybill: order.waybill, nextReviewAt: order.nextReviewAt, createdAt: order.createdAt }
}

export async function createAnonymousShipment(args: { key: string; rawInput?: string; input: ShippingInput; contextToken?: string; businessCode?: string }) {
  const signed = args.contextToken ? verifyShipmentContext(args.contextToken) : null
  if (args.contextToken && !signed) throw new ShippingError(400, '寄件链接无效或已过期，请联系业务人员重新获取。')
  const relation = signed || resolveBusinessContext(args.businessCode)
  const receiptToken = receiptFor(args.key)
  const payloadHash = hash(JSON.stringify(args.input))
  const row = { order_no: orderNo(), created_by: null, intake_source: 'anonymous_web', confirmation_policy: 'scheduled_review', status: 'awaiting_confirmation', sales_ref: relation?.salesRef || args.input.submittedBy?.name || null, customer_ref: relation?.customerRef || args.input.customerName || null, assignment_status: relation ? 'assigned' : 'unassigned', raw_input: args.rawInput || null, shipment_payload: args.input, payload_hash: payloadHash, idempotency_key: args.key, receipt_token_hash: hash(receiptToken), next_review_at: nextShippingReviewAt() }
  let result = await supabaseAdmin.from('shipping_orders').insert(row).select(select).single()
  if (result.error?.code === '23505') result = await supabaseAdmin.from('shipping_orders').select(select).eq('intake_source', 'anonymous_web').eq('idempotency_key', args.key).single()
  if (result.error || !result.data) throw new ShippingError(503, '寄件单暂未保存，请稍后重试。')
  if ((result.data as ShipmentRow).payload_hash !== payloadHash) throw new ShippingError(409, '同一寄件请求的内容发生变化，请打开原回执确认。')
  const order = map(result.data as ShipmentRow)
  return { order, receiptToken }
}

export async function createOwnerShipment(args: { userId: string; key: string; input: ShippingInput; snapshot: { orgId: string; connectionId: string; billingAccountId: string; senderProfileId: string; environment: 'sandbox' | 'production'; billingAccountTail: string; serviceId: number; serviceName: string } }) {
  const receiptToken = receiptFor(args.key)
  const { snapshot } = args
  const shippingConfigSnapshot = { carrier: 'sf', connectionId: snapshot.connectionId, environment: snapshot.environment, billingAccountId: snapshot.billingAccountId, billingAccountTail: snapshot.billingAccountTail, senderProfileId: snapshot.senderProfileId, serviceId: snapshot.serviceId, serviceName: snapshot.serviceName }
  const payloadHash = hash(JSON.stringify({ input: args.input, shippingConfigSnapshot }))
  const row = { order_no: orderNo(), org_id: snapshot.orgId, carrier_connection_id: snapshot.connectionId, billing_account_id: snapshot.billingAccountId, sender_profile_id: snapshot.senderProfileId, connection_environment: snapshot.environment, billing_account_tail: snapshot.billingAccountTail, shipping_config_snapshot: shippingConfigSnapshot, created_by: args.userId, intake_source: 'owner_web', confirmation_policy: 'direct', status: 'accepted', sales_ref: null, customer_ref: null, assignment_status: 'unassigned', raw_input: null, shipment_payload: args.input, payload_hash: payloadHash, idempotency_key: args.key, receipt_token_hash: hash(receiptToken), next_review_at: null }
  let result = await supabaseAdmin.from('shipping_orders').insert(row).select(select).single()
  if (result.error?.code === '23505') result = await supabaseAdmin.from('shipping_orders').select(select).eq('intake_source', 'owner_web').eq('idempotency_key', args.key).single()
  if (result.error || !result.data) throw new ShippingError(503, '本人寄件单暂未保存，请稍后重试。')
  if ((result.data as ShipmentRow).payload_hash !== payloadHash) throw new ShippingError(409, '同一寄件请求的内容发生变化，请打开原寄件单确认。')
  return map(result.data as ShipmentRow)
}

export async function getShipmentByReceipt(token: string) {
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) return null
  const { data, error } = await supabaseAdmin.from('shipping_orders').select(select).eq('receipt_token_hash', hash(token)).maybeSingle()
  if (error) throw new ShippingError(503, '寄件状态暂不可用。')
  return data ? map(data as ShipmentRow) : null
}

export async function listShipmentLedger(filters: { salesRef?: string; customerRef?: string; contact?: string; status?: ShipmentOrderStatus; cursor?: string; limit: number }) {
  let query = supabaseAdmin.from('shipping_orders').select(select).order('created_at', { ascending: false }).limit(filters.limit)
  if (filters.salesRef) query = query.eq('sales_ref', filters.salesRef)
  if (filters.customerRef) query = query.eq('customer_ref', filters.customerRef)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.cursor) query = query.lt('created_at', filters.cursor)
  if (filters.contact) { const term = filters.contact.replace(/[%_,]/g, ''); query = query.or(`shipment_payload->sender->>name.ilike.%${term}%,shipment_payload->sender->>phone.ilike.%${term}%,shipment_payload->recipient->>name.ilike.%${term}%,shipment_payload->recipient->>phone.ilike.%${term}%`) }
  const { data, error } = await query
  if (error) throw new ShippingError(503, '收寄件台账暂不可用。')
  return (data || []).map(row => map(row as ShipmentRow))
}

export async function assignShipmentRelation(id: string, salesRef: string, customerRef?: string) {
  const { data, error } = await supabaseAdmin.from('shipping_orders').update({ sales_ref: salesRef, customer_ref: customerRef || null, assignment_status: 'assigned', updated_at: new Date().toISOString() }).eq('id', id).in('status', ['accepted', 'awaiting_confirmation', 'returned']).select(select).maybeSingle()
  if (error) throw new ShippingError(503, '销售和客户关系保存失败。')
  if (!data) throw new ShippingError(409, '寄件单已经进入下单流程，不能重新分配。')
  return map(data as ShipmentRow)
}

export async function createDueShipmentReviewReminders(now = new Date(), env: Record<string, string | undefined> = process.env) {
  const ownerIds = (env.SHIPPING_ALLOWED_USER_IDS || '').split(',').map(value => value.trim()).filter(Boolean)
  if (!ownerIds.length) return { orders: 0, reminders: 0 }
  const notifiedAt = now.toISOString()
  const { data: orders, error } = await supabaseAdmin.from('shipping_orders').update({ review_notified_at: notifiedAt, updated_at: notifiedAt }).eq('status', 'awaiting_confirmation').lte('next_review_at', notifiedAt).is('review_notified_at', null).select('id,order_no')
  if (error) throw new ShippingError(503, '待核对寄件单汇总失败。')
  if (!orders?.length) return { orders: 0, reminders: 0 }
  const { data: users, error: usersError } = await supabaseAdmin.from('users').select('id,org_id').in('id', ownerIds).eq('status', 'active')
  if (usersError || !users?.length) throw new ShippingError(503, '寄件核对人配置无效。')
  const title = `有 ${orders.length} 个寄件单待核对`
  const description = `寄件单：${orders.slice(0, 5).map(order => order.order_no).join('、')}${orders.length > 5 ? ' 等' : ''}`
  const { error: reminderError } = await supabaseAdmin.from('reminders').insert(users.map(user => ({ org_id: user.org_id, user_id: user.id, type: 'APPROVAL', title, description, link_type: 'SHIPPING', priority: 'HIGH', due_at: notifiedAt })))
  if (reminderError) {
    await supabaseAdmin.from('shipping_orders').update({ review_notified_at: null }).in('id', orders.map(order => order.id)).eq('review_notified_at', notifiedAt)
    throw new ShippingError(503, '寄件核对提醒生成失败。')
  }
  return { orders: orders.length, reminders: users.length }
}

export async function getOwnedShipmentProviderSnapshot(userId: string, waybill: string) {
  const { data: waybillRow, error: waybillError } = await supabaseAdmin.from('shipping_waybills').select('shipping_order_id').eq('carrier_key', 'sf').eq('waybill_no', waybill).maybeSingle()
  if (waybillError) throw new ShippingError(503, '运单归属核对暂不可用。')
  if (!waybillRow) return null
  const { data, error } = await supabaseAdmin.from('shipping_orders')
    .select('org_id,carrier_connection_id,billing_account_id')
    .eq('id', waybillRow.shipping_order_id).eq('created_by', userId).maybeSingle()
  if (error) throw new ShippingError(503, '运单配置快照读取失败。')
  return data || null
}
