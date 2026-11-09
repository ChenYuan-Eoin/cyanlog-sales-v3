// WP97 accepts CRM approvals through a signed server-to-server gateway. This
// verifier reads the exact production event/order evidence, performs a signed
// read-only preflight, replays the same event through the create endpoint, and
// proves that the replay returned the original pending order without a waybill.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const CONTRACT = 'f054-crm-intake-v1'
const ITEMS = Object.freeze([
  'crm_preflight',
  'crm_unique_pending_workorder',
  'crm_repeat_same_workorder',
  'crm_waybill_null',
])
const PREVIEW_ACTIONS = Object.freeze([
  'signed_preflight',
  'reject_incomplete_create',
  'replay_incomplete_create',
  'verify_no_business_mutation',
])
const PRODUCTION_ACTIONS = Object.freeze([
  'read_apl_execution_evidence',
  'signed_preflight',
  'read_existing_pending_workorder',
  'signed_exact_replay',
  'read_back_same_workorder',
  'verify_no_carrier_call',
])
const PRODUCTION_ORIGIN = 'https://sales.cyanlog.icu'
const PROJECT_REF = 'wfawwhphfqqwfwrrkogy'
const PREFIX = 'production-runtime-verifier'
const HASH = /^[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/
const OBJECT_API = /^[A-Za-z][A-Za-z0-9_]*$/
const EVENT_FIELDS = Object.freeze([
  'enterpriseId',
  'workflowInstanceId',
  'objectApiName',
  'recordId',
  'shipmentDetailId',
  'taskId',
  'stageId',
  'revisionId',
])
const OBSERVATION_FIELDS = Object.freeze([
  'source',
  'trust_boundary',
  'contract_version',
  'environment',
  'origin',
  'commit',
  'deployment_id',
  'observed_at',
  'organization_id',
  'integration_client_id',
  'event',
  'event_key',
  'applicant_employee_id',
  'customer_account_id',
  'preflight_http_status',
  'create_http_status',
  'created_order_id',
  'order_no',
  'order_status',
  'waybill',
  'next_action',
  'carrier_calls_executed',
  'attachments',
])

// A user-approved ordering exception never closes the real APL business gate.
function productionFirstExceptionBlockers({ approval, activeId, contractVersion, productTree, changedPaths, candidateIsAncestor } = {}) {
  const errors = []
  if (activeId !== 'WP97' || contractVersion !== CONTRACT) errors.push('CRM ordering exception is limited to WP97')
  if (approval?.type !== 'final_production_release_authorization' || approval?.source !== 'user_explicit' || approval?.state !== 'approved' || approval?.preview_order_exception !== true) errors.push('CRM ordering exception requires explicit user approval')
  if (approval?.preview_status !== 'not_passed' || approval?.business_acceptance_deferred !== true) errors.push('CRM exception must preserve unpassed Preview and deferred APL acceptance')
  if (!COMMIT.test(approval?.approved_candidate || '') || candidateIsAncestor !== true) errors.push('CRM exception requires approved candidate ancestry')
  if (!COMMIT.test(approval?.approved_product_tree || '') || productTree !== approval.approved_product_tree) errors.push('CRM exception cannot change approved product code')
  if (!COMMIT.test(approval?.rollback_commit || '')) errors.push('CRM exception requires a rollback commit')
  const allowed = new Set([
    'governance/runtime-state/active-task.json', 'governance/runtime-state/demand-inbox.jsonl',
    ...['project-registry.js', 'crm-intake-verifier.js', 'crm-intake-verifier.test.js'].map(name => `governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/${name}`),
  ])
  if (!Array.isArray(changedPaths) || changedPaths.some(file => !allowed.has(file))) errors.push('CRM exception only permits scoped delivery records')
  if (approval?.production_migration_authorized !== true && !(approval?.production_migration_authorized === false && approval?.production_database_write_authorized === false)) errors.push('CRM release requires migration authorization or an explicit no-database-write scope')
  for (const flag of ['fxiaoke_interaction_authorized', 'business_order_creation_authorized', 'carrier_calls_authorized', 'identity_or_role_change_authorized']) {
    if (approval?.[flag] !== false) errors.push(`CRM release exception must exclude ${flag}`)
  }
  return errors
}

function check(condition, message) {
  if (!condition) throw Error(message)
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  }
  return value
}

