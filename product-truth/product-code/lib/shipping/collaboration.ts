import { createHash, createHmac, randomBytes } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import { resolveBusinessContext, verifyShipmentContext } from './context'
import { listShippingOperatorRecipients } from './operator-access'
import type { Contact, ShipmentOrder, ShipmentOrderStatus, ShipmentReceipt, ShippingInput } from './types'

const select = 'id,employee_profile_id,order_no,intake_source,confirmation_policy,status,sales_ref,customer_ref,assignment_status,shipment_payload,payload_hash,revision,amended_at,next_review_at,created_at,org_id,carrier_connection_id,billing_account_id,sender_profile_id,connection_environment,billing_account_tail,shipping_config_snapshot,shipping_waybills(waybill_no)'
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
  revision?: number | null
  amended_at?: string | null
  next_review_at: string | null
  created_at: string
  employee_profile_id?: string | null
  org_id?: string | null
  carrier_connection_id?: string | null
  billing_account_id?: string | null
  sender_profile_id?: string | null
  connection_environment?: 'sandbox' | 'production' | null
  billing_account_tail?: string | null
  shipping_config_snapshot?: Record<string, unknown> | null
  shipping_waybills?: { waybill_no: string }[] | { waybill_no: string } | null
}
export function createShipmentReceiptToken(key: string, env: Record<string, string | undefined> = process.env) {
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

export function newShippingOrderNo(now = new Date()) {
  const ymd = now.toISOString().slice(0, 10).replaceAll('-', '')
  return `SO-${ymd}-${randomBytes(5).toString('hex').slice(0, 8).toUpperCase()}`
}

function map(row: ShipmentRow): ShipmentOrder {
  const waybillRows = Array.isArray(row.shipping_waybills) ? row.shipping_waybills : row.shipping_waybills ? [row.shipping_waybills] : []
  const failure = row.shipping_config_snapshot?.orderFailure as { message?: unknown; at?: unknown } | undefined
  return { ...(failure && typeof failure.message === 'string' && typeof failure.at === 'string' ? { failure: { message: failure.message.slice(0, 500), at: failure.at } } : {}), id: row.id, identityVerified: Boolean(row.employee_profile_id), orderNo: row.order_no, intakeSource: row.intake_source, confirmationPolicy: row.confirmation_policy, status: row.status, relation: { salesRef: row.sales_ref, customerRef: row.customer_ref, assignmentStatus: row.assignment_status }, input: row.shipment_payload, waybill: waybillRows[0]?.waybill_no || null, revision: row.revision ?? 1, amendedAt: row.amended_at ?? null, nextReviewAt: row.next_review_at, createdAt: row.created_at }
}

export function publicShipmentReceipt(order: ShipmentOrder): ShipmentReceipt {
  return { orderNo: order.orderNo, status: order.status, waybill: order.waybill, nextReviewAt: order.nextReviewAt, createdAt: order.createdAt }
}

export async function createAnonymousShipment(args: { orgId: string; key: string; rawInput?: string; input: ShippingInput; contextToken?: string; businessCode?: string; employee?: { id: string; identity?: { provider: 'wecom'; userId: string; corpId?: string; botConnectionId?: string; phoneSource: 'wecom' | 'preset' }; sender?: Contact; team?: string } }) {
  requireOrganization(args.orgId)
  const signed = args.contextToken ? verifyShipmentContext(args.contextToken) : null
  if (args.contextToken && !signed) throw new ShippingError(400, '寄件链接无效或已过期，请联系业务人员重新获取。')
  const relation = signed || resolveBusinessContext(args.businessCode)
  const digest = args.employee ? hash(JSON.stringify(['employee-workorder-v1', args.orgId, args.employee.id, args.key])) : null
  const key = digest ? `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}` : args.key
  const receiptToken = createShipmentReceiptToken(key)
  const payloadHash = hash(JSON.stringify({ ...args.input, serviceName: undefined }))
  if (args.employee) {
    const prior = await supabaseAdmin.from('shipping_orders').select(select).eq('org_id', args.orgId).eq('employee_profile_id', args.employee.id).eq('intake_source', 'anonymous_web').eq('idempotency_key', key).maybeSingle()
    if (prior.error) throw new ShippingError(503, '原工单暂时无法核对，请稍后重试。')
    if (prior.data) {
      if ((prior.data as ShipmentRow).payload_hash !== payloadHash) throw new ShippingError(409, '同一寄件请求的内容发生变化，请核对原工单。')
      return { order: map(prior.data as ShipmentRow), receiptToken }
    }
    if (args.employee.sender) {
    const senderMatches = (Object.keys(args.employee.sender) as (keyof Contact)[]).every(field => args.input.sender[field] === args.employee!.sender![field])
    if (!senderMatches || args.input.submittedBy?.name !== args.employee.sender.name || args.input.submittedBy?.phone !== args.employee.sender.phone || args.input.submittedBy?.team !== args.employee.team) throw new ShippingError(409, '个人寄件资料已变化，请刷新资料后重新预览。')
    }
  }
  const row = { order_no: newShippingOrderNo(), org_id: args.orgId, created_by: null, employee_profile_id: args.employee?.id || null, identity_snapshot: args.employee?.identity || {}, intake_source: 'anonymous_web', confirmation_policy: 'scheduled_review', status: 'awaiting_confirmation', sales_ref: relation?.salesRef || args.input.submittedBy?.name || null, customer_ref: relation?.customerRef || args.input.customerName || null, assignment_status: relation ? 'assigned' : 'unassigned', raw_input: args.rawInput || null, shipment_payload: args.input, payload_hash: payloadHash, idempotency_key: key, receipt_token_hash: hash(receiptToken), next_review_at: nextShippingReviewAt() }
  let result = await supabaseAdmin.from('shipping_orders').insert(row).select(select).single()
  if (result.error?.code === '23505') {
    result = await supabaseAdmin.from('shipping_orders').select(select).eq('org_id', args.orgId).eq('intake_source', 'anonymous_web').eq('idempotency_key', key).single()
    if (!result.data) throw new ShippingError(409, '寄件请求编号已被使用，请保留原回执并使用新的请求编号。')
  }
  if (result.error || !result.data) throw new ShippingError(503, '寄件单暂未保存，请稍后重试。')
  if ((result.data as ShipmentRow).payload_hash !== payloadHash) throw new ShippingError(409, '同一寄件请求的内容发生变化，请打开原回执确认。')
  const order = map(result.data as ShipmentRow)
  return { order, receiptToken }
}

export async function createOwnerShipment(args: { orgId: string; userId: string; key: string; input: ShippingInput; usesDefaultSender?: boolean }) {
  const receiptToken = createShipmentReceiptToken(args.key)
  requireOrganization(args.orgId)
  // Derived defaults may change after a lost response. The same original input
  // must still retrieve its first work order and sender snapshot without dispatch.
  const payloadHash = hash(JSON.stringify({ ...args.input, sender: args.usesDefaultSender ? null : args.input.sender }))
  const row = { order_no: newShippingOrderNo(), org_id: args.orgId, carrier_connection_id: null, billing_account_id: null, sender_profile_id: null, connection_environment: null, billing_account_tail: null, shipping_config_snapshot: {}, created_by: args.userId, intake_source: 'owner_web', confirmation_policy: 'scheduled_review', status: 'awaiting_confirmation', sales_ref: null, customer_ref: null, assignment_status: 'unassigned', raw_input: null, shipment_payload: args.input, payload_hash: payloadHash, idempotency_key: args.key, receipt_token_hash: hash(receiptToken), next_review_at: nextShippingReviewAt() }
  let result = await supabaseAdmin.from('shipping_orders').insert(row).select(select).single()
  if (result.error?.code === '23505') {
    result = await supabaseAdmin.from('shipping_orders').select(select).eq('org_id', args.orgId).eq('created_by', args.userId).eq('intake_source', 'owner_web').eq('idempotency_key', args.key).single()
    if (!result.data) throw new ShippingError(409, '寄件请求编号已被使用，请从当前组织的原寄件单核对。')
  }
  if (result.error || !result.data) throw new ShippingError(503, '本人寄件单暂未保存，请稍后重试。')
  if ((result.data as ShipmentRow).payload_hash !== payloadHash) throw new ShippingError(409, '同一寄件请求的内容发生变化，请打开原寄件单确认。')
  return map(result.data as ShipmentRow)
}

export async function amendShipmentOrder(args: {
  orgId: string
  userId: string
  orderId: string
  expectedRevision: number
  input: ShippingInput
  reason: string
}) {
  requireOrganization(args.orgId)
  const payloadHash = hash(JSON.stringify(args.input))
  const { data: amended, error } = await supabaseAdmin.rpc('amend_shipping_order_v1', {
    p_actor_id: args.userId,
    p_org_id: args.orgId,
    p_order_id: args.orderId,
    p_expected_revision: args.expectedRevision,
    p_shipment_payload: args.input,
    p_payload_hash: payloadHash,
    p_reason: args.reason,
  })
  if (error) {
    if (String(error.code || '') === '40001') {
      throw new ShippingError(409, '工单已被其他操作员修改，请刷新后重试。')
    }
    if (String(error.code || '') === '23514') {
      throw new ShippingError(409, '工单已发送、已出号或当前状态不允许修改。')
    }
    throw new ShippingError(503, '工单修改暂未保存，请稍后重试。')
  }
  if (amended !== true) throw new ShippingError(404, '寄件工单不存在。')

  const { data, error: readError } = await supabaseAdmin.from('shipping_orders')
    .select(select)
    .eq('id', args.orderId)
    .eq('org_id', args.orgId)
    .single()
  if (readError || !data) throw new ShippingError(503, '工单已修改，但最新版本读取失败，请刷新核对。')
  return map(data as ShipmentRow)
}

export async function getShipmentByReceipt(token: string, owner: { orgId: string; employeeId?: string }) {
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) return null
  let query = supabaseAdmin.from('shipping_orders').select(select).eq('receipt_token_hash', hash(token))
  query = query.eq('org_id', owner.orgId)
  if (owner.employeeId) query = query.eq('employee_profile_id', owner.employeeId)
  const { data, error } = await query.maybeSingle()
  if (error) throw new ShippingError(503, '寄件状态暂不可用。')
  return data ? map(data as ShipmentRow) : null
}

