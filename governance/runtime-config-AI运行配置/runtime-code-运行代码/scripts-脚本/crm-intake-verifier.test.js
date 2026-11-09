const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const verifier = require('./crm-intake-verifier.js')

const COMMIT = 'a'.repeat(40)
const DEPLOYMENT = 'dpl_CrmIntakeSelftest'
const ORG_ID = '00000001-0000-0000-0000-000000000000'
const ORDER_ID = '22222222-2222-4222-8222-222222222222'
const ORDER_NO = 'SO-20261109-ABC12345'
const CLIENT_ID = 'fxiaoke-prod'
const SECRET = 's'.repeat(64)
const hash = value => crypto.createHash('sha256').update(value).digest('hex')

const event = {
  enterpriseId: 'ea-cyanlog',
  workflowInstanceId: 'instance-1',
  objectApiName: 'ContractObj',
  recordId: 'record-1',
  shipmentDetailId: 'detail-1',
  taskId: 'task-1',
  stageId: 'stage-approved',
  revisionId: 'revision-1',
}
const applicant = { employeeId: 'sales-1093', name: '销售', phone: '13700000000', departmentId: 'dept-1', departmentName: '销售部' }
const customer = { accountId: 'account-1', name: '客户公司' }
const shipment = {
  recipient: { name: '收件人', phone: '13900000000', province: '浙江省', city: '杭州市', county: '西湖区', address: '文三路1号' },
  cargo: '合同',
  weight: 1,
  servicePreference: 'standard',
  payment: 'sender_monthly',
  remark: '',
}
const requestValue = { event, applicant, customer, shipment }
const rawRequest = JSON.stringify(requestValue)
const payloadHash = hash(verifier.canonicalJson(requestValue))
const eventKey = verifier.eventKeyFor(ORG_ID, CLIENT_ID, event)
const client = { clientId: CLIENT_ID, orgId: ORG_ID, enterpriseId: 'ea-cyanlog', secret: SECRET }

function tempRuntime(t) {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-intake-verifier-test-'))
  t.after(() => fs.rmSync(runtime, { recursive: true, force: true }))
  return runtime
}

function writeJsonArtifact(runtime, name, value, prefix = 'fixtures') {
  const directory = path.join(runtime, prefix)
  fs.mkdirSync(directory, { recursive: true })
  const filename = path.join(directory, name)
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  fs.writeFileSync(filename, bytes)
  return { path: path.relative(runtime, filename), sha256: hash(bytes) }
}

function writeObservation(runtime, overrides = {}) {
  const attachmentPath = path.join(runtime, 'apl-execution-log.json')
  const attachmentBytes = Buffer.from(JSON.stringify({ execution: 'approved-node', trace: 'trace-1' }))
  fs.writeFileSync(attachmentPath, attachmentBytes)
  const value = {
    source: 'fxiaoke_apl_execution_log',
    trust_boundary: 'operator_attestation_not_machine_proof',
    contract_version: verifier.CONTRACT,
    environment: 'production',
    origin: verifier.PRODUCTION_ORIGIN,
    commit: COMMIT,
    deployment_id: DEPLOYMENT,
    observed_at: new Date(Date.now() - 60_000).toISOString(),
    organization_id: ORG_ID,
    integration_client_id: CLIENT_ID,
    event,
    event_key: eventKey,
    applicant_employee_id: applicant.employeeId,
    customer_account_id: customer.accountId,
    preflight_http_status: 200,
    create_http_status: 202,
    created_order_id: ORDER_ID,
    order_no: ORDER_NO,
    order_status: 'awaiting_confirmation',
    waybill: null,
    next_action: 'operator_confirmation',
    carrier_calls_executed: 0,
    attachments: [{ path: 'apl-execution-log.json', sha256: hash(attachmentBytes) }],
    ...overrides,
  }
  const reference = writeJsonArtifact(runtime, 'apl-observation.json', value)
  return { artifact_path: reference.path, sha256: reference.sha256, payload: value }
}