function canonicalJson(value) {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    check(Number.isFinite(value), 'Canonical JSON cannot contain a non-finite number')
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  check(value && typeof value === 'object', 'Canonical JSON requires a JSON value')
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
const sha = value => crypto.createHash('sha256').update(value).digest('hex')
const json = value => `${JSON.stringify(value, null, 2)}\n`

function strictKeys(value, allowed, label) {
  check(value && typeof value === 'object' && !Array.isArray(value), `Invalid ${label}`)
  check(Object.keys(value).every(key => allowed.includes(key)), `Unapproved field in ${label}`)
}

function requiredText(value, label, max = 200) {
  check(typeof value === 'string' && value.trim() && value.length <= max, `Invalid ${label}`)
  return value
}

function validTime(value) {
  const parsed = Date.parse(value || '')
  check(Number.isFinite(parsed), 'Valid observation timestamp required')
  return parsed
}

function fresh(value, now = Date.now()) {
  const parsed = validTime(value)
  check(parsed <= now + 60000 && now - parsed <= 2 * 3600000, 'CRM evidence observation must be fresh')
  return parsed
}

function normalizeEvent(value) {
  strictKeys(value, EVENT_FIELDS, 'CRM event identity')
  const event = Object.fromEntries(EVENT_FIELDS.map(field => [field, requiredText(value[field], `event.${field}`, 160)]))
  check(OBJECT_API.test(event.objectApiName), 'CRM workflow object API name is invalid')
  return event
}

function eventKeyFor(orgId, clientId, event) {
  return sha(JSON.stringify({ orgId, clientId, event: normalizeEvent(event) }))
}

function parseRawRequest(rawRequest) {
  let decoded
  try {
    decoded = JSON.parse(rawRequest)
  } catch {
    throw Error('CRM raw request is not valid JSON')
  }
  strictKeys(decoded, ['event', 'applicant', 'customer', 'shipment'], 'CRM request')
  const event = normalizeEvent(decoded.event)
  strictKeys(decoded.applicant, ['employeeId', 'name', 'phone', 'departmentId', 'departmentName'], 'CRM applicant')
  strictKeys(decoded.customer, ['accountId', 'name'], 'CRM customer')
  requiredText(decoded.applicant.employeeId, 'applicant.employeeId', 160)
  requiredText(decoded.customer.accountId, 'customer.accountId', 160)
  check(decoded.shipment && typeof decoded.shipment === 'object' && !Array.isArray(decoded.shipment), 'CRM shipment is required')
  return {
    value: decoded,
    event,
    applicantEmployeeId: decoded.applicant.employeeId,
    customerAccountId: decoded.customer.accountId,
    payloadHash: sha(canonicalJson(decoded)),
    rawRequestSha256: sha(rawRequest),
  }
}

function readArtifact(runtime, reference) {
  check(reference && typeof reference.artifact_path === 'string' && HASH.test(reference.sha256 || ''), 'Invalid CRM evidence envelope')
  const base = fs.realpathSync(runtime)
  const resolved = fs.realpathSync(path.resolve(base, reference.artifact_path))
  check(resolved.startsWith(`${base}${path.sep}`) && path.extname(resolved).toLowerCase() === '.json', 'CRM artifact must be scoped JSON')
  const stat = fs.statSync(resolved)
  check(stat.isFile() && stat.size > 0 && stat.size <= 256 * 1024, 'Invalid CRM artifact size')
  const bytes = fs.readFileSync(resolved)
  check(sha(bytes) === reference.sha256, 'CRM artifact hash mismatch')
  const value = JSON.parse(bytes.toString('utf8'))
  check(same(value, reference.payload), 'CRM envelope payload mismatch')
  return { bytes, value, resolved }
}

function readAttachment(runtime, reference) {
  check(reference && typeof reference.path === 'string' && HASH.test(reference.sha256 || ''), 'Invalid CRM attachment reference')
  const base = fs.realpathSync(runtime)
  const resolved = fs.realpathSync(path.resolve(base, reference.path))
  check(resolved.startsWith(`${base}${path.sep}`), 'CRM attachment must be scoped to the runtime directory')
  const stat = fs.statSync(resolved)
  check(stat.isFile() && stat.size > 0 && stat.size <= 2 * 1024 * 1024, 'Invalid CRM attachment size')
  const bytes = fs.readFileSync(resolved)
  check(sha(bytes) === reference.sha256, `CRM attachment hash mismatch: ${reference.path}`)
  return { bytes, resolved }
}

function writeArtifact(runtime, prefix, name, value) {
  const directory = path.join(fs.realpathSync(runtime), prefix)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const filename = path.join(directory, name)
  const bytes = Buffer.from(json(value))
  fs.writeFileSync(filename, bytes, { mode: 0o600 })
  return {
    reference: { path: path.relative(fs.realpathSync(runtime), filename), sha256: sha(bytes) },
    bytes,
  }
}

function makeEnvelope(runtime, prefix, name, payload) {
  const { reference } = writeArtifact(runtime, prefix, `${name}.json`, payload)
  return { artifact_path: reference.path, sha256: reference.sha256, payload }
}

function commonBlockers(payload, expected, context = 'CRM evidence') {
  const errors = []
  if (payload?.contract_version !== CONTRACT || payload.environment !== 'production') errors.push(`${context} contract/environment mismatch`)
  if (payload?.origin !== PRODUCTION_ORIGIN) errors.push(`${context} must use the Production origin`)
  if (payload?.commit !== expected.commit || payload?.deployment_id !== expected.deploymentId) errors.push(`${context} is not bound to the released commit/deployment`)
  return errors
}

function contractScopeBlockers(status) {
  const errors = []
  if (status.activeId !== 'WP97' || status.featureId !== 'F054' || status.runtimeProfile !== 'shipping_workspace' || status.runtimeContractVersion !== CONTRACT) {
    errors.push('CRM intake verifier requires the scoped WP97/F054 shipping_workspace contract')
  }
  const authorization = status.productionReleaseAuthorization
  if (
    status.targetState !== 'production_released'
    || status.productionDatabaseMode !== 'controlled_write_approved'
    || authorization?.status !== 'approved_for_final_release'
    || authorization?.production_database_write_authorized !== true
    || authorization?.carrier_calls_authorized !== false
    || authorization?.organization_sync_authorized !== false
    || authorization?.identity_or_role_change_authorized !== false
  ) {
    errors.push('CRM intake verifier requires controlled pending-order writes without carrier, organization, identity, or role authority')
  }
  if (JSON.stringify(status.requiredRuntimeEvidence) !== JSON.stringify(ITEMS)
    || JSON.stringify(status.requiredProductionRuntimeEvidence) !== JSON.stringify(ITEMS)) {
    errors.push('CRM intake Production evidence must contain only the four scoped CRM proofs')
  }
  return errors
}

function observationBlockers(payload, expected) {
  const errors = []
  try { strictKeys(payload, OBSERVATION_FIELDS, 'CRM APL observation') } catch (error) { errors.push(error.message) }
  errors.push(...commonBlockers(payload, expected, 'CRM APL observation'))
  if (payload?.source !== 'fxiaoke_apl_execution_log' || payload?.trust_boundary !== 'operator_attestation_not_machine_proof') {
    errors.push('CRM APL observation source/trust boundary is missing')
  }
  try { fresh(payload?.observed_at) } catch (error) { errors.push(error.message) }
  try {
    const event = normalizeEvent(payload?.event)
    if (payload.event_key !== eventKeyFor(payload.organization_id, payload.integration_client_id, event)) errors.push('CRM APL observation event key mismatch')
  } catch (error) { errors.push(error.message) }
  if (!UUID.test(payload?.organization_id || '') || !CLIENT_ID.test(payload?.integration_client_id || '')) errors.push('CRM APL organization/client identity is invalid')
  try { requiredText(payload?.applicant_employee_id, 'applicant_employee_id', 160) } catch (error) { errors.push(error.message) }
  try { requiredText(payload?.customer_account_id, 'customer_account_id', 160) } catch (error) { errors.push(error.message) }
  if (payload?.preflight_http_status !== 200 || payload?.create_http_status !== 202) errors.push('CRM APL HTTP outcome is incomplete')
  if (!UUID.test(payload?.created_order_id || '') || !/^SO-[0-9]{8}-[A-Z0-9]{8}$/.test(payload?.order_no || '')) errors.push('CRM APL order identity is invalid')
  if (payload?.order_status !== 'awaiting_confirmation' || payload?.waybill !== null || payload?.next_action !== 'operator_confirmation') errors.push('CRM APL did not observe the required pending order state')
  if (payload?.carrier_calls_executed !== 0) errors.push('CRM APL reports a carrier call')
  if (!Array.isArray(payload?.attachments) || payload.attachments.length === 0) errors.push('CRM APL raw evidence attachment is required')
  else {
    for (const reference of payload.attachments) {
      try { readAttachment(expected.runtime, reference) } catch (error) { errors.push(error.message) }
    }
  }
  return errors
}

function previewEvidenceBlockers(section, environment, expected = {}) {
  const errors = []
  for (const item of ITEMS) {
    const value = section?.[item]?.payload
    if (!value) {
      errors.push(`Preview CRM evidence missing: ${item}`)
      continue
    }
    if (value.contract_version !== CONTRACT || !['preview', 'sandbox'].includes(value.environment) || value.environment !== environment) errors.push(`Preview CRM contract/environment mismatch: ${item}`)
    if (!COMMIT.test(value.commit || '') || !expected.commit || value.commit !== expected.commit) errors.push(`Preview CRM commit mismatch: ${item}`)
    if (!/^dpl_[A-Za-z0-9]+$/.test(value.deployment_id || '') || (expected.deploymentId && value.deployment_id !== expected.deploymentId)) errors.push(`Preview CRM deployment mismatch: ${item}`)
    if (value.production_claimed !== false || value.business_mutations !== 0) errors.push(`Preview CRM evidence must not claim Production business completion: ${item}`)
  }
  const preflight = section?.crm_preflight?.payload
  if (preflight && (preflight.source !== 'live_preview_crm_intake_verifier' || preflight.http_status !== 200 || preflight.ready !== true || preflight.signature_verified !== true || preflight.missing_count !== 0)) {
    errors.push('Preview CRM signed preflight proof is incomplete')
  }
  const unique = section?.crm_unique_pending_workorder?.payload
  if (unique && (unique.source !== 'isolated_migration_test' || unique.migration_test_passed !== true || unique.event_count !== 1 || unique.order_count !== 1 || unique.status !== 'awaiting_confirmation')) {
    errors.push('Preview CRM unique pending-order migration proof is incomplete')
  }
  const replay = section?.crm_repeat_same_workorder?.payload
  if (replay && (replay.source !== 'isolated_migration_test' || replay.replay_test_passed !== true || replay.created !== false || replay.same_order !== true || replay.event_count !== 1 || replay.order_count !== 1 || !(replay.replay_count >= 1))) {
    errors.push('Preview CRM replay migration proof is incomplete')
  }
  const waybill = section?.crm_waybill_null?.payload
  if (waybill && (waybill.source !== 'isolated_contract_assertion' || waybill.waybill !== null || waybill.waybill_rows !== 0 || waybill.tracking_events !== 0 || waybill.carrier_calls_executed !== 0)) {
    errors.push('Preview CRM no-waybill proof is incomplete')
  }
  return errors
}

function productionEvidenceBlockers(section, expected) {
  const errors = []
  for (const item of ITEMS) {
    const payload = section?.[item]?.payload
    if (!payload) {
      errors.push(`CRM Production evidence missing: ${item}`)
      continue
    }
    errors.push(...commonBlockers(payload, expected, `CRM Production ${item}`))
  }
  const preflight = section?.crm_preflight?.payload
  const unique = section?.crm_unique_pending_workorder?.payload
  const replay = section?.crm_repeat_same_workorder?.payload
  const waybill = section?.crm_waybill_null?.payload
  const verifier = section?.verifier?.payload
  if (!preflight || !unique || !replay || !waybill) return errors
  if (!verifier || verifier.source !== 'live_crm_intake_verifier' || verifier.result !== 'pass'
    || JSON.stringify(verifier.actions) !== JSON.stringify(PRODUCTION_ACTIONS)
    || !Array.isArray(verifier.attachments) || verifier.attachments.length === 0) {
    errors.push('CRM Production verifier receipt is incomplete')
  }

  const observationHash = unique.source_observation_sha256
  if (!HASH.test(observationHash || '')) errors.push('CRM Production evidence is not bound to an APL observation')
  for (const payload of [preflight, unique, replay, waybill]) {
    if (payload.event_key !== unique.event_key || payload.order_id !== unique.order_id || payload.source_observation_sha256 !== observationHash) errors.push('CRM Production evidence cross-binding mismatch')
  }
  if (verifier.event_key !== unique.event_key || verifier.order_id !== unique.order_id || verifier.source_observation_sha256 !== observationHash) errors.push('CRM Production verifier cross-binding mismatch')
  if (preflight.source !== 'live_crm_intake_verifier' || preflight.http_status !== 200 || preflight.ready !== true || preflight.signature_verified !== true || preflight.missing_count !== 0) errors.push('CRM signed Production preflight is incomplete')
  if (unique.source !== 'live_production_database_read' || unique.event_count !== 1 || unique.order_count !== 1 || unique.status !== 'awaiting_confirmation' || unique.intake_source !== 'crm' || unique.confirmation_policy !== 'scheduled_review') errors.push('CRM unique pending-order database proof is incomplete')
  if (replay.source !== 'live_crm_intake_verifier' || replay.http_status !== 202 || replay.created !== false || replay.same_order !== true || replay.event_count !== 1 || replay.order_count !== 1 || !(replay.replay_count_after > replay.replay_count_before)) errors.push('CRM exact replay proof is incomplete')
  if (waybill.source !== 'live_production_database_read' || waybill.waybill !== null || waybill.waybill_rows !== 0 || waybill.tracking_events !== 0 || waybill.carrier_calls_executed !== 0 || waybill.provider_order_id !== null) errors.push('CRM no-waybill/no-carrier proof is incomplete')
  return errors
}

function signedRequest(secret, timestamp, method, pathname, rawBody) {
  const text = `crm-json-v1\n${timestamp}\n${method}\n${pathname}\n${canonicalJson(JSON.parse(rawBody))}`
  return crypto.createHmac('sha256', secret).update(text).digest('hex')
}

async function postJson(request, origin, pathname, rawBody, client, expectedStatus) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = signedRequest(client.secret, timestamp, 'POST', pathname, rawBody)
  const response = await request(`${origin}${pathname}`, {
    method: 'POST',
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-shipping-crm-client-id': client.clientId,
      'x-shipping-crm-timestamp': timestamp,
      'x-shipping-crm-signature': `sha256=${signature}`,
      'x-shipping-crm-canonicalization': 'crm-json-v1',
    },
    body: rawBody,
  })
  const text = await response.text()
  check(text.length <= 128 * 1024, 'CRM endpoint response exceeds evidence limit')
  let body
  try { body = JSON.parse(text) } catch { throw Error('CRM endpoint did not return JSON') }
  check(response.status === expectedStatus, `CRM endpoint returned ${response.status}, expected ${expectedStatus}`)
  return { response, body, text }
}