function requireOrganization(orgId: string) {
  if (!orgId) throw new ShippingError(403, '当前账号没有可用的组织寄件授权。')
}

export async function listShipmentLedger(orgId: string, filters: { salesRef?: string; customerRef?: string; contact?: string; status?: ShipmentOrderStatus; cursor?: string; limit: number }) {
  requireOrganization(orgId)
  let query = supabaseAdmin.from('shipping_orders').select(select).eq('org_id', orgId).order('created_at', { ascending: false }).limit(filters.limit)
  if (filters.salesRef) query = query.eq('sales_ref', filters.salesRef)
  if (filters.customerRef) query = query.eq('customer_ref', filters.customerRef)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.cursor) query = query.lt('created_at', filters.cursor)
  if (filters.contact) { const term = filters.contact.replace(/[%_,]/g, ''); query = query.or(`shipment_payload->sender->>name.ilike.%${term}%,shipment_payload->sender->>phone.ilike.%${term}%,shipment_payload->recipient->>name.ilike.%${term}%,shipment_payload->recipient->>phone.ilike.%${term}%`) }
  const { data, error } = await query
  if (error) throw new ShippingError(503, '收寄件台账暂不可用。')
  return (data || []).map(row => map(row as ShipmentRow))
}

export async function assignShipmentRelation(id: string, orgId: string, salesRef: string, customerRef?: string) {
  requireOrganization(orgId)
  const { data, error } = await supabaseAdmin.from('shipping_orders').update({ sales_ref: salesRef, customer_ref: customerRef || null, assignment_status: 'assigned', updated_at: new Date().toISOString() }).eq('id', id).eq('org_id', orgId).in('status', ['accepted', 'awaiting_confirmation', 'returned']).select(select).maybeSingle()
  if (error) throw new ShippingError(503, '销售和客户关系保存失败。')
  if (!data) throw new ShippingError(409, '寄件单已经进入下单流程，不能重新分配。')
  return map(data as ShipmentRow)
}