function databaseState(replayCount = 0) {
  return {
    event_count: 1,
    order_count: 1,
    waybill_count: 0,
    tracking_event_count: 0,
    raw_request: rawRequest,
    event: {
      id: '11111111-1111-4111-8111-111111111111',
      org_id: ORG_ID,
      integration_client_id: CLIENT_ID,
      event_key: eventKey,
      payload_hash: payloadHash,
      raw_request: rawRequest,
      enterprise_id: event.enterpriseId,
      workflow_instance_id: event.workflowInstanceId,
      object_api_name: event.objectApiName,
      crm_record_id: event.recordId,
      shipment_detail_id: event.shipmentDetailId,
      task_id: event.taskId,
      stage_id: event.stageId,
      revision_id: event.revisionId,
      applicant_snapshot: applicant,
      customer_snapshot: customer,
      shipping_order_id: ORDER_ID,
      replay_count: replayCount,
      last_replayed_at: replayCount ? new Date().toISOString() : null,
    },
    order: {
      id: ORDER_ID,
      org_id: ORG_ID,
      order_no: ORDER_NO,
      payload_hash: payloadHash,
      status: 'awaiting_confirmation',
      intake_source: 'crm',
      confirmation_policy: 'scheduled_review',
      sales_ref: applicant.employeeId,
      customer_ref: customer.accountId,
      created_by: null,
      provider_order_id: null,
      identity_snapshot: { provider: 'fxiaoke', integrationClientId: CLIENT_ID, applicant },
    },
  }
}

