// @vitest-environment node
import { createHash, createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authenticateCrmRequest,
  crmCanonicalSignaturePayload,
  createCrmIntake,
  createCrmSignature,
  crmEventKey,
  crmIntakeBodySchema,
  inspectCrmIntakeRequest,
  preflightCrmIntake,
  preflightCrmIntakeRequest,
  type CrmIntakeClient,
} from './crm-intake'
import {
  canonicalJson,
  CRM_JSON_CANONICALIZATION_HEADER,
  CRM_JSON_CANONICALIZATION_V1,
} from './fxiaoke-apl/canonical-json'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  options: vi.fn(),
  sender: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.rpc } }))
vi.mock('./intake-options', () => ({ loadIntakeOptionsForOrg: mocks.options }))
vi.mock('./sender-profile', () => ({ loadDefaultShippingSender: mocks.sender }))
vi.mock('./collaboration', () => ({
  createShipmentReceiptToken: () => 'receipt-token-for-crm-testing',
  newShippingOrderNo: () => 'SO-20261106-ABC12345',
  nextShippingReviewAt: () => '2026-11-06T03:00:00.000Z',
}))

const client: CrmIntakeClient = {
  clientId: 'fxiaoke-prod',
  orgId: '123e4567-e89b-42d3-a456-426614174000',
  enterpriseId: 'ea-cyanlog',
  secret: 'test-signature-fixture-value-is-not-a-secret',
}
const sender = { name: 'ONES 寄件中心', phone: '13800000000', province: '上海市', city: '上海市', county: '浦东新区', address: '张江路88号' }
const body = {
  event: {
    enterpriseId: 'ea-cyanlog', workflowInstanceId: 'instance-1', objectApiName: 'ContractObj', recordId: 'record-1',
    shipmentDetailId: 'detail-1', taskId: 'task-1', stageId: 'stage-approved', revisionId: 'revision-1',
  },
  applicant: { employeeId: 'sales-1093', name: '陈源', phone: '13900000000', departmentId: 'dept-1', departmentName: '商务运营部' },
  customer: { accountId: 'account-1', name: '示例客户有限公司' },
  shipment: {
    recipient: { name: '张三', phone: '13700000000', province: '广东省', city: '深圳市', county: '南山区', address: '科技园1号' },
    cargo: '合同文件', weight: 1, servicePreference: 'standard', payment: 'sender_monthly', remark: '审批通过后寄出',
  },
}
const rawBody = (payload: unknown = body) => JSON.stringify(payload)
const preflightPath = '/api/shipping/crm/preflight'
const ordersPath = '/api/shipping/crm/orders'
const headers = (timestamp: string, signature: string) => new Headers({
  'x-shipping-crm-client-id': client.clientId,
  'x-shipping-crm-timestamp': timestamp,
  'x-shipping-crm-signature': signature,
})
const env = { SHIPPING_CRM_CLIENTS_JSON: JSON.stringify([client]) }

function eventLookup(data: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.maybeSingle = vi.fn().mockResolvedValue({ data, error: null })
  return chain
}

function orderLookup(data: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.single = vi.fn().mockResolvedValue({ data, error: null })
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.options.mockResolvedValue({
    orgId: client.orgId,
    rules: { companyName: { enabled: true, required: true, minLength: 4 }, team: { enabled: true, required: true, minLength: 1 }, teamOptions: [] },
    services: [{ id: 1, name: '顺丰标快', preference: 'standard' }],
  })
  mocks.sender.mockResolvedValue(sender)
  mocks.rpc.mockResolvedValue({ data: { created: true, order_id: 'order-1', order_no: 'SO-20261106-ABC12345', status: 'awaiting_confirmation' }, error: null })
})