export async function createDueShipmentReviewReminders(now = new Date()) {
  const recipients = await listShippingOperatorRecipients()
  const groups = new Map<string, Set<string>>()
  for (const recipient of recipients) {
    if (!recipient.orgId) continue
    const users = groups.get(recipient.orgId) || new Set<string>()
    users.add(recipient.userId); groups.set(recipient.orgId, users)
  }
  const totals = { orders: 0, reminders: 0 }
  const notifiedAt = now.toISOString()
  for (const [orgId, users] of groups) {
    const { data: orders, error } = await supabaseAdmin.from('shipping_orders').update({ review_notified_at: notifiedAt, updated_at: notifiedAt })
      .eq('org_id', orgId).eq('status', 'awaiting_confirmation').lte('next_review_at', notifiedAt).is('review_notified_at', null).select('id,order_no')
    if (error) throw new ShippingError(503, '待核对寄件单汇总失败。')
    if (!orders?.length) continue
    const title = `有 ${orders.length} 个寄件单待核对`
    const description = `寄件单：${orders.slice(0, 5).map(order => order.order_no).join('、')}${orders.length > 5 ? ' 等' : ''}`
    const { error: reminderError } = await supabaseAdmin.from('reminders').insert([...users].map(userId => ({ org_id: orgId, user_id: userId, type: 'APPROVAL', title, description, link_type: 'SHIPPING', priority: 'HIGH', due_at: notifiedAt })))
    if (reminderError) {
      await supabaseAdmin.from('shipping_orders').update({ review_notified_at: null }).eq('org_id', orgId).in('id', orders.map(order => order.id)).eq('review_notified_at', notifiedAt)
      throw new ShippingError(503, '寄件核对提醒生成失败。')
    }
    totals.orders += orders.length; totals.reminders += users.size
  }
  return totals
}