function productionRequestLog() {
  const calls = []
  const request = async (url, init) => {
    const parsed = new URL(url)
    const timestamp = init.headers['x-shipping-crm-timestamp']
    const expected = `sha256=${verifier.signedRequest(SECRET, timestamp, init.method, parsed.pathname, init.body)}`
    assert.equal(init.headers['x-shipping-crm-signature'], expected)
    assert.equal(init.headers['x-shipping-crm-canonicalization'], 'crm-json-v1')
    calls.push({ pathname: parsed.pathname, body: init.body })
    if (parsed.pathname === '/api/shipping/crm/preflight') {
      return new Response(JSON.stringify({ ready: true, eventKey, event, missing: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (parsed.pathname === '/api/shipping/crm/orders') {
      return new Response(JSON.stringify({ accepted: true, created: false, eventKey, orderId: ORDER_ID, orderNo: ORDER_NO, status: 'awaiting_confirmation', waybill: null, nextAction: 'operator_confirmation' }), { status: 202, headers: { 'content-type': 'application/json' } })
    }
    throw new Error(`Unexpected request ${parsed.pathname}`)
  }
  return { request, calls }
}

test('scoped CRM contract accepts only the four canonical intake proofs and approved pending-order writes', () => {
  const status = {
    activeId: 'WP97', featureId: 'F054', runtimeProfile: 'shipping_workspace', runtimeContractVersion: verifier.CONTRACT,
    targetState: 'production_released', productionDatabaseMode: 'controlled_write_approved',
    productionReleaseAuthorization: {
      status: 'approved_for_final_release', production_database_write_authorized: true,
      carrier_calls_authorized: false, organization_sync_authorized: false, identity_or_role_change_authorized: false,
    },
    requiredRuntimeEvidence: [...verifier.ITEMS], requiredProductionRuntimeEvidence: [...verifier.ITEMS],
  }
  assert.deepEqual(verifier.contractScopeBlockers(status), [])
  for (const mutate of [
    value => { value.activeId = 'WP92' },
    value => { value.runtimeContractVersion = 'f054-v2' },
    value => { value.productionReleaseAuthorization.carrier_calls_authorized = true },
    value => { value.requiredRuntimeEvidence = ['shipping_workspace', ...verifier.ITEMS] },
    value => { value.requiredProductionRuntimeEvidence = verifier.ITEMS.slice(1) },
  ]) {
    const invalid = structuredClone(status)
    mutate(invalid)
    assert.ok(verifier.contractScopeBlockers(invalid).length)
  }
})

test('APL observation must be fresh, hash-bound, event-key exact, pending and carrier-free', t => {
  const runtime = tempRuntime(t)
  const valid = writeObservation(runtime)
  assert.deepEqual(verifier.observationBlockers(valid.payload, { runtime, commit: COMMIT, deploymentId: DEPLOYMENT }), [])

  const wrongKey = writeObservation(runtime, { event_key: 'b'.repeat(64) })
  assert.match(verifier.observationBlockers(wrongKey.payload, { runtime, commit: COMMIT, deploymentId: DEPLOYMENT }).join(';'), /event key mismatch/)

  const carrierCalled = writeObservation(runtime, { carrier_calls_executed: 1 })
  assert.match(verifier.observationBlockers(carrierCalled.payload, { runtime, commit: COMMIT, deploymentId: DEPLOYMENT }).join(';'), /carrier call/)

  const unknownField = writeObservation(runtime, { database_query: 'select * from secrets' })
  assert.match(verifier.observationBlockers(unknownField.payload, { runtime, commit: COMMIT, deploymentId: DEPLOYMENT }).join(';'), /Unapproved field in CRM APL observation/)

  const tampered = writeObservation(runtime)
  fs.writeFileSync(path.join(runtime, 'apl-execution-log.json'), 'tampered')
  assert.match(verifier.observationBlockers(tampered.payload, { runtime, commit: COMMIT, deploymentId: DEPLOYMENT }).join(';'), /attachment hash mismatch/)
})

test('database evidence requires one exact event/order and rejects source, payload, identity, status and waybill drift', () => {
  const observation = writeObservation(tempRuntime({ after: () => {} }))
  const parsed = {
    applicantEmployeeId: applicant.employeeId,
    customerAccountId: customer.accountId,
    payloadHash,
    rawRequestSha256: hash(rawRequest),
  }
  assert.deepEqual(verifier.databaseBlockers(databaseState(), observation.payload, parsed, 'initial read'), [])
  for (const [label, mutate, expected] of [
    ['duplicate event', value => { value.event_count = 2 }, /exactly one event\/order/],
    ['duplicate order', value => { value.order_count = 2 }, /exactly one event\/order/],
    ['workflow identity', value => { value.event.revision_id = 'revision-2' }, /workflow\/task\/stage\/revision mismatch/],
    ['payload hash', value => { value.order.payload_hash = 'c'.repeat(64) }, /payload hash mismatch/],
    ['applicant', value => { value.event.applicant_snapshot.employeeId = 'other' }, /applicant identity mismatch/],
    ['customer', value => { value.event.customer_snapshot.accountId = 'other' }, /customer identity mismatch/],
    ['status', value => { value.order.status = 'waybill_created' }, /not awaiting confirmation/],
    ['waybill', value => { value.waybill_count = 1 }, /waybill or tracking event/],
  ]) {
    const invalid = structuredClone(databaseState())
    mutate(invalid)
    assert.match(verifier.databaseBlockers(invalid, observation.payload, parsed, 'test').join(';'), expected, label)
  }
})

test('Production verifier executes signed preflight and exact replay without creating another order or calling a carrier', async t => {
  const runtime = tempRuntime(t)
  const observation = writeObservation(runtime)
  const { request, calls } = productionRequestLog()
  let queryCount = 0
  const databaseQuery = async sql => {
    assert.match(sql, /shipping_crm_intake_events/)
    assert.match(sql, new RegExp(ORG_ID))
    assert.match(sql, new RegExp(CLIENT_ID))
    queryCount += 1
    return databaseState(queryCount === 1 ? 0 : 1)
  }

  const result = await verifier.verifyProduction({
    runtime, observation, clients: [client], commit: COMMIT, deploymentId: DEPLOYMENT, request, databaseQuery,
  })
  assert.deepEqual(calls.map(call => call.pathname), ['/api/shipping/crm/preflight', '/api/shipping/crm/orders'])
  assert.equal(calls.every(call => call.body === rawRequest), true)
  assert.equal(queryCount, 2)
  assert.equal(result.crm_unique_pending_workorder.payload.event_count, 1)
  assert.equal(result.crm_unique_pending_workorder.payload.order_count, 1)
  assert.equal(result.crm_repeat_same_workorder.payload.same_order, true)
  assert.equal(result.crm_repeat_same_workorder.payload.replay_count_after, 1)
  assert.equal(result.crm_waybill_null.payload.waybill, null)
  assert.equal(result.crm_waybill_null.payload.carrier_calls_executed, 0)
  assert.deepEqual(verifier.productionEvidenceBlockers(result, { commit: COMMIT, deploymentId: DEPLOYMENT }), [])
})

test('Production verifier rejects a changed replay result and a non-durable replay', async t => {
  const runtime = tempRuntime(t)
  const observation = writeObservation(runtime)
  const { request } = productionRequestLog()

  await assert.rejects(verifier.verifyProduction({
    runtime, observation, clients: [client], commit: COMMIT, deploymentId: DEPLOYMENT, request,
    databaseQuery: async () => databaseState(0),
  }), /not durably audited/)

  const changedRequest = async (url, init) => {
    if (url.endsWith('/preflight')) return new Response(JSON.stringify({ ready: true, eventKey, event, missing: [] }), { status: 200 })
    return new Response(JSON.stringify({ accepted: true, created: true, eventKey, orderId: ORDER_ID, orderNo: ORDER_NO, status: 'awaiting_confirmation', waybill: null, nextAction: 'operator_confirmation' }), { status: 202 })
  }
  let reads = 0
  await assert.rejects(verifier.verifyProduction({
    runtime, observation, clients: [client], commit: COMMIT, deploymentId: DEPLOYMENT, request: changedRequest,
    databaseQuery: async () => databaseState(reads++ === 0 ? 0 : 1),
  }), /did not return the original pending order/)
})

test('Production evidence rejects duplicate counts, waybill/tracking/carrier leakage and cross-binding changes', async t => {
  const runtime = tempRuntime(t)
  const observation = writeObservation(runtime)
  const { request } = productionRequestLog()
  let reads = 0
  const result = await verifier.verifyProduction({
    runtime, observation, clients: [client], commit: COMMIT, deploymentId: DEPLOYMENT, request,
    databaseQuery: async () => databaseState(reads++ === 0 ? 0 : 1),
  })
  assert.deepEqual(verifier.productionEvidenceBlockers(result, { commit: COMMIT, deploymentId: DEPLOYMENT }), [])
  for (const [label, mutate, expected] of [
    ['duplicate event', value => { value.crm_unique_pending_workorder.payload.event_count = 2 }, /unique pending-order/],
    ['waybill row', value => { value.crm_waybill_null.payload.waybill_rows = 1 }, /no-waybill/],
    ['tracking event', value => { value.crm_waybill_null.payload.tracking_events = 1 }, /no-waybill/],
    ['carrier call', value => { value.crm_waybill_null.payload.carrier_calls_executed = 1 }, /no-waybill/],
    ['order binding', value => { value.crm_repeat_same_workorder.payload.order_id = '33333333-3333-4333-8333-333333333333' }, /cross-binding/],
  ]) {
    const invalid = structuredClone(result)
    mutate(invalid)
    assert.match(verifier.productionEvidenceBlockers(invalid, { commit: COMMIT, deploymentId: DEPLOYMENT }).join(';'), expected, label)
  }
})

test('Preview verifier proves signed preflight and fail-closed rejection with zero business mutations', async t => {
  const runtime = tempRuntime(t)
  const origin = 'https://crm-intake-preview.vercel.app'
  const calls = []
  const request = async (url, init) => {
    const pathname = new URL(url).pathname
    calls.push({ pathname, body: init.body })
    if (pathname === '/api/shipping/crm/preflight') {
      return new Response(JSON.stringify({ ready: true, eventKey, event, missing: [] }), { status: 200 })
    }
    return new Response(JSON.stringify({ code: 'CRM_INTAKE_INCOMPLETE' }), { status: 422 })
  }
  const result = await verifier.verifyPreview({
    runtime, origin, commit: COMMIT, deploymentId: DEPLOYMENT, rawBody: rawRequest, client, request,
    migrationEvidence: { commit: COMMIT, migration_test_passed: true, replay_test_passed: true, no_carrier_test_passed: true },
  })
  assert.deepEqual(calls.map(call => call.pathname), ['/api/shipping/crm/preflight', '/api/shipping/crm/orders', '/api/shipping/crm/orders'])
  assert.deepEqual(verifier.previewEvidenceBlockers(result.runtimeEvidence, 'preview', { commit: COMMIT, deploymentId: DEPLOYMENT }), [])
  assert.equal(result.runtimeEvidence.crm_waybill_null.payload.business_mutations, 0)
  assert.equal(result.replayContract.payload.no_business_mutation, true)
})

test('signed request binds canonical content, timestamp, method and path', () => {
  const reordered = JSON.stringify({ shipment, customer, applicant, event })
  assert.equal(verifier.signedRequest(SECRET, '1760000000', 'POST', '/api/shipping/crm/preflight', rawRequest), verifier.signedRequest(SECRET, '1760000000', 'POST', '/api/shipping/crm/preflight', reordered))
  assert.notEqual(verifier.signedRequest(SECRET, '1760000000', 'POST', '/api/shipping/crm/preflight', rawRequest), verifier.signedRequest(SECRET, '1760000001', 'POST', '/api/shipping/crm/preflight', rawRequest))
  assert.notEqual(verifier.signedRequest(SECRET, '1760000000', 'POST', '/api/shipping/crm/preflight', rawRequest), verifier.signedRequest(SECRET, '1760000000', 'POST', '/api/shipping/crm/orders', rawRequest))
})