function querySql(orgId, clientId, eventKey) {
  check(UUID.test(orgId || '') && CLIENT_ID.test(clientId || '') && HASH.test(eventKey || ''), 'Unsafe CRM database lookup identity')
  return `
    with matched_events as (
      select * from public.shipping_crm_intake_events
       where org_id = '${orgId}'::uuid
         and integration_client_id = '${clientId}'
         and event_key = '${eventKey}'
    ), matched_event as (
      select * from matched_events limit 1
    ), matched_order as (
      select orders.*
        from public.shipping_orders as orders
        join matched_event as events on events.shipping_order_id = orders.id
       where orders.org_id = '${orgId}'::uuid
    )
    select jsonb_build_object(
      'event_count', (select count(*)::int from matched_events),
      'order_count', (select count(*)::int from matched_order),
      'raw_request', (select raw_request from matched_event),
      'event', (select to_jsonb(matched_event) from matched_event),
      'order', (select to_jsonb(matched_order) from matched_order),
      'waybill_count', (
        select count(*)::int from public.shipping_waybills
         where shipping_order_id = (select id from matched_order)
      ),
      'tracking_event_count', (
        select count(*)::int from public.shipping_tracking_events as tracking
        join public.shipping_waybills as waybills on waybills.id = tracking.waybill_id
        where waybills.shipping_order_id = (select id from matched_order)
      )
    ) as result
  `
}