describe('CRM server-to-server authentication', () => {
  const timestamp = '1793950800'
  const now = Number(timestamp) * 1000

  it('accepts an exact-body HMAC and returns the server-mapped client', () => {
    const requestBody = rawBody()
    const signature = createCrmSignature(client.secret, timestamp, 'POST', preflightPath, requestBody)
    expect(authenticateCrmRequest({ method: 'POST', pathname: preflightPath, headers: headers(timestamp, `sha256=${signature}`), rawBody: requestBody, now, env })).toEqual(client)
  })

  it('accepts a canonical-map HMAC even when the transport changes key order and whitespace', () => {
    const reorderedBody = JSON.stringify({
      shipment: body.shipment,
      customer: body.customer,
      applicant: body.applicant,
      event: body.event,
    }, null, 2)
    const signature = createHmac('sha256', client.secret)
      .update(crmCanonicalSignaturePayload(timestamp, 'POST', preflightPath, reorderedBody))
      .digest('hex')
    const canonicalHeaders = headers(timestamp, `sha256=${signature}`)
    canonicalHeaders.set(CRM_JSON_CANONICALIZATION_HEADER, CRM_JSON_CANONICALIZATION_V1)

    expect(authenticateCrmRequest({ method: 'POST', pathname: preflightPath, headers: canonicalHeaders, rawBody: reorderedBody, now, env })).toEqual(client)
  })

  it('rejects missing, invalid, stale and unknown-client credentials', () => {
    const requestBody = rawBody()
    expect(() => authenticateCrmRequest({ method: 'POST', pathname: preflightPath, headers: new Headers(), rawBody: requestBody, now, env })).toThrow(expect.objectContaining({ status: 401, code: 'CRM_CLIENT_MISSING' }))

    const validSignature = createCrmSignature(client.secret, timestamp, 'POST', preflightPath, requestBody)
    expect(() => authenticateCrmRequest({ method: 'POST', pathname: preflightPath, headers: headers(timestamp, '0'.repeat(64)), rawBody: requestBody, now, env })).toThrow(expect.objectContaining({ code: 'CRM_SIGNATURE_INVALID' }))
    expect(() => authenticateCrmRequest({ method: 'POST', pathname: preflightPath, headers: headers(timestamp, validSignature), rawBody: requestBody, now: (Number(timestamp) + 301) * 1000, env })).toThrow(expect.objectContaining({ code: 'CRM_TIMESTAMP_STALE' }))

    const unknownHeaders = headers(timestamp, validSignature)
    unknownHeaders.set('x-shipping-crm-client-id', 'unknown')
    expect(() => authenticateCrmRequest({ method: 'POST', pathname: preflightPath, headers: unknownHeaders, rawBody: requestBody, now, env })).toThrow(expect.objectContaining({ code: 'CRM_CLIENT_UNKNOWN' }))

    const unsupportedHeaders = headers(timestamp, validSignature)
    unsupportedHeaders.set(CRM_JSON_CANONICALIZATION_HEADER, 'unknown-v2')
    expect(() => authenticateCrmRequest({ method: 'POST', pathname: preflightPath, headers: unsupportedHeaders, rawBody: requestBody, now, env })).toThrow(expect.objectContaining({ code: 'CRM_CANONICALIZATION_INVALID' }))
  })

  it('does not accept a signature for a different method, path or altered body', () => {
    const requestBody = rawBody()
    const signature = createCrmSignature(client.secret, timestamp, 'POST', preflightPath, requestBody)
    expect(() => authenticateCrmRequest({ method: 'PUT', pathname: preflightPath, headers: headers(timestamp, signature), rawBody: requestBody, now, env })).toThrow(expect.objectContaining({ code: 'CRM_SIGNATURE_INVALID' }))
    expect(() => authenticateCrmRequest({ method: 'POST', pathname: preflightPath, headers: headers(timestamp, signature), rawBody: `${requestBody} `, now, env })).toThrow(expect.objectContaining({ code: 'CRM_SIGNATURE_INVALID' }))
    expect(() => authenticateCrmRequest({ method: 'POST', pathname: ordersPath, headers: headers(timestamp, signature), rawBody: requestBody, now, env })).toThrow(expect.objectContaining({ code: 'CRM_SIGNATURE_INVALID' }))
  })
})

