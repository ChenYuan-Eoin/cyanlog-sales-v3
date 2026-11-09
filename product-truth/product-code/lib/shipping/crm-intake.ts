import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { contactSchema } from './validation'
import { DOMESTIC_SHIPPING_PHONE_PATTERN } from './phone'
import { createShipmentReceiptToken, newShippingOrderNo, nextShippingReviewAt } from './collaboration'
import { loadDefaultShippingSender } from './sender-profile'
import { loadIntakeOptionsForOrg } from './intake-options'
import type { Contact, ShipmentOrderStatus, ShippingInput, ShippingPayment } from './types'
import {
  canonicalJson,
  canonicalJsonText,
  CRM_JSON_CANONICALIZATION_HEADER,
  CRM_JSON_CANONICALIZATION_V1,
} from './fxiaoke-apl/canonical-json'

export const CRM_INTAKE_MAX_CLOCK_SKEW_SECONDS = 5 * 60
export const CRM_INTAKE_MAX_BODY_BYTES = 32 * 1024
const CRM_CLIENT_HEADER = 'x-shipping-crm-client-id'
const CRM_TIMESTAMP_HEADER = 'x-shipping-crm-timestamp'
const CRM_SIGNATURE_HEADER = 'x-shipping-crm-signature'

const identifier = (max: number) => z.string().trim().min(1, '缺少来源标识').max(max)
const phone = z.string().trim().regex(DOMESTIC_SHIPPING_PHONE_PATTERN, '请填写国内手机号或带区号的座机')

const crmEventIdentitySchema = z.object({
  enterpriseId: identifier(120),
  workflowInstanceId: identifier(160),
  objectApiName: identifier(100).regex(/^[A-Za-z][A-Za-z0-9_]*$/, '业务对象 API 名称格式无效'),
  recordId: identifier(160),
  shipmentDetailId: identifier(160),
  taskId: identifier(160),
  stageId: identifier(160),
  revisionId: identifier(160),
}).strict()

const crmApplicantSchema = z.object({
  employeeId: identifier(160),
  name: z.string().trim().min(1, '请填写申请人姓名').max(60),
  phone,
  departmentId: identifier(160).optional(),
  departmentName: z.string().trim().min(1, '请填写申请人部门').max(80),
}).strict()

const crmCustomerSchema = z.object({
  accountId: identifier(160),
  name: z.string().trim().min(1, '请填写客户名称').max(120),
}).strict()

const crmShipmentSchema = z.object({
  recipient: contactSchema,
  cargo: z.string().trim().min(1, '请填写物品').max(60),
  weight: z.number().finite().positive('重量必须大于 0').max(20),
  serviceId: z.number().int().positive().optional(),
  servicePreference: z.enum(['standard', 'urgent']).optional(),
  payment: z.enum(['sender_cash', 'recipient', 'sender_monthly']).default('sender_monthly'),
  remark: z.string().trim().max(100).default(''),
  specialRequirements: z.string().trim().max(500).optional(),
  pickupWindow: z.string().trim().max(80).optional(),
  sourceText: z.string().trim().max(4000).optional(),
}).strict().superRefine((value, ctx) => {
  if (!value.serviceId && !value.servicePreference) {
    ctx.addIssue({ code: 'custom', path: ['service'], message: '请选择寄件服务' })
  }
})

export const crmIntakeBodySchema = z.object({
  event: crmEventIdentitySchema,
  applicant: crmApplicantSchema,
  customer: crmCustomerSchema,
  shipment: crmShipmentSchema,
}).strict()

export type CrmEventIdentity = z.infer<typeof crmEventIdentitySchema>
export type CrmIntakePayload = z.infer<typeof crmIntakeBodySchema>
export type CrmIntakeClient = { clientId: string; orgId: string; enterpriseId?: string; secret: string }

