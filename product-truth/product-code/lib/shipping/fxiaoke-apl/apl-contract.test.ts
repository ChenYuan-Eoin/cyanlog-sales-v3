import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type {
  AplHttpRequest,
  AplHttpResult,
  FxiaokeAplEndpoint,
  FxiaokeAplMapping,
  FxiaokeAplRuntime,
} from './contracts'
import {
  canonicalJson,
  CRM_JSON_CANONICALIZATION_HEADER,
  CRM_JSON_CANONICALIZATION_V1,
} from './canonical-json'
import { runFxiaokeAplContract } from './client'
import { fxiaokeAplMappingSchema } from './contracts'
import { buildAplHttpRequest, crmAplSignaturePayload } from './signature'

const secret = '0123456789abcdef0123456789abcdef'

function field(path: string) {
  return { kind: 'field' as const, path, select: 'raw' as const }
}

function reference(path: string, select: 'id' | 'name') {
  return { kind: 'field' as const, path, select }
}

function literal(value: string | number) {
  return { kind: 'literal' as const, value }
}

const mapping: FxiaokeAplMapping = {
  schemaVersion: '1.0',
  enterpriseId: 'ea-cyanlog',
  workflow: {
    objectApiName: 'ContractObj',
    acceptedInstanceStates: ['in_progress'],
    stages: [{ taskId: 'task-1', stageId: 'stage-approved', acceptedTaskStates: ['completed'] }],
  },
  applicant: {
    objectApiName: 'PersonnelObj',
    employeeId: field('_id'),
    name: field('name'),
    phone: field('mobile'),
    departmentId: field('department_id'),
    departmentName: field('department_name'),
  },
  rootObject: {
    objectApiName: 'ContractObj',
    customerId: reference('account__c', 'id'),
    customerName: reference('account__c', 'name'),
    revisionId: field('modified_time'),
  },
  shipmentDetailObject: {
    objectApiName: 'ShipmentDetailObj',
    parentRecordId: reference('contract__c', 'id'),
    shipment: {
      recipient: {
        kind: 'fields',
        name: field('recipient_name'),
        phone: field('recipient_phone'),
        province: field('province'),
        city: field('city'),
        county: field('county'),
        address: field('address'),
      },
      cargo: field('cargo'),
      weight: field('weight'),
      servicePreference: field('service_preference'),
      payment: literal('sender_monthly'),
      remark: literal(''),
    },
  },
}

const endpoint: FxiaokeAplEndpoint = {
  baseUrl: 'https://sales.cyanlog.icu',
  clientId: 'fxiaoke-prod',
  preflightPath: '/api/shipping/crm/preflight',
  createPath: '/api/shipping/crm/orders',
  timeoutMs: 15_000,
  preflightRetryCount: 1,
  createRetryCount: 1,
}

const source = {
  workflowInstanceId: 'instance-1',
  recordId: 'record-1',
  shipmentDetailId: 'detail-1',
  taskId: 'task-1',
}

function success(data: unknown) {
  return { isError: false, errorCode: null, data, message: '' }
}

type RuntimeOptions = {
  instances?: unknown
  task?: unknown
  objects?: Record<string, Record<string, unknown>>
  preflight?: (body: Record<string, unknown>) => unknown
  create?: (body: Record<string, unknown>, call: number) => AplHttpResult
}