export async function getOrganizationShipmentProviderSnapshot(orgId: string, waybill: string) {
  requireOrganization(orgId)
  const { data: waybillRow, error: waybillError } = await supabaseAdmin.from('shipping_waybills').select('shipping_order_id,carrier_key,shipping_orders!inner(org_id)').eq('shipping_orders.org_id', orgId).eq('waybill_no', waybill).maybeSingle()
  if (waybillError) throw new ShippingError(503, '运单归属核对暂不可用。')
  if (!waybillRow) return null
  const { data, error } = await supabaseAdmin.from('shipping_orders')
    .select('org_id,provider_key,carrier_connection_id,billing_account_id,connection_environment')
    .eq('id', waybillRow.shipping_order_id).eq('org_id', orgId).maybeSingle()
  if (error) throw new ShippingError(503, '运单配置快照读取失败。')
  if (data && (data.org_id !== orgId || data.provider_key !== waybillRow.carrier_key)) throw new ShippingError(409, '运单归属或承运商快照不一致，无法查询。')
  return data || null
}

export async function listEmployeeShipmentReceipts(orgId: string, employeeId: string) {
  requireOrganization(orgId)
  if (!employeeId) throw new ShippingError(401, '请先通过企业微信验证身份。')
  const { data, error } = await supabaseAdmin.from('shipping_orders').select(select).eq('org_id', orgId).eq('employee_profile_id', employeeId).eq('intake_source', 'anonymous_web').order('created_at', { ascending: false }).limit(50)
  if (error) throw new ShippingError(503, '个人工单暂时无法读取，请稍后刷新。')
  return (data || []).map(row => publicShipmentReceipt(map(row as ShipmentRow)))
}