const clientsSchema = z.array(z.object({
  clientId: identifier(80).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, '客户端 ID 格式无效'),
  orgId: z.string().uuid(),
  enterpriseId: identifier(120).optional(),
  secret: z.string().min(32, '客户端密钥至少 32 个字符').max(512),
}).strict()).min(1).max(50).superRefine((clients, ctx) => {
  const seen = new Set<string>()
  for (const [index, client] of clients.entries()) {
    if (seen.has(client.clientId)) ctx.addIssue({ code: 'custom', path: [index, 'clientId'], message: '客户端 ID 不能重复' })
    seen.add(client.clientId)
  }
})

export type CrmMissingField = { field: string; message: string; issue: string }
export type CrmIntakeSourceEvidence = {
  event: CrmEventIdentity | null
  applicant: CrmIntakePayload['applicant'] | null
  customer: CrmIntakePayload['customer'] | null
}
export type CrmIntakeInspection =
  | { ok: true; payload: CrmIntakePayload; source: CrmIntakeSourceEvidence; missing: [] }
  | { ok: false; payload: null; source: CrmIntakeSourceEvidence; missing: CrmMissingField[] }

export type CrmIntakePreflight = {
  ready: boolean
  organization: { orgId: string; integrationClientId: string }
  event: CrmEventIdentity
  eventKey: string
  source: CrmIntakeSourceEvidence & { eventKey: string | null }
  normalized: null | {
    applicant: CrmIntakePayload['applicant']
    customer: CrmIntakePayload['customer']
    sender: Contact
    recipient: Contact
    service: { id: number; name: string; preference: 'standard' | 'urgent' }
    cargo: string
    weight: number
    payment: ShippingPayment
    remark: string
    specialRequirements?: string
    pickupWindow?: string
  }
  missing: CrmMissingField[]
}

export type CrmIntakeReceipt = {
  accepted: true
  created: boolean
  eventKey: string
  orderId: string
  orderNo: string
  status: ShipmentOrderStatus
  waybill: string | null
  nextAction: 'operator_confirmation' | 'status_readback'
}

export class CrmIntakeError extends Error {
  constructor(public status: number, public code: string, message: string, public missing?: CrmMissingField[]) {
    super(message)
  }
}