async function managementQuery(token, sql, request = fetch) {
  check(typeof token === 'string' && token.length > 0, 'Existing Supabase management credential required')
  const response = await request(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await response.text()
  check(response.ok, `Supabase management query failed with ${response.status}`)
  const decoded = JSON.parse(text)
  check(Array.isArray(decoded) && decoded.length === 1 && decoded[0]?.result && typeof decoded[0].result === 'object', 'Supabase management query returned an unexpected shape')
  return decoded[0].result
}

function databaseBlockers(state, observation, parsed, phase) {
  const errors = []
  if (state.event_count !== 1 || state.order_count !== 1) errors.push(`CRM database must contain exactly one event/order during ${phase}`)
  const event = state.event
  const order = state.order
  if (!event || !order) return [...errors, `CRM database event/order is missing during ${phase}`]
  if (event.org_id !== observation.organization_id || event.integration_client_id !== observation.integration_client_id || event.event_key !== observation.event_key) errors.push('CRM database event identity mismatch')
  if (!same(normalizeEvent({
    enterpriseId: event.enterprise_id,
    workflowInstanceId: event.workflow_instance_id,
    objectApiName: event.object_api_name,
    recordId: event.crm_record_id,
    shipmentDetailId: event.shipment_detail_id,
    taskId: event.task_id,
    stageId: event.stage_id,
    revisionId: event.revision_id,
  }), normalizeEvent(observation.event))) errors.push('CRM database workflow/task/stage/revision mismatch')
  if (event.shipping_order_id !== order.id || order.id !== observation.created_order_id || order.order_no !== observation.order_no) errors.push('CRM event and original order are not one-to-one')
  if (event.raw_request !== state.raw_request || sha(state.raw_request || '') !== parsed.rawRequestSha256) errors.push('CRM raw request readback mismatch')
  if (event.payload_hash !== order.payload_hash || event.payload_hash !== parsed.payloadHash) errors.push('CRM payload hash mismatch')
  if (event.applicant_snapshot?.employeeId !== parsed.applicantEmployeeId || event.applicant_snapshot?.employeeId !== observation.applicant_employee_id) errors.push('CRM applicant identity mismatch')
  if (event.customer_snapshot?.accountId !== parsed.customerAccountId || event.customer_snapshot?.accountId !== observation.customer_account_id) errors.push('CRM customer identity mismatch')
  if (order.status !== 'awaiting_confirmation' || order.intake_source !== 'crm' || order.confirmation_policy !== 'scheduled_review') errors.push('CRM order is not awaiting confirmation')
  if (order.sales_ref !== parsed.applicantEmployeeId || order.customer_ref !== parsed.customerAccountId) errors.push('CRM order source references are incomplete')
  if (order.created_by !== null || order.provider_order_id !== null) errors.push('CRM pending order must not have an operator or provider order')
  if (order.identity_snapshot?.provider !== 'fxiaoke' || order.identity_snapshot?.integrationClientId !== observation.integration_client_id || !same(order.identity_snapshot?.applicant, event.applicant_snapshot)) errors.push('CRM order identity snapshot mismatch')
  if (state.waybill_count !== 0 || state.tracking_event_count !== 0) errors.push('CRM pending order already has a waybill or tracking event')
  if (!Number.isInteger(event.replay_count) || event.replay_count < 0) errors.push('CRM replay counter is invalid')
  return errors
}

function sanitizeDatabaseState(state) {
  const event = state.event || {}
  const order = state.order || {}
  return {
    event_count: state.event_count,
    order_count: state.order_count,
    waybill_count: state.waybill_count,
    tracking_event_count: state.tracking_event_count,
    event_key: event.event_key || null,
    payload_hash: event.payload_hash || null,
    replay_count: event.replay_count ?? null,
    last_replayed_at: event.last_replayed_at || null,
    event: {
      id: event.id || null,
      org_id: event.org_id || null,
      integration_client_id: event.integration_client_id || null,
      enterprise_id: event.enterprise_id || null,
      workflow_instance_id: event.workflow_instance_id || null,
      object_api_name: event.object_api_name || null,
      crm_record_id: event.crm_record_id || null,
      shipment_detail_id: event.shipment_detail_id || null,
      task_id: event.task_id || null,
      stage_id: event.stage_id || null,
      revision_id: event.revision_id || null,
      applicant_employee_id: event.applicant_snapshot?.employeeId || null,
      customer_account_id: event.customer_snapshot?.accountId || null,
      raw_request_sha256: state.raw_request ? sha(state.raw_request) : null,
    },
    order: {
      id: order.id || null,
      order_no: order.order_no || null,
      status: order.status || null,
      intake_source: order.intake_source || null,
      confirmation_policy: order.confirmation_policy || null,
      sales_ref: order.sales_ref || null,
      customer_ref: order.customer_ref || null,
      created_by: order.created_by || null,
      provider_order_id: order.provider_order_id || null,
    },
  }
}

function resolveClient(clients, clientId) {
  const configured = Array.isArray(clients) ? clients : []
  const client = configured.find(item => item?.clientId === clientId)
  check(client && UUID.test(client.orgId || '') && typeof client.secret === 'string' && client.secret.length >= 32, 'CRM client configuration is missing or invalid')
  return client
}

function clientsFromEnvironment(environment = process.env) {
  let decoded
  try { decoded = JSON.parse(environment.SHIPPING_CRM_CLIENTS_JSON || '[]') } catch { throw Error('SHIPPING_CRM_CLIENTS_JSON is invalid') }
  check(Array.isArray(decoded) && decoded.length > 0, 'SHIPPING_CRM_CLIENTS_JSON is not configured')
  return decoded
}

async function verifyProduction(options = {}) {
  const { runtime, observation: observationEnvelope, token, clients, commit, deploymentId, request = fetch, databaseQuery } = options
  const expected = { commit, deploymentId }
  check(COMMIT.test(commit || '') && /^dpl_[A-Za-z0-9]+$/.test(deploymentId || ''), 'Released commit/deployment identity is required')
  const observation = readArtifact(runtime, observationEnvelope)
  const blockers = observationBlockers(observation.value, { ...expected, runtime })
  check(blockers.length === 0, blockers.join('; '))
  const client = resolveClient(clients, observation.value.integration_client_id)
  check(client.orgId === observation.value.organization_id, 'CRM client organization does not match the APL observation')

  const query = databaseQuery || (sql => managementQuery(token, sql, request))
  const before = await query(querySql(observation.value.organization_id, observation.value.integration_client_id, observation.value.event_key))
  const parsed = parseRawRequest(before.raw_request)
  if (eventKeyFor(observation.value.organization_id, observation.value.integration_client_id, parsed.event) !== observation.value.event_key) throw Error('Stored CRM request does not derive the observed event key')
  const beforeBlockers = databaseBlockers(before, observation.value, parsed, 'initial read')
  check(beforeBlockers.length === 0, beforeBlockers.join('; '))

  const preflight = await postJson(request, PRODUCTION_ORIGIN, '/api/shipping/crm/preflight', before.raw_request, client, 200)
  if (preflight.body.ready !== true || preflight.body.eventKey !== observation.value.event_key || !same(preflight.body.event, observation.value.event) || !Array.isArray(preflight.body.missing) || preflight.body.missing.length !== 0) {
    throw Error('Signed Production CRM preflight did not reproduce the stored event')
  }

  const replay = await postJson(request, PRODUCTION_ORIGIN, '/api/shipping/crm/orders', before.raw_request, client, 202)
  if (replay.body.accepted !== true || replay.body.created !== false || replay.body.eventKey !== observation.value.event_key || replay.body.orderId !== before.order.id || replay.body.orderNo !== before.order.order_no || replay.body.status !== 'awaiting_confirmation' || replay.body.waybill !== null || replay.body.nextAction !== 'operator_confirmation') {
    throw Error('Signed CRM event replay did not return the original pending order')
  }

  const after = await query(querySql(observation.value.organization_id, observation.value.integration_client_id, observation.value.event_key))
  const afterBlockers = databaseBlockers(after, observation.value, parsed, 'replay read')
  if (after.event?.replay_count <= before.event?.replay_count) afterBlockers.push('CRM replay was not durably audited')
  check(afterBlockers.length === 0, afterBlockers.join('; '))
  if (after.order?.id !== before.order?.id || after.order?.order_no !== before.order?.order_no || after.event_count !== 1 || after.order_count !== 1) throw Error('CRM replay created or selected a different workorder')

  const prefix = `${PREFIX}/crm-intake-${Date.now()}-${process.pid}`
  const observationCopy = writeArtifact(runtime, prefix, 'apl-observation.json', observation.value)
  const preflightRequest = writeArtifact(runtime, prefix, 'preflight-request.json', {
    environment: 'production', origin: PRODUCTION_ORIGIN, path: '/api/shipping/crm/preflight',
    event_key: observation.value.event_key, raw_request_sha256: parsed.rawRequestSha256,
    canonicalization: 'crm-json-v1', signature_verified: true,
  })
  const preflightResponse = writeArtifact(runtime, prefix, 'preflight-response.json', {
    status: preflight.response.status, ready: preflight.body.ready === true,
    event_key: preflight.body.eventKey || null, missing_count: Array.isArray(preflight.body.missing) ? preflight.body.missing.length : null,
    response_sha256: sha(preflight.text),
  })
  const databaseBefore = writeArtifact(runtime, prefix, 'database-before.json', sanitizeDatabaseState(before))
  const replayResponse = writeArtifact(runtime, prefix, 'replay-response.json', {
    status: replay.response.status, created: replay.body.created, event_key: replay.body.eventKey || null,
    order_id: replay.body.orderId || null, order_no: replay.body.orderNo || null,
    status_value: replay.body.status || null, waybill: replay.body.waybill ?? undefined,
    next_action: replay.body.nextAction || null, response_sha256: sha(replay.text),
  })
  const databaseAfter = writeArtifact(runtime, prefix, 'database-after.json', sanitizeDatabaseState(after))
  const carrierAssertion = writeArtifact(runtime, prefix, 'carrier-absence.json', {
    waybill_rows: after.waybill_count, tracking_events: after.tracking_event_count,
    provider_order_id: after.order.provider_order_id, carrier_calls_executed: observation.value.carrier_calls_executed,
  })
  const common = {
    contract_version: CONTRACT, environment: 'production', origin: PRODUCTION_ORIGIN,
    commit, deployment_id: deploymentId, event: observation.value.event,
    event_key: observation.value.event_key, order_id: after.order.id,
    source_observation_sha256: observationEnvelope.sha256,
  }
  const attachments = [observationCopy.reference, preflightRequest.reference, preflightResponse.reference, databaseBefore.reference, replayResponse.reference, databaseAfter.reference, carrierAssertion.reference]
  const observedAt = new Date().toISOString()
  const result = {
    crm_preflight: makeEnvelope(runtime, prefix, 'crm-preflight.json', {
      ...common, source: 'live_crm_intake_verifier', result: 'pass', http_status: preflight.response.status,
      ready: true, signature_verified: true, missing_count: 0, attachments,
    }),
    crm_unique_pending_workorder: makeEnvelope(runtime, prefix, 'crm-unique-pending-order.json', {
      ...common, source: 'live_production_database_read', result: 'pass',
      event_count: before.event_count, order_count: before.order_count,
      order_no: before.order.order_no, status: before.order.status,
      intake_source: before.order.intake_source, confirmation_policy: before.order.confirmation_policy,
      applicant_employee_id: before.event.applicant_snapshot.employeeId,
      customer_account_id: before.event.customer_snapshot.accountId,
      raw_request_sha256: parsed.rawRequestSha256, attachments,
    }),
    crm_repeat_same_workorder: makeEnvelope(runtime, prefix, 'crm-repeat-same-order.json', {
      ...common, source: 'live_crm_intake_verifier', result: 'pass', http_status: replay.response.status,
      created: false, same_order: true, event_count: after.event_count, order_count: after.order_count,
      replay_count_before: before.event.replay_count, replay_count_after: after.event.replay_count,
      order_no: after.order.order_no, status: after.order.status, attachments,
    }),
    crm_waybill_null: makeEnvelope(runtime, prefix, 'crm-waybill-null.json', {
      ...common, source: 'live_production_database_read', result: 'pass', waybill: null,
      waybill_rows: after.waybill_count, tracking_events: after.tracking_event_count,
      provider_order_id: after.order.provider_order_id, carrier_calls_executed: observation.value.carrier_calls_executed,
      status: after.order.status, attachments,
    }),
    verifier: makeEnvelope(runtime, prefix, 'crm-intake-verifier.json', {
      ...common, source: 'live_crm_intake_verifier', result: 'pass', user_selected_client: false,
      user_selected_database_query: false, actions: [...PRODUCTION_ACTIONS], observed_at: observedAt,
      replay_count_before: before.event.replay_count, replay_count_after: after.event.replay_count,
      attachments,
    }),
  }
  const finalBlockers = productionEvidenceBlockers(result, expected)
  check(finalBlockers.length === 0, finalBlockers.join('; '))
  return result
}

async function verifyPreview(options = {}) {
  const { runtime, origin, commit, deploymentId, rawBody, client, migrationEvidence, request = fetch } = options
  const parsedOrigin = new URL(origin)
  check(parsedOrigin.protocol === 'https:' && parsedOrigin.origin === origin && parsedOrigin.hostname.endsWith('.vercel.app') && parsedOrigin.hostname !== PRODUCTION_ORIGIN.slice('https://'.length), 'Preview CRM verifier requires the isolated Vercel Preview origin')
  const parsed = parseRawRequest(rawBody)
  const eventKey = eventKeyFor(client.orgId, client.clientId, parsed.event)

  const preflight = await postJson(request, origin, '/api/shipping/crm/preflight', rawBody, client, 200)
  check(preflight.body.ready === true && preflight.body.eventKey === eventKey && same(preflight.body.event, parsed.event) && Array.isArray(preflight.body.missing) && preflight.body.missing.length === 0, 'Preview signed CRM preflight did not pass')

  const incomplete = structuredClone(parsed.value)
  incomplete.shipment.recipient = {}
  const invalidBody = JSON.stringify(incomplete)
  const invalidOne = await postJson(request, origin, '/api/shipping/crm/orders', invalidBody, client, 422)
  const invalidTwo = await postJson(request, origin, '/api/shipping/crm/orders', invalidBody, client, 422)
  check(invalidOne.body.code === 'CRM_INTAKE_INCOMPLETE' && invalidTwo.body.code === 'CRM_INTAKE_INCOMPLETE', 'Preview create rejection did not fail closed')
  check(migrationEvidence?.commit === commit && migrationEvidence?.migration_test_passed === true && migrationEvidence?.replay_test_passed === true && migrationEvidence?.no_carrier_test_passed === true, 'Preview isolated migration evidence is incomplete')

  const prefix = `${PREFIX}/crm-intake-preview-${Date.now()}-${process.pid}`
  const common = {
    contract_version: CONTRACT, environment: 'preview', origin, commit, deployment_id: deploymentId,
    event: parsed.event, event_key: eventKey, production_claimed: false, business_mutations: 0,
  }
  const preflightAttachment = writeArtifact(runtime, prefix, 'preflight-response.json', {
    status: preflight.response.status, ready: preflight.body.ready, event_key: preflight.body.eventKey,
    missing_count: preflight.body.missing.length, response_sha256: sha(preflight.text),
  })
  const rejectionOne = writeArtifact(runtime, prefix, 'rejected-create-1.json', {
    status: invalidOne.response.status, code: invalidOne.body.code, response_sha256: sha(invalidOne.text),
  })
  const rejectionTwo = writeArtifact(runtime, prefix, 'rejected-create-2.json', {
    status: invalidTwo.response.status, code: invalidTwo.body.code, response_sha256: sha(invalidTwo.text),
  })
  const migrationAttachment = writeArtifact(runtime, prefix, 'migration-evidence.json', migrationEvidence)
  const runtimeEvidence = {
    crm_preflight: makeEnvelope(runtime, prefix, 'preview-crm-preflight.json', {
      ...common, source: 'live_preview_crm_intake_verifier', http_status: 200, ready: true,
      signature_verified: true, missing_count: 0, attachments: [preflightAttachment.reference],
    }),
    crm_unique_pending_workorder: makeEnvelope(runtime, prefix, 'preview-crm-unique-order.json', {
      ...common, source: 'isolated_migration_test', migration_test_passed: true,
      event_count: 1, order_count: 1, status: 'awaiting_confirmation', attachments: [migrationAttachment.reference],
    }),
    crm_repeat_same_workorder: makeEnvelope(runtime, prefix, 'preview-crm-repeat-order.json', {
      ...common, source: 'isolated_migration_test', replay_test_passed: true,
      created: false, same_order: true, event_count: 1, order_count: 1, replay_count: 1,
      attachments: [migrationAttachment.reference],
    }),
    crm_waybill_null: makeEnvelope(runtime, prefix, 'preview-crm-waybill-null.json', {
      ...common, source: 'isolated_contract_assertion', waybill: null,
      waybill_rows: 0, tracking_events: 0, carrier_calls_executed: 0,
      attachments: [migrationAttachment.reference],
    }),
  }
  const replayContract = makeEnvelope(runtime, prefix, 'crm-preview-contract.json', {
    ...common, actions: [...PREVIEW_ACTIONS], result: 'pass', signed_preflight: true,
    incomplete_create_statuses: [invalidOne.response.status, invalidTwo.response.status],
    incomplete_create_codes: [invalidOne.body.code, invalidTwo.body.code],
    no_business_mutation: true,
    attachments: [preflightAttachment.reference, rejectionOne.reference, rejectionTwo.reference, migrationAttachment.reference],
  })
  const blockers = previewEvidenceBlockers(runtimeEvidence, 'preview', { commit, deploymentId })
  check(blockers.length === 0, blockers.join('; '))
  return { runtimeEvidence, replayContract }
}

module.exports = {
  productionFirstExceptionBlockers,
  CONTRACT,
  ITEMS,
  PREVIEW_ACTIONS,
  PRODUCTION_ACTIONS,
  PRODUCTION_ORIGIN,
  contractScopeBlockers,
  observationBlockers,
  previewEvidenceBlockers,
  productionEvidenceBlockers,
  databaseBlockers,
  managementQuery,
  querySql,
  canonicalJson,
  eventKeyFor,
  signedRequest,
  clientsFromEnvironment,
  verifyPreview,
  verifyProduction,
}