export async function listOwnerShipmentReceipts(orgId: string, userId: string, page = 0) {
  requireOrganization(orgId)
  if (!userId) throw new ShippingError(401, '请先登录后查看本人提报记录。')
  if (!Number.isSafeInteger(page) || page < 0 || page > 1000) throw new ShippingError(400, '记录页码无效。')
  const limit = 50
  const { data, error } = await supabaseAdmin.from('shipping_orders')
    .select('order_no,status,cancel_phase:cancellation->>phase,provider_key,provider_order_id,carrier_connection_id,connection_environment,failure_stage:shipping_config_snapshot->orderFailure->>stage,next_review_at,created_at,customer_name:shipment_payload->>customerName,shipping_waybills(waybill_no,latest_status,provider_order_id,carrier_key)')
    .eq('org_id', orgId)
    .eq('created_by', userId)
    .eq('intake_source', 'owner_web')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(page * limit, page * limit + limit)
  if (error) throw new ShippingError(503, '本人提报记录暂时无法读取，请稍后刷新。')
  const rows = data || []
  const orders: ShipmentReceipt[] = rows.slice(0, limit).map(row => {
    const waybills = Array.isArray(row.shipping_waybills) ? row.shipping_waybills : row.shipping_waybills ? [row.shipping_waybills] : []
    const wb = waybills[0]
    const canCancel = (!row.cancel_phase || row.cancel_phase === 'not_sent') && (row.status === 'waybill_created'
      ? Boolean(row.provider_order_id && row.carrier_connection_id && row.connection_environment && wb?.waybill_no && wb.latest_status === 'waybill_created' &&
        wb.provider_order_id === row.provider_order_id && wb.carrier_key === row.provider_key)
      : !wb && ['accepted','awaiting_confirmation','confirmed','returned','order_failed'].includes(row.status) &&
        (!row.provider_order_id || (row.status === 'order_failed' && row.failure_stage === 'provider_not_sent')))
    return { canCancel, orderNo: row.order_no, status: row.status, ...(row.cancel_phase ? { cancellationState:row.cancel_phase } : {}), waybill: waybills[0]?.waybill_no || null,
      nextReviewAt: row.next_review_at, createdAt: row.created_at,
      customerName: typeof row.customer_name === 'string' && row.customer_name.trim() ? row.customer_name.trim() : null }
  })
  return { orders, nextPage: rows.length > limit ? page + 1 : null }
}

/** Temporary shared sales list approved in IN-20261109-022; no contact or receipt secrets. */
export async function listPublicShipmentReceipts(orgId: string, page = 0) {
  requireOrganization(orgId)
  if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger((page + 1) * 50)) throw new ShippingError(400, '记录页码无效。')
  const { data, error } = await supabaseAdmin.from('shipping_orders')
    .select('order_no,status,next_review_at,created_at,customer_name:shipment_payload->>customerName,shipping_waybills(waybill_no)')
    .eq('org_id', orgId).order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(page * 50, page * 50 + 50)
  if (error) throw new ShippingError(503, '提报记录暂时无法读取，请稍后刷新。')
  const rows = data || []
  const orders: ShipmentReceipt[] = rows.slice(0, 50).map(row => {
    const waybills = Array.isArray(row.shipping_waybills) ? row.shipping_waybills : row.shipping_waybills ? [row.shipping_waybills] : []
    return { orderNo: row.order_no, status: row.status, waybill: waybills[0]?.waybill_no || null, nextReviewAt: row.next_review_at, createdAt: row.created_at, customerName: typeof row.customer_name === 'string' && row.customer_name.trim() ? row.customer_name.trim() : null }
  })
  return { orders, nextPage: rows.length > 50 ? page + 1 : null }
}