function runtime(options: RuntimeOptions = {}) {
  const calls: AplHttpRequest[] = []
  let now = 1_760_000_000
  let createCalls = 0
  const objects = options.objects ?? {
    'ContractObj:record-1': {
      _id: 'record-1',
      account__c: [{ _id: 'account-1', name: '示例客户有限公司' }],
      modified_time: 20261106143000,
    },
    'PersonnelObj:1093': {
      _id: '1093',
      name: '陈源',
      mobile: '13800138000',
      department_id: 'dept-sales',
      department_name: '商务运营部',
    },
    'ShipmentDetailObj:detail-1': {
      _id: 'detail-1',
      contract__c: [{ _id: 'record-1' }],
      recipient_name: '张三',
      recipient_phone: '13900139000',
      province: '上海市',
      city: '上海市',
      county: '浦东新区',
      address: '张江路88号',
      cargo: '合同文件',
      weight: 1.5,
      service_preference: 'standard',
    },
  }
  const instanceData = options.instances ?? success({
    QueryResult: {
      total: 1,
      dateList: [{ instanceId: 'instance-1', workflowName: '寄件审批', state: 'in_progress', applicantId: '1093' }],
    },
  })
  const taskData = options.task ?? success({
    name: '审批通过',
    state: 'completed',
    applicantId: '1093',
    apiName: 'ContractObj',
    dataId: 'record-1',
    candidateIds: ['1093'],
    processIds: [],
    activityInstanceIds: ['stage-approved'],
  })
  const value: FxiaokeAplRuntime = {
    findInstances: () => instanceData,
    findTask: () => taskData,
    findObject: ({ objectApiName, id }) => {
      const record = objects[`${objectApiName}:${id}`]
      if (!record) throw new Error(`missing fixture ${objectApiName}:${id}`)
      return record
    },
    hmacSha256Hex: (hmacSecret, data) => createHmac('sha256', hmacSecret).update(data).digest('hex'),
    nowSeconds: () => now++,
    executeHttp: (request) => {
      calls.push(request)
      const body = JSON.parse(request.rawBody) as Record<string, unknown>
      if (request.pathname === '/api/shipping/crm/preflight') {
        const content = options.preflight?.(body) ?? {
          ready: true,
          event: body.event,
          eventKey: 'a'.repeat(64),
          normalized: { accepted: true },
          missing: [],
        }
        return { statusCode: 200, content }
      }
      createCalls += 1
      return options.create?.(body, createCalls) ?? {
        statusCode: 202,
        content: {
          accepted: true,
          created: true,
          eventKey: 'a'.repeat(64),
          orderId: '00000000-0000-4000-8000-000000000001',
          orderNo: 'SO-20261106-APL00001',
          status: 'awaiting_confirmation',
          waybill: null,
          nextAction: 'operator_confirmation',
        },
      }
    },
  }
  return { value, calls }
}