export class CrmIntakeIncompleteError extends CrmIntakeError {
  constructor(public preflight: CrmIntakePreflight) {
    super(422, 'CRM_INTAKE_INCOMPLETE', 'CRM 寄件信息尚未完整，请补齐缺项后重试。', preflight.missing)
  }
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

function uuidFromHex(value: string) {
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`
}

function issueField(prefix: string, issue: z.ZodIssue) {
  const suffix = issue.path.length ? issue.path.join('.') : ''
  return prefix || suffix ? [prefix, suffix].filter(Boolean).join('.') : 'request'
}

function zodMissing(prefix: string, error: z.ZodError): CrmMissingField[] {
  return error.issues.map(issue => ({
    field: issueField(prefix, issue),
    message: issue.message,
    issue: issue.code,
  }))
}

export function loadCrmIntakeClients(env: Record<string, string | undefined> = process.env): CrmIntakeClient[] {
  const raw = env.SHIPPING_CRM_CLIENTS_JSON
  if (!raw?.trim()) throw new CrmIntakeError(503, 'CRM_INTAKE_NOT_CONFIGURED', 'CRM 受理连接尚未配置。')
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    throw new CrmIntakeError(503, 'CRM_INTAKE_CONFIG_INVALID', 'CRM 受理连接配置无效。')
  }
  const parsed = clientsSchema.safeParse(decoded)
  if (!parsed.success) throw new CrmIntakeError(503, 'CRM_INTAKE_CONFIG_INVALID', 'CRM 受理连接配置无效。')
  return parsed.data
}

export function crmSignaturePayload(timestamp: string, method: string, pathname: string, rawBody: string) {
  return `${timestamp}\n${method.toUpperCase()}\n${pathname}\n${rawBody}`
}

export function crmCanonicalSignaturePayload(timestamp: string, method: string, pathname: string, rawBody: string) {
  return `${CRM_JSON_CANONICALIZATION_V1}\n${timestamp}\n${method.toUpperCase()}\n${pathname}\n${canonicalJsonText(rawBody)}`
}

export function createCrmSignature(secret: string, timestamp: string, method: string, pathname: string, rawBody: string) {
  return createHmac('sha256', secret).update(crmSignaturePayload(timestamp, method, pathname, rawBody)).digest('hex')
}

export function authenticateCrmRequest(args: {
  method: string
  pathname: string
  headers: Pick<Headers, 'get'>
  rawBody: string
  now?: number
  env?: Record<string, string | undefined>
}): CrmIntakeClient {
  const clients = loadCrmIntakeClients(args.env)
  const clientId = args.headers.get(CRM_CLIENT_HEADER)?.trim()
  const timestamp = args.headers.get(CRM_TIMESTAMP_HEADER)?.trim() || ''
  const provided = (args.headers.get(CRM_SIGNATURE_HEADER)?.trim() || '').replace(/^sha256=/i, '').toLowerCase()
  const canonicalization = args.headers.get(CRM_JSON_CANONICALIZATION_HEADER)?.trim() || ''
  if (!clientId) throw new CrmIntakeError(401, 'CRM_CLIENT_MISSING', '缺少 CRM 客户端身份。')
  const client = clients.find(item => item.clientId === clientId)
  if (!client) throw new CrmIntakeError(401, 'CRM_CLIENT_UNKNOWN', 'CRM 客户端身份不受信任。')
  if (!/^\d{10}$/.test(timestamp)) throw new CrmIntakeError(401, 'CRM_TIMESTAMP_INVALID', 'CRM 请求时间戳无效。')
  const nowSeconds = Math.floor((args.now ?? Date.now()) / 1000)
  if (Math.abs(nowSeconds - Number(timestamp)) > CRM_INTAKE_MAX_CLOCK_SKEW_SECONDS) {
    throw new CrmIntakeError(401, 'CRM_TIMESTAMP_STALE', 'CRM 请求已超时，请重新签名。')
  }
  if (!/^[a-f0-9]{64}$/.test(provided)) throw new CrmIntakeError(401, 'CRM_SIGNATURE_INVALID', 'CRM 请求签名无效。')
  if (canonicalization && canonicalization !== CRM_JSON_CANONICALIZATION_V1) {
    throw new CrmIntakeError(401, 'CRM_CANONICALIZATION_INVALID', 'CRM 请求规范化协议不受支持。')
  }
  let signatureBody: string
  try {
    signatureBody = canonicalization === CRM_JSON_CANONICALIZATION_V1
      ? canonicalJsonText(args.rawBody)
      : args.rawBody
  } catch {
    throw new CrmIntakeError(400, 'CRM_REQUEST_INVALID_JSON', 'CRM 请求不是有效 JSON。')
  }
  const expected = createHmac('sha256', client.secret)
    .update(canonicalization === CRM_JSON_CANONICALIZATION_V1
      ? crmCanonicalSignaturePayload(timestamp, args.method, args.pathname, args.rawBody)
      : crmSignaturePayload(timestamp, args.method, args.pathname, signatureBody))
    .digest('hex')
  if (!timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'))) {
    throw new CrmIntakeError(401, 'CRM_SIGNATURE_INVALID', 'CRM 请求签名无效。')
  }
  return client
}

export async function readCrmRequestBody(req: Pick<Request, 'text'>) {
  const rawBody = await req.text()
  if (Buffer.byteLength(rawBody, 'utf8') > CRM_INTAKE_MAX_BODY_BYTES) {
    throw new CrmIntakeError(413, 'CRM_REQUEST_TOO_LARGE', 'CRM 请求内容过长。')
  }
  return rawBody
}

export function inspectCrmIntakeRequest(rawBody: string): CrmIntakeInspection {
  let decoded: unknown
  try {
    decoded = JSON.parse(rawBody)
  } catch {
    throw new CrmIntakeError(400, 'CRM_REQUEST_INVALID_JSON', 'CRM 请求不是有效 JSON。')
  }
  const record = typeof decoded === 'object' && decoded !== null && !Array.isArray(decoded)
    ? decoded as Record<string, unknown>
    : null
  const source: CrmIntakeSourceEvidence = {
    event: crmEventIdentitySchema.safeParse(record?.event).data || null,
    applicant: crmApplicantSchema.safeParse(record?.applicant).data || null,
    customer: crmCustomerSchema.safeParse(record?.customer).data || null,
  }
  const parsed = crmIntakeBodySchema.safeParse(decoded)
  if (!parsed.success) {
    const missing = zodMissing('', parsed.error)
    const shipment = typeof decoded === 'object' && decoded !== null && 'shipment' in decoded
      ? (decoded as { shipment?: { serviceId?: unknown; servicePreference?: unknown } }).shipment
      : undefined
    if (shipment && typeof shipment === 'object' && !shipment.serviceId && !shipment.servicePreference && !missing.some(item => item.field === 'shipment.service')) {
      missing.push({ field: 'shipment.service', message: '请选择寄件服务', issue: 'custom' })
    }
    return { ok: false, payload: null, source, missing }
  }
  return { ok: true, payload: parsed.data, source, missing: [] }
}

export function crmEventKey(client: CrmIntakeClient, event: CrmEventIdentity) {
  return sha256(JSON.stringify({ orgId: client.orgId, clientId: client.clientId, event }))
}

function assertEnterpriseScope(client: CrmIntakeClient, event: CrmEventIdentity) {
  if (client.enterpriseId && client.enterpriseId !== event.enterpriseId) {
    throw new CrmIntakeError(403, 'CRM_ENTERPRISE_MISMATCH', 'CRM 企业与已核准组织不匹配。')
  }
}

export async function preflightCrmIntake(client: CrmIntakeClient, payload: CrmIntakePayload): Promise<CrmIntakePreflight> {
  assertEnterpriseScope(client, payload.event)
  const [options, sender] = await Promise.all([
    loadIntakeOptionsForOrg(client.orgId),
    loadDefaultShippingSender(client.orgId),
  ])
  const missing: CrmMissingField[] = []
  const parsedSender = contactSchema.safeParse(sender)
  if (!parsedSender.success) missing.push(...zodMissing('sender', parsedSender.error))

  const selected = payload.shipment.serviceId
    ? options.services.find(service => service.id === payload.shipment.serviceId)
    : options.services.find(service => service.preference === payload.shipment.servicePreference)
  if (!selected) missing.push({ field: 'shipment.service', message: '所选寄件服务未在当前组织开放', issue: 'invalid_service' })

  const eventKey = crmEventKey(client, payload.event)
  if (missing.length || !parsedSender.success || !selected) {
    return {
      ready: false,
      organization: { orgId: client.orgId, integrationClientId: client.clientId },
      event: payload.event,
      eventKey,
      source: { event: payload.event, applicant: payload.applicant, customer: payload.customer, eventKey },
      normalized: null,
      missing,
    }
  }

  return {
    ready: true,
    organization: { orgId: client.orgId, integrationClientId: client.clientId },
    event: payload.event,
    eventKey,
    source: { event: payload.event, applicant: payload.applicant, customer: payload.customer, eventKey },
    normalized: {
      applicant: payload.applicant,
      customer: payload.customer,
      sender: parsedSender.data,
      recipient: payload.shipment.recipient,
      service: { id: selected.id, name: selected.name, preference: selected.preference },
      cargo: payload.shipment.cargo,
      weight: payload.shipment.weight,
      payment: payload.shipment.payment,
      remark: payload.shipment.remark,
      ...(payload.shipment.specialRequirements ? { specialRequirements: payload.shipment.specialRequirements } : {}),
      ...(payload.shipment.pickupWindow ? { pickupWindow: payload.shipment.pickupWindow } : {}),
    },
    missing: [],
  }
}

async function preflightCrmIntakeInspection(client: CrmIntakeClient, inspection: CrmIntakeInspection): Promise<CrmIntakePreflight> {
  if (inspection.ok) return preflightCrmIntake(client, inspection.payload)

  const event = inspection.source.event
  if (event) assertEnterpriseScope(client, event)
  const eventKey = event ? crmEventKey(client, event) : null
  return {
    ready: false,
    organization: { orgId: client.orgId, integrationClientId: client.clientId },
    event: event || {
      enterpriseId: '', workflowInstanceId: '', objectApiName: '', recordId: '', shipmentDetailId: '', taskId: '', stageId: '', revisionId: '',
    },
    eventKey: eventKey || '',
    source: { ...inspection.source, eventKey },
    normalized: null,
    missing: inspection.missing,
  }
}

export async function preflightCrmIntakeRequest(client: CrmIntakeClient, rawBody: string): Promise<CrmIntakePreflight> {
  return preflightCrmIntakeInspection(client, inspectCrmIntakeRequest(rawBody))
}

function shippingInputFromPreflight(preflight: CrmIntakePreflight): ShippingInput {
  if (!preflight.ready || !preflight.normalized) throw new CrmIntakeIncompleteError(preflight)
  const normalized = preflight.normalized
  return {
    sender: normalized.sender,
    recipient: normalized.recipient,
    cargo: normalized.cargo,
    weight: normalized.weight,
    serviceId: normalized.service.id,
    serviceName: normalized.service.name,
    servicePreference: normalized.service.preference,
    remark: normalized.remark,
    source: 'manual',
    payment: normalized.payment,
    customerName: normalized.customer.name,
    submittedBy: {
      name: normalized.applicant.name,
      phone: normalized.applicant.phone,
      team: normalized.applicant.departmentName,
    },
    ...(normalized.specialRequirements ? { specialRequirements: normalized.specialRequirements } : {}),
    ...(normalized.pickupWindow ? { pickupWindow: normalized.pickupWindow } : {}),
  }
}

async function existingReceipt(client: CrmIntakeClient, event: { payload_hash: string }, payloadHash: string, eventKey: string): Promise<CrmIntakeReceipt> {
  if (event.payload_hash !== payloadHash) {
    throw new CrmIntakeError(409, 'CRM_EVENT_PAYLOAD_CONFLICT', '同一 CRM 事件的内容发生变化，已拒绝覆盖原工单。')
  }
  const { data, error } = await supabaseAdmin.rpc('replay_shipping_crm_intake', {
    p_org_id: client.orgId,
    p_integration_client_id: client.clientId,
    p_event_key: eventKey,
    p_payload_hash: payloadHash,
  })
  if (error) {
    if (String(error.message || '').includes('CRM_INTAKE_PAYLOAD_CONFLICT')) {
      throw new CrmIntakeError(409, 'CRM_EVENT_PAYLOAD_CONFLICT', '同一 CRM 事件的内容发生变化，已拒绝覆盖原工单。')
    }
    throw new CrmIntakeError(503, 'CRM_EVENT_RECOVERY_FAILED', '原 CRM 工单暂时无法读取，请稍后重试。')
  }
  const result = data as { created?: boolean; order_id?: string; order_no?: string; status?: ShipmentOrderStatus; waybill_no?: string | null } | null
  if (result?.created !== false || !result.order_id || !result.order_no || !result.status) {
    throw new CrmIntakeError(503, 'CRM_EVENT_RECOVERY_FAILED', '原 CRM 工单暂时无法读取，请稍后重试。')
  }
  return {
    accepted: true,
    created: false,
    eventKey,
    orderId: result.order_id,
    orderNo: result.order_no,
    status: result.status,
    waybill: result.waybill_no ?? null,
    nextAction: result.status === 'awaiting_confirmation' ? 'operator_confirmation' : 'status_readback',
  }
}

export async function createCrmIntake(client: CrmIntakeClient, rawBody: string): Promise<CrmIntakeReceipt> {
  const inspection = inspectCrmIntakeRequest(rawBody)
  if (!inspection.ok) {
    throw new CrmIntakeIncompleteError(await preflightCrmIntakeInspection(client, inspection))
  }
  const payload = inspection.payload
  assertEnterpriseScope(client, payload.event)
  const eventKey = crmEventKey(client, payload.event)
  const payloadHash = sha256(canonicalJson(inspection.payload))

  const prior = await supabaseAdmin.from('shipping_crm_intake_events')
    .select('payload_hash,shipping_order_id')
    .eq('org_id', client.orgId)
    .eq('integration_client_id', client.clientId)
    .eq('event_key', eventKey)
    .maybeSingle()
  if (prior.error) throw new CrmIntakeError(503, 'CRM_EVENT_READ_FAILED', 'CRM 事件核对暂不可用。')
  if (prior.data) return existingReceipt(client, prior.data, payloadHash, eventKey)

  const preflight = await preflightCrmIntake(client, payload)
  if (!preflight.ready || !preflight.normalized) throw new CrmIntakeIncompleteError(preflight)
  const input = shippingInputFromPreflight(preflight)
  const receiptToken = createShipmentReceiptToken(eventKey)
  const orderNo = newShippingOrderNo()
  const { data, error } = await supabaseAdmin.rpc('create_shipping_crm_intake', {
    p_order_id: randomUUID(),
    p_order_no: orderNo,
    p_org_id: client.orgId,
    p_idempotency_key: uuidFromHex(eventKey),
    p_integration_client_id: client.clientId,
    p_event_key: eventKey,
    p_payload_hash: payloadHash,
    p_enterprise_id: payload.event.enterpriseId,
    p_workflow_instance_id: payload.event.workflowInstanceId,
    p_object_api_name: payload.event.objectApiName,
    p_crm_record_id: payload.event.recordId,
    p_shipment_detail_id: payload.event.shipmentDetailId,
    p_task_id: payload.event.taskId,
    p_stage_id: payload.event.stageId,
    p_revision_id: payload.event.revisionId,
    p_applicant_snapshot: payload.applicant,
    p_customer_snapshot: payload.customer,
    p_shipment_payload: input,
    p_raw_input: payload.shipment.sourceText || null,
    p_raw_request: rawBody,
    p_receipt_token_hash: sha256(receiptToken),
    p_next_review_at: nextShippingReviewAt(),
  })
  if (error) {
    if (String(error.message || '').includes('CRM_INTAKE_PAYLOAD_CONFLICT')) {
      throw new CrmIntakeError(409, 'CRM_EVENT_PAYLOAD_CONFLICT', '同一 CRM 事件的内容发生变化，已拒绝覆盖原工单。')
    }
    if (String(error.code || '') === '23505') {
      const retry = await supabaseAdmin.from('shipping_crm_intake_events')
        .select('payload_hash,shipping_order_id')
        .eq('org_id', client.orgId).eq('integration_client_id', client.clientId).eq('event_key', eventKey).single()
      if (!retry.error && retry.data) return existingReceipt(client, retry.data, payloadHash, eventKey)
    }
    throw new CrmIntakeError(503, 'CRM_INTAKE_WRITE_FAILED', 'CRM 工单暂未保存，请稍后重试。')
  }
  const result = data as { created?: boolean; order_id?: string; order_no?: string; status?: ShipmentOrderStatus } | null
  if (!result?.order_id || !result.order_no || result.status !== 'awaiting_confirmation') {
    throw new CrmIntakeError(503, 'CRM_INTAKE_READBACK_FAILED', 'CRM 工单已提交，但回读结果不完整，请用同一事件重试。')
  }
  return {
    accepted: true,
    created: result.created === true,
    eventKey,
    orderId: result.order_id,
    orderNo: result.order_no,
    status: result.status,
    waybill: null,
    nextAction: 'operator_confirmation',
  }
}