describe('CRM intake preflight', () => {
  it('returns normalized values while performing no database write', async () => {
    const parsed = crmIntakeBodySchema.parse(body)
    const result = await preflightCrmIntake(client, parsed)
    expect(result).toMatchObject({
      ready: true,
      organization: { orgId: client.orgId, integrationClientId: client.clientId },
      normalized: {
        sender,
        recipient: body.shipment.recipient,
        applicant: body.applicant,
        customer: body.customer,
        service: { id: 1, name: '顺丰标快', preference: 'standard' },
      },
      missing: [],
    })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('lists schema and organization-default missing fields without creating an order', async () => {
    const { phone: _phone, ...recipient } = body.shipment.recipient
    const { servicePreference: _servicePreference, ...shipment } = body.shipment
    const incomplete = { ...body, shipment: { ...shipment, recipient } }
    const inspection = inspectCrmIntakeRequest(rawBody(incomplete))
    expect(inspection.ok).toBe(false)
    expect(inspection.missing.map(item => item.field)).toEqual(expect.arrayContaining(['shipment.recipient.phone', 'shipment.service']))

    mocks.sender.mockResolvedValue({ name: '', phone: '', province: '', city: '', county: '', address: '' })
    const readyInput = crmIntakeBodySchema.parse(body)
    const result = await preflightCrmIntake(client, readyInput)
    expect(result.ready).toBe(false)
    expect(result.missing.map(item => item.field)).toEqual(expect.arrayContaining(['sender.name', 'sender.phone', 'sender.address']))
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('keeps validated CRM source evidence when only shipment fields are incomplete', async () => {
    const { phone: _phone, ...recipient } = body.shipment.recipient
    const { servicePreference: _servicePreference, ...shipment } = body.shipment
    const result = await preflightCrmIntakeRequest(client, rawBody({ ...body, shipment: { ...shipment, recipient } }))

    expect(result).toMatchObject({
      ready: false,
      organization: { orgId: client.orgId, integrationClientId: client.clientId },
      event: body.event,
      eventKey: crmEventKey(client, body.event),
      source: {
        event: body.event,
        eventKey: crmEventKey(client, body.event),
        applicant: body.applicant,
        customer: body.customer,
      },
      normalized: null,
      missing: expect.arrayContaining([
        expect.objectContaining({ field: 'shipment.recipient.phone' }),
        expect.objectContaining({ field: 'shipment.service' }),
      ]),
    })
    expect(mocks.options).not.toHaveBeenCalled()
    expect(mocks.sender).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rejects an enterprise mismatch before field-completeness processing', async () => {
    const { phone: _phone, ...recipient } = body.shipment.recipient
    const mismatched = {
      ...body,
      event: { ...body.event, enterpriseId: 'ea-other' },
      shipment: { ...body.shipment, recipient },
    }
    await expect(preflightCrmIntakeRequest(client, rawBody(mismatched))).rejects.toMatchObject({ status: 403, code: 'CRM_ENTERPRISE_MISMATCH' })
    expect(mocks.options).not.toHaveBeenCalled()
    expect(mocks.sender).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rejects a configured client when the signed request claims another enterprise', async () => {
    const parsed = crmIntakeBodySchema.parse({ ...body, event: { ...body.event, enterpriseId: 'ea-other' } })
    await expect(preflightCrmIntake(client, parsed)).rejects.toMatchObject({ status: 403, code: 'CRM_ENTERPRISE_MISMATCH' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('derives a stable event key from the complete identity', () => {
    const parsed = crmIntakeBodySchema.parse(body)
    const changed = crmIntakeBodySchema.parse({ ...body, event: { ...body.event, revisionId: 'revision-2' } })
    expect(crmEventKey(client, parsed.event)).toHaveLength(64)
    expect(crmEventKey(client, parsed.event)).toBe(crmEventKey(client, parsed.event))
    expect(crmEventKey(client, parsed.event)).not.toBe(crmEventKey(client, changed.event))
  })
})

describe('CRM intake create-pending idempotency', () => {
  it('returns the original order for an exact replay without reading current defaults', async () => {
    const payloadHash = createHash('sha256').update(canonicalJson(body)).digest('hex')
    mocks.from.mockReturnValueOnce(eventLookup({ payload_hash: payloadHash, shipping_order_id: 'order-1' }))
    mocks.from.mockReturnValueOnce(orderLookup({
      id: 'order-1', order_no: 'SO-20261106-ABC12345', status: 'awaiting_confirmation', shipping_waybills: [{ waybill_no: 'SF123' }],
    }))

    const receipt = await createCrmIntake(client, rawBody())
    expect(receipt).toMatchObject({ created: false, orderId: 'order-1', orderNo: 'SO-20261106-ABC12345', status: 'awaiting_confirmation' })
    expect(mocks.options).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('treats transport whitespace and key order as the same semantic event payload', async () => {
    const payloadHash = createHash('sha256').update(canonicalJson(body)).digest('hex')
    mocks.from.mockReturnValueOnce(eventLookup({ payload_hash: payloadHash, shipping_order_id: 'order-1' }))
    mocks.from.mockReturnValueOnce(orderLookup({
      id: 'order-1', order_no: 'SO-20261106-ABC12345', status: 'awaiting_confirmation', shipping_waybills: [],
    }))
    const reorderedBody = JSON.stringify({
      shipment: body.shipment,
      customer: body.customer,
      applicant: body.applicant,
      event: body.event,
    })

    await expect(createCrmIntake(client, reorderedBody)).resolves.toMatchObject({
      created: false,
      orderId: 'order-1',
      status: 'awaiting_confirmation',
      waybill: null,
    })
    expect(mocks.options).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rejects changed content under the same event identity', async () => {
    mocks.from.mockReturnValueOnce(eventLookup({ payload_hash: 'b'.repeat(64), shipping_order_id: 'order-1' }))
    await expect(createCrmIntake(client, rawBody())).rejects.toMatchObject({ status: 409, code: 'CRM_EVENT_PAYLOAD_CONFLICT' })
    expect(mocks.options).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('creates only an awaiting-confirmation order and passes explicit CRM evidence to the atomic RPC', async () => {
    mocks.from.mockReturnValueOnce(eventLookup(null))
    await expect(createCrmIntake(client, rawBody())).resolves.toMatchObject({
      accepted: true, created: true, orderId: 'order-1', status: 'awaiting_confirmation', waybill: null,
    })
    expect(mocks.rpc).toHaveBeenCalledWith('create_shipping_crm_intake', expect.objectContaining({
      p_org_id: client.orgId,
      p_integration_client_id: client.clientId,
      p_enterprise_id: 'ea-cyanlog',
      p_workflow_instance_id: 'instance-1',
      p_object_api_name: 'ContractObj',
      p_crm_record_id: 'record-1',
      p_shipment_detail_id: 'detail-1',
      p_task_id: 'task-1',
      p_stage_id: 'stage-approved',
      p_revision_id: 'revision-1',
      p_applicant_snapshot: body.applicant,
      p_customer_snapshot: body.customer,
      p_shipment_payload: expect.objectContaining({ source: 'manual', customerName: '示例客户有限公司' }),
    }))
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_status')
  })
})
