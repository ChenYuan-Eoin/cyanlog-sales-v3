// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { CrmIntakeError, CrmIntakeIncompleteError, type CrmIntakePreflight } from '@/lib/shipping/crm-intake'

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  auth: vi.fn(),
  preflightRequest: vi.fn(),
  create: vi.fn(),
}))

vi.mock('@/lib/shipping/crm-intake', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/shipping/crm-intake')>()
  return {
    ...actual,
    readCrmRequestBody: mocks.read,
    authenticateCrmRequest: mocks.auth,
    preflightCrmIntakeRequest: mocks.preflightRequest,
    createCrmIntake: mocks.create,
  }
})

import { POST as preflightPOST } from './preflight/route'
import { POST as ordersPOST } from './orders/route'

const request = (url: string) => new NextRequest(`http://localhost${url}`, { method: 'POST', body: '{}' })
const client = { clientId: 'fxiaoke-prod', orgId: '123e4567-e89b-42d3-a456-426614174000', enterpriseId: 'ea-cyanlog', secret: 'x'.repeat(40) }
const event = { enterpriseId: 'ea-cyanlog', workflowInstanceId: 'instance-1', objectApiName: 'ContractObj', recordId: 'record-1', shipmentDetailId: 'detail-1', taskId: 'task-1', stageId: 'stage-approved', revisionId: 'revision-1' }
const applicant = { employeeId: 'sales-1', name: '销售', phone: '13900000000', departmentName: '销售部' }
const customer = { accountId: 'account-1', name: '客户公司' }
const ready: CrmIntakePreflight = {
  ready: true,
  organization: { orgId: client.orgId, integrationClientId: client.clientId },
  event,
  eventKey: 'a'.repeat(64),
  source: { event, applicant, customer, eventKey: 'a'.repeat(64) },
  normalized: {
    applicant,
    customer,
    sender: { name: '寄件中心', phone: '13800000000', province: '上海市', city: '上海市', county: '浦东新区', address: '张江路88号' },
    recipient: { name: '收件人', phone: '13700000000', province: '广东省', city: '深圳市', county: '南山区', address: '科技园1号' },
    service: { id: 1, name: '顺丰标快', preference: 'standard' },
    cargo: '合同', weight: 1, payment: 'sender_monthly', remark: '',
  },
  missing: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.read.mockResolvedValue('{}')
  mocks.auth.mockReturnValue(client)
  mocks.preflightRequest.mockResolvedValue(ready)
  mocks.create.mockResolvedValue({ accepted: true, created: true, eventKey: ready.eventKey, orderId: 'order-1', orderNo: 'SO-20261106-ABC12345', status: 'awaiting_confirmation', waybill: null, nextAction: 'operator_confirmation' })
})

describe('CRM intake preflight route', () => {
  it('returns normalized readiness without invoking create', async () => {
    const response = await preflightPOST(request('/api/shipping/crm/preflight'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ready: true, organization: { orgId: client.orgId }, normalized: { service: { id: 1 } } })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('returns explicit missing fields when the body schema is incomplete', async () => {
    mocks.preflightRequest.mockResolvedValue({
      ...ready,
      ready: false,
      normalized: null,
      missing: [{ field: 'shipment.recipient.phone', message: '请填写完整信息', issue: 'too_small' }],
    })
    const response = await preflightPOST(request('/api/shipping/crm/preflight'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ready: false,
      event,
      eventKey: ready.eventKey,
      source: { event, applicant, customer, eventKey: ready.eventKey },
      missing: [{ field: 'shipment.recipient.phone' }],
    })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('preserves authentication failures as machine-readable errors', async () => {
    mocks.auth.mockImplementation(() => { throw new CrmIntakeError(401, 'CRM_SIGNATURE_INVALID', 'CRM 请求签名无效。') })
    const response = await preflightPOST(request('/api/shipping/crm/preflight'))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'CRM 请求签名无效。', code: 'CRM_SIGNATURE_INVALID' })
  })
})

describe('CRM intake create-pending route', () => {
  it('returns 202 for an accepted pending order and never exposes a carrier-success claim', async () => {
    const response = await ordersPOST(request('/api/shipping/crm/orders'))
    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({ accepted: true, status: 'awaiting_confirmation', waybill: null, nextAction: 'operator_confirmation' })
    expect(mocks.create).toHaveBeenCalledWith(client, '{}')
  })

  it('returns structured missing fields when the order cannot be prepared', async () => {
    const missing = [{ field: 'sender.phone', message: '请填写完整信息', issue: 'too_small' }]
    mocks.create.mockRejectedValue(new CrmIntakeIncompleteError({ ...ready, ready: false, normalized: null, missing }))
    const response = await ordersPOST(request('/api/shipping/crm/orders'))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'CRM_INTAKE_INCOMPLETE', missing })
  })

  it('returns 409 without replacing an existing event whose payload changed', async () => {
    mocks.create.mockRejectedValue(new CrmIntakeError(409, 'CRM_EVENT_PAYLOAD_CONFLICT', '同一 CRM 事件的内容发生变化，已拒绝覆盖原工单。'))
    const response = await ordersPOST(request('/api/shipping/crm/orders'))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'CRM_EVENT_PAYLOAD_CONFLICT' })
  })
})