describe('Fxiaoke APL contract', () => {
  it('uses the exact workflow applicant and derives one source event from exact object reads', async () => {
    const fake = runtime()
    const result = await runFxiaokeAplContract({ runtime: fake.value, mapping, endpoint, secret, source, mode: 'create' })

    expect(result).toMatchObject({
      status: 'created',
      source: {
        workflowInstanceId: 'instance-1',
        recordId: 'record-1',
        shipmentDetailId: 'detail-1',
        taskId: 'task-1',
        stageId: 'stage-approved',
        revisionId: '20261106143000',
        applicantId: '1093',
        customerId: 'account-1',
      },
      receipt: { created: true, status: 'awaiting_confirmation', waybill: null },
    })
    const preflightBody = JSON.parse(fake.calls[0].rawBody)
    expect(preflightBody).toMatchObject({
      event: {
        enterpriseId: 'ea-cyanlog',
        workflowInstanceId: 'instance-1',
        objectApiName: 'ContractObj',
        recordId: 'record-1',
        shipmentDetailId: 'detail-1',
        taskId: 'task-1',
        stageId: 'stage-approved',
        revisionId: '20261106143000',
      },
      applicant: { employeeId: '1093', name: '陈源' },
    })
    expect(fake.calls.map(call => call.pathname)).toEqual([
      '/api/shipping/crm/preflight',
      '/api/shipping/crm/orders',
    ])
    expect(fake.calls[0].rawBody).toBe(fake.calls[1].rawBody)
    expect(fake.calls.every(call => call.retryCount === 0)).toBe(true)
  })

  it('maps a stable approval task name to the configured semantic stage', async () => {
    const fake = runtime()
    const byTaskName: FxiaokeAplMapping = {
      ...mapping,
      workflow: {
        ...mapping.workflow,
        stages: [{ taskName: '审批通过', stageId: 'stage-approved', acceptedTaskStates: ['completed'] }],
      },
    }
    const result = await runFxiaokeAplContract({ runtime: fake.value, mapping: byTaskName, endpoint, secret, source, mode: 'preflight' })

    expect(result).toMatchObject({ status: 'preflight_ready', source: { taskId: 'task-1', stageId: 'stage-approved' } })
    expect(JSON.parse(fake.calls[0].rawBody)).toMatchObject({ event: { taskId: 'task-1', stageId: 'stage-approved' } })
  })

  it('requires exactly one task ID or stable task name per stage', () => {
    for (const stage of [
      { taskId: 'task-1', taskName: '审批通过', stageId: 'stage-approved', acceptedTaskStates: ['completed'] },
      { stageId: 'stage-approved', acceptedTaskStates: ['completed'] },
    ]) {
      const result = fxiaokeAplMappingSchema.safeParse({
        ...mapping,
        workflow: { ...mapping.workflow, stages: [stage] },
      })
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.issues.some(issue => issue.message === 'taskId 与 taskName 必须且只能配置一个')).toBe(true)
    }
  })

  it('stops before create when preflight returns missing fields', async () => {
    const fake = runtime({
      preflight: body => ({
        ready: false,
        event: body.event,
        eventKey: 'a'.repeat(64),
        normalized: null,
        missing: [{ field: 'sender.address', message: '缺少寄件地址', issue: 'too_small' }],
      }),
    })
    const result = await runFxiaokeAplContract({ runtime: fake.value, mapping, endpoint, secret, source, mode: 'create' })

    expect(result).toMatchObject({ status: 'preflight_blocked', preflight: { ready: false } })
    expect(fake.calls).toHaveLength(1)
  })

  it('fails closed when the requested workflow instance is absent or ambiguous', async () => {
    const absent = runtime({ instances: success({ QueryResult: { total: 1, dateList: [{ instanceId: 'other', state: 'in_progress', applicantId: '1093' }] } }) })
    await expect(runFxiaokeAplContract({ runtime: absent.value, mapping, endpoint, secret, source, mode: 'preflight' }))
      .resolves.toMatchObject({ status: 'error', code: 'APL_WORKFLOW_NOT_FOUND', stage: 'resolve' })

    const duplicate = runtime({
      instances: success({
        QueryResult: {
          total: 2,
          dateList: [
            { instanceId: 'instance-1', state: 'in_progress', applicantId: '1093' },
            { instanceId: 'instance-1', state: 'in_progress', applicantId: '1093' },
          ],
        },
      }),
    })
    await expect(runFxiaokeAplContract({ runtime: duplicate.value, mapping, endpoint, secret, source, mode: 'preflight' }))
      .resolves.toMatchObject({ status: 'error', code: 'APL_WORKFLOW_AMBIGUOUS' })
  })

  it('rejects executor identity drift and unmapped tenant fields', async () => {
    const mismatch = runtime({
      task: success({ name: '审批通过', state: 'completed', applicantId: '-10000', apiName: 'ContractObj', dataId: 'record-1' }),
    })
    await expect(runFxiaokeAplContract({ runtime: mismatch.value, mapping, endpoint, secret, source, mode: 'preflight' }))
      .resolves.toMatchObject({ status: 'error', code: 'APL_TASK_APPLICANT_MISMATCH' })

    const missingField = runtime({
      objects: {
        'ContractObj:record-1': { _id: 'record-1', account__c: [{ _id: 'account-1', name: '客户' }], modified_time: 1 },
        'PersonnelObj:1093': { _id: '1093', name: '陈源', mobile: '13800138000', department_id: 'd', department_name: '部门' },
        'ShipmentDetailObj:detail-1': { _id: 'detail-1', contract__c: [{ _id: 'record-1' }], recipient_name: '张三' },
      },
    })
    await expect(runFxiaokeAplContract({ runtime: missingField.value, mapping, endpoint, secret, source, mode: 'preflight' }))
      .resolves.toMatchObject({ status: 'error', code: 'APL_MAPPING_FIELD_MISSING', stage: 'resolve' })
  })

  it('rejects task identity drift before any HTTP call', async () => {
    const fake = runtime({
      task: success({
        taskId: 'other-task',
        name: '审批通过',
        state: 'completed',
        applicantId: '1093',
        apiName: 'ContractObj',
        dataId: 'record-1',
      }),
    })
    const result = await runFxiaokeAplContract({ runtime: fake.value, mapping, endpoint, secret, source, mode: 'create' })

    expect(result).toMatchObject({ status: 'error', code: 'APL_TASK_ID_MISMATCH', stage: 'resolve' })
    expect(fake.calls).toHaveLength(0)
  })

  it('replays the exact raw body when create transport fails and never enables transport retry', async () => {
    const fake = runtime({
      create: (_body, call) => call === 1
        ? { statusCode: 503, content: { code: 'TEMPORARY' } }
        : {
            statusCode: 202,
            content: {
              accepted: true,
              created: false,
              eventKey: 'a'.repeat(64),
              orderId: '00000000-0000-4000-8000-000000000001',
              orderNo: 'SO-20261106-APL00001',
              status: 'awaiting_confirmation',
              waybill: null,
              nextAction: 'operator_confirmation',
            },
          },
    })
    const result = await runFxiaokeAplContract({ runtime: fake.value, mapping, endpoint, secret, source, mode: 'create' })

    expect(result).toMatchObject({ status: 'created', receipt: { created: false } })
    const creates = fake.calls.filter(call => call.pathname === '/api/shipping/crm/orders')
    expect(creates).toHaveLength(2)
    expect(creates[0].rawBody).toBe(creates[1].rawBody)
    expect(creates.every(call => call.retryCount === 0)).toBe(true)
    expect(creates[0].headers['x-shipping-crm-signature']).not.toBe(creates[1].headers['x-shipping-crm-signature'])
  })

  it('does not retry a definitive create conflict', async () => {
    const fake = runtime({ create: () => ({ statusCode: 409, content: { code: 'CRM_EVENT_PAYLOAD_CONFLICT' } }) })
    const result = await runFxiaokeAplContract({ runtime: fake.value, mapping, endpoint, secret, source, mode: 'create' })

    expect(result).toMatchObject({ status: 'error', code: 'APL_HTTP_CREATE_FAILED', stage: 'create', retryable: false })
    expect(fake.calls.filter(call => call.pathname === '/api/shipping/crm/orders')).toHaveLength(1)
  })
})

