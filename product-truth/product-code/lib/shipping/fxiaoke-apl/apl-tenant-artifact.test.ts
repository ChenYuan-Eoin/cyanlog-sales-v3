import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CRM_JSON_CANONICALIZATION_HEADER } from './canonical-json'
import { fxiaokeAplEndpointSchema, fxiaokeAplMappingSchema } from './contracts'

const root = join(process.cwd(), 'lib/shipping/fxiaoke-apl/tenant')
const source = readFileSync(join(root, 'fxiaoke-approval-intake.groovy'), 'utf8')
const exampleText = readFileSync(join(root, 'fxiaoke-approval-intake.example.json'), 'utf8')
const example = JSON.parse(exampleText) as {
  endpoint: Record<string, unknown> & { clientSecret: string }
  mode: string
  environment: string
  workflow: Record<string, unknown>
  rootObject: Record<string, unknown>
  shipmentDetailObject: Record<string, unknown>
}
const { endpoint: _endpoint, mode: _mode, environment: _environment, ...mappingExample } = example
const { clientSecret: _clientSecret, ...reviewableEndpoint } = example.endpoint
const reviewableExample = {
  ...mappingExample,
  workflow: { ...example.workflow, objectApiName: 'WorkflowObj' },
  rootObject: { ...example.rootObject, objectApiName: 'WorkflowObj' },
  shipmentDetailObject: {
    ...example.shipmentDetailObject,
    objectApiName: 'ShipmentDetailObj',
    parentRecordId: { kind: 'field', path: 'workflow__c', select: 'id' },
  },
}

describe('Fxiaoke approval intake APL tenant artifact', () => {
  it('keeps the reviewed mapping and endpoint shapes valid', () => {
    const mappingResult = fxiaokeAplMappingSchema.safeParse(reviewableExample)
    expect(mappingResult.success, mappingResult.success ? undefined : JSON.stringify(mappingResult.error.issues)).toBe(true)
    const endpointResult = fxiaokeAplEndpointSchema.safeParse({ ...reviewableEndpoint, clientId: 'fxiaoke-prod' })
    expect(endpointResult.success, endpointResult.success ? undefined : JSON.stringify(endpointResult.error.issues)).toBe(true)
  })

  it('never depends on unavailable context details or ships a real secret', () => {
    expect(source).not.toContain('context.details')
    expect(source).toContain("REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS")
    expect(source).not.toMatch(/\b[a-f0-9]{64}\b/i)
    expect(example.endpoint.clientSecret).toContain('REPLACE_WITH_')
  })

  it('re-reads exact provider identity and binding before any HTTP call', () => {
    const identityReads = [
      'Fx.bpm.findInstances',
      'Fx.bpm.findTaskList',
      'Fx.bpm.findTask(',
      'Fx.object.findById(',
      'Fx.object.find(',
    ].map(marker => source.indexOf(marker))
    const firstIcuCall = source.indexOf('callIcu(')
    expect(identityReads.every(index => index >= 0)).toBe(true)
    expect(identityReads.every(index => index < firstIcuCall)).toBe(true)
    expect(source).toContain("if (applicantId == '-10000')")
    expect(source).toContain('APL_DETAIL_PARENT_MISMATCH')
    expect(source).toContain('Object instanceEnvelopeRaw = Fx.bpm.findInstances')
    expect(source).toContain('Object taskListEnvelopeRaw = Fx.bpm.findTaskList')
    expect(source).toContain('Object taskEnvelopeRaw = Fx.bpm.findTask(')
    expect(source).toContain("instanceEnvelope['isError'] == true")
    expect(source).toContain("taskListEnvelope['isError'] == true")
    expect(source).toContain("taskEnvelope['isError'] == true")
    expect(source).not.toContain('def (Object taskError')
    const firstHttp = source.indexOf('Fx.http.execute')
    ;[
      'applicantName = requiredBoundedText',
      'applicantPhone = requiredPhone',
      'applicantDepartmentName = requiredBoundedText',
      'APL_DETAIL_PARENT_MISMATCH',
      'APL_VALUE_INVALID',
    ].forEach(marker => expect(source.indexOf(marker)).toBeLessThan(firstHttp))
  })

  it('works from approval context without relying on optional context.arg', () => {
    expect(source).toContain('Object rawArg = context.arg')
    expect(source).toContain('rawArg instanceof Map ? rawArg as Map : [:]')
    expect(source).toContain("String recordId = identifier(contextRecord['_id'], 'context.data._id')")
    expect(source).toContain("contextRecord['object_describe_api_name']")
    expect(source).toContain("String configuredTaskName = safeText(stage['taskName'])")
    expect(source).toContain('String shipmentDetailId = shipmentDetailIdArg.isEmpty()')
    expect(source).toContain('QueryOperator.EQ(recordId)')
    expect(source).toContain("fail('APL_DETAIL_AMBIGUOUS', '审批记录必须且只能关联一条寄件明细')")
    expect(source).not.toContain('context.details')
  })

  it('uses one canonical body for path-isolated signed requests', () => {
    expect(source).toContain("def CANONICALIZATION = 'crm-json-v1'")
    expect(source).toContain("String payloadText = canonicalJson(payload)")
    expect(source).toContain("CANONICALIZATION + '\\n' + timestamp + '\\nPOST\\n' + path + '\\n' + payloadText")
    expect(source).toContain(`.header(CANONICALIZATION_HEADER, CANONICALIZATION)`)
    expect(source).toContain("CANONICALIZATION_HEADER = 'x-shipping-crm-canonicalization'")
    expect(CRM_JSON_CANONICALIZATION_HEADER).toBe('x-shipping-crm-canonicalization')
    expect(source).toContain('.body(StringBody.builder().content(payload).build())')
    expect(source).not.toContain('.content(payloadText)')
    expect(source).toContain('Fx.crypto.SHA.sha256HMAC')
    expect(source).toContain('Fx.crypto.hex.encode(digest)')
  })

  it('preflights before create and accepts only a pending order without a waybill', () => {
    expect(source.indexOf("safeText(CONFIG['endpoint']['preflightPath'])"))
      .toBeLessThan(source.indexOf("safeText(CONFIG['endpoint']['createPath'])"))
    expect(source).toContain("return [status: 'preflight_blocked', eventKey: preflightEventKey, missing: missing]")
    expect(source).toContain("safeText(receipt['status']) != 'awaiting_confirmation'")
    expect(source).toContain("!receipt.containsKey('waybill') || receipt['waybill'] != null")
    expect(source).toContain("safeText(receipt['nextAction']) != 'operator_confirmation'")
    expect(source).not.toMatch(/SF_EXPRESS|shipment\/orders|waybill_created/i)
  })
})