describe('canonical APL request identity', () => {
  it('sorts keys once and signs a canonical map body with path separation', async () => {
    const rawBody = canonicalJson({ b: 2, a: { z: 'x', y: 1 } })
    expect(rawBody).toBe('{"a":{"y":1,"z":"x"},"b":2}')
    const request = await buildAplHttpRequest({
      endpoint,
      secret,
      pathname: '/api/shipping/crm/preflight',
      rawBody,
      retryCount: 0,
      timestamp: '1760000000',
      hmacSha256Hex: (key, data) => createHmac('sha256', key).update(data).digest('hex'),
    })
    const expectedSignature = createHmac('sha256', secret)
      .update(crmAplSignaturePayload('1760000000', '/api/shipping/crm/preflight', rawBody))
      .digest('hex')
    expect(request.headers['x-shipping-crm-signature']).toBe(`sha256=${expectedSignature}`)
    expect(request.headers[CRM_JSON_CANONICALIZATION_HEADER]).toBe(CRM_JSON_CANONICALIZATION_V1)
    expect(request.headers['Content-Type']).toBe('application/json')
    expect(request.rawBody).toBe(rawBody)
    expect(request.retryCount).toBe(0)

    const createSignature = createHmac('sha256', secret)
      .update(crmAplSignaturePayload('1760000000', '/api/shipping/crm/orders', rawBody))
      .digest('hex')
    expect(createSignature).not.toBe(expectedSignature)
  })
})
