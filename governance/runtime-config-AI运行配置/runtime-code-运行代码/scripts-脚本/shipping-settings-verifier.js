// Read-only acceptance for the merged shipping settings page.
// Browser observations are existing-Chrome operator attestations. The controlled
// collector performs one anonymous GET of the settings endpoint and no writes.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const CONTRACT = 'f054-shipping-settings-v1'
const ITEMS = Object.freeze(['shipping_settings', 'shipping_access'])
const ACTIONS = Object.freeze([
  'open_shipping_settings',
  'inspect_carrier_controls',
  'inspect_billing_service_controls',
  'inspect_default_sender',
  'inspect_intake_rules',
  'inspect_organization_permission_entry',
  'verify_legacy_enterprise_ui_absent',
  'leave_without_saving',
])
const ROUTES = Object.freeze(['/api/shipping/settings'])
const ORIGIN = 'https://sales.cyanlog.icu'
const URL_VALUE = ORIGIN + '/configs?tab=shipping'
const PREFIX = 'production-runtime-verifier'
const HASH = /^[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/
const RELEASE_RULE_PATHS = new Set([
  'governance/runtime-state/active-task.json',
  'governance/runtime-state/demand-inbox.jsonl',
  'product-truth/feature-packets/F054-sf-self-service-order.md',
  'product-truth/feature-packets/F099-current-goal-ledger.md',
  ...['project-registry.js', 'shipping-settings-verifier.js', 'shipping-settings-verifier.test.js', 'harness-selftest.js']
    .map(name => `governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/${name}`),
])
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

// This changes prerequisite ordering only. Preview remains explicitly not passed.
function productionFirstExceptionBlockers({ approval, activeId, featureId, runtimeProfile, contractVersion, productTree, changedPaths, candidateIsAncestor } = {}) {
  const errors = []
  if (activeId !== 'WP40' || featureId !== 'F054' || runtimeProfile !== 'shipping_workspace' || contractVersion !== CONTRACT) {
    errors.push('Shipping settings release ordering is limited to WP40 F054')
  }
  if (approval?.type !== 'final_production_release_authorization' || approval?.source !== 'user_explicit' || approval?.state !== 'approved'
    || approval?.preview_order_exception !== true || approval?.preview_status !== 'not_passed') {
    errors.push('Explicit user release authority must preserve Preview as not passed')
  }
  const authorization = approval?.production_release_authorization || approval
  if (approval?.code_release_authorized !== true || authorization?.database_write_authorized !== false
    || authorization?.production_database_write_authorized !== false || authorization?.carrier_calls_authorized !== false
    || authorization?.organization_sync_authorized !== false || authorization?.service_retirement_authorized !== false) {
    errors.push('Shipping settings ordering exception permits no database writes, carrier calls, organization synchronization, or service retirement')
  }
  if (!COMMIT.test(approval?.approved_candidate || '') || candidateIsAncestor !== true
    || !COMMIT.test(approval?.approved_product_tree || '') || productTree !== approval?.approved_product_tree) {
    errors.push('Shipping settings release must retain the approved product tree and candidate ancestry')
  }
  if (!Array.isArray(changedPaths) || changedPaths.some(file => !RELEASE_RULE_PATHS.has(file))) {
    errors.push('Only scoped shipping-settings delivery rules may follow the approved candidate')
  }
  if (!COMMIT.test(approval?.rollback_commit || '')) errors.push('Concrete rollback commit required')
  return errors
}
const json = value => JSON.stringify(value, null, 2) + '\n'
const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
const check = (ok, message) => { if (!ok) throw Error(message) }

function keys(value, allowed, label) {
  check(value && typeof value === 'object' && !Array.isArray(value), 'Invalid ' + label)
  check(Object.keys(value).every(key => allowed.includes(key)), 'Unapproved field in ' + label)
}
function stamp(value) {
  const match = typeof value === 'string' && value.match(/^(\d{4}-\d\d-\d\d)T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/)
  check(match && Number.isFinite(Date.parse(value)) && new Date(match[1] + 'T00:00:00Z').toISOString().slice(0, 10) === match[1], 'Valid ISO observation time required')
  return Date.parse(value)
}
function fresh(value, now = Date.now()) {
  const observed = stamp(value)
  check(observed <= now + 60000 && now - observed < 2 * 3600000, 'Fresh observation required')
  return observed
}
function artifact(runtime, reference) {
  const relative = String(reference?.path || '')
  check(relative && !path.isAbsolute(relative) && !relative.split(path.sep).includes('..'), 'Unsafe artifact path')
  const bytes = fs.readFileSync(path.join(runtime, relative))
  if (reference?.sha256) check(sha(bytes) === reference.sha256, 'Artifact hash mismatch')
  let value = null
  try { value = JSON.parse(bytes.toString('utf8')) } catch { /* Non-JSON test logs are still valid raw dependencies. */ }
  return { bytes, text: bytes.toString('utf8'), value }
}
function write(runtime, name, value) {
  const directory = path.join(runtime, PREFIX)
  fs.mkdirSync(directory, { recursive: true })
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : json(value))
  fs.writeFileSync(path.join(directory, name), bytes)
  return { path: `${PREFIX}/${name}`, sha256: sha(bytes) }
}
function attachments(value, label) {
  check(Array.isArray(value) && value.length > 0, label + ' requires attachments')
  for (const item of value) check(typeof item?.path === 'string' && HASH.test(item?.sha256 || ''), label + ' attachment is invalid')
}
function observationChecks(action) {
  if (action === 'open_shipping_settings') return { page_accessible: true, merged_settings_page: true }
  if (action === 'inspect_carrier_controls') return { sf_connection_section_visible: true }
  if (action === 'inspect_billing_service_controls') return { billing_accounts_visible: true, services_visible: true }
  if (action === 'inspect_default_sender') return { default_sender_visible: true }
  if (action === 'inspect_intake_rules') return { intake_rules_visible: true }
  if (action === 'inspect_organization_permission_entry') return { organization_permission_entry_visible: true }
  if (action === 'verify_legacy_enterprise_ui_absent') {
    return { enterprise_tab_absent: true, wecom_app_absent: true, robot_section_absent: true, legacy_employee_count_absent: true }
  }
  return { save_clicked: false, carrier_api_clicked: false, organization_sync_clicked: false, service_state_change_clicked: false }
}
function operatorPayload(value, expected, now = Date.now()) {
  keys(value, [
    'contract_version', 'source', 'environment', 'origin', 'url', 'commit', 'deployment_id',
    'browser_context', 'existing_tab_id', 'new_tabs', 'new_browser_contexts', 'attestation_type',
    'trust_boundary', 'attestation_method', 'attested_by', 'attested_at', 'viewport', 'org_id',
    'operator_id', 'actions', 'observations', 'clicked_save', 'clicked_carrier_api',
    'clicked_organization_sync', 'clicked_service_control', 'business_write_requests_observed',
    'result', 'attachments', 'payload_regression',
  ], 'operator attestation')
  check(value.contract_version === CONTRACT, 'Operator contract version mismatch')
  check(value.source === 'trusted_existing_chrome_operator' && value.environment === 'production', 'Existing Chrome Production operator required')
  check(value.origin === ORIGIN && value.url === URL_VALUE, 'Merged shipping settings Production URL required')
  check(value.commit === expected.commit && value.deployment_id === expected.deploymentId, 'Operator evidence binding mismatch')
  check(value.browser_context === 'existing_user_chrome' && value.existing_tab_id && value.new_tabs === 0 && value.new_browser_contexts === 0, 'No new browser or tab evidence is permitted')
  check(value.attestation_type === 'trusted_operator_browser' && value.trust_boundary === 'operator_attestation_not_machine_proof'
    && value.attestation_method === 'codex_chrome_control_existing_session' && typeof value.attested_by === 'string'
    && /^[A-Za-z0-9_.:-]{1,100}$/.test(value.attested_by), 'Explicit existing-Chrome operator boundary required')
  fresh(value.attested_at, now)
  check(value.viewport && Number.isInteger(value.viewport.width) && value.viewport.width >= 900
    && Number.isInteger(value.viewport.height) && value.viewport.height >= 600, 'Desktop operator viewport required')
  check(UUID.test(value.org_id || '') && UUID.test(value.operator_id || ''), 'Operator organization and user UUID attestation required')
  check(same(value.actions, ACTIONS), 'Exact ordered read-only action list required')
  check(Array.isArray(value.observations) && value.observations.length === ACTIONS.length, 'Every action requires an observation')
  const evidenceHashes = new Set()
  for (const [index, observation] of value.observations.entries()) {
    keys(observation, ['action', 'observed_at', 'result', 'checks'], 'operator observation')
    check(observation.action === ACTIONS[index] && observation.result === 'pass', 'Observation action order or result mismatch')
    fresh(observation.observed_at, now)
    check(same(observation.checks, observationChecks(ACTIONS[index])), 'Observation does not prove the required control: ' + ACTIONS[index])
    evidenceHashes.add(sha(json(observation)))
  }
  check(evidenceHashes.size === ACTIONS.length, 'Action observations must be distinct')
  check(value.clicked_save === false && value.clicked_carrier_api === false && value.clicked_organization_sync === false
    && value.clicked_service_control === false, 'Read-only replay must not click saves, carrier APIs, synchronization, or service changes')
  check(Array.isArray(value.business_write_requests_observed) && value.business_write_requests_observed.length === 0, 'Business writes are forbidden')
  check(value.result === 'pass', 'Operator replay did not pass')
  attachments(value.attachments, 'Operator replay')
  const regression = value.payload_regression
  check(regression && regression.contract_version === CONTRACT && regression.source === 'local_target_payload_regression'
    && regression.commit === expected.commit && regression.result === 'pass' && regression.production_requests_exercised === false
    && typeof regression.test_file === 'string' && HASH.test(regression.test_file_sha256 || '')
    && regression.exit_code === 0 && regression.timeout === false && Array.isArray(regression.assertions)
    && regression.assertions.includes('one_page_merged') && regression.assertions.includes('legacy_wecom_ui_removed')
    && regression.assertions.includes('no_business_mutation'), 'Local payload regression proof missing')
  attachments([regression.test_log], 'Local regression')
  return value
}
function validatePreviewPayloads(section, environment) {
  const errors = []
  const settings = section.shipping_settings?.payload || {}
  const access = section.shipping_access?.payload || {}
  if (!['sandbox', 'preview'].includes(environment)) errors.push('Preview evidence must use sandbox or preview environment')
  if (settings.contract_version !== CONTRACT || settings.environment !== 'preview') errors.push('Shipping settings Preview contract/environment mismatch')
  if (settings.one_page_merged !== true || settings.carrier_controls_visible !== true || settings.billing_service_controls_visible !== true
    || settings.default_sender_visible !== true || settings.intake_rules_visible !== true || settings.organization_permission_entry_visible !== true) {
    errors.push('Merged shipping settings controls are not all visible')
  }
  if (settings.legacy_enterprise_ui_absent !== true || settings.save_clicked !== false || settings.no_business_mutations !== true) {
    errors.push('Preview evidence must prove legacy UI removal and no business mutation')
  }
  if (access.contract_version !== CONTRACT || access.environment !== 'preview' || access.anonymous_access_denied !== true
    || access.application_response !== true || access.anonymous_status !== 401 || access.no_business_mutations !== true) {
    errors.push('Preview access evidence must prove application authentication denial')
  }
  if (settings.carrier_calls_observed === true || settings.organization_sync_requests_observed === true || settings.service_state_changes_observed === true) {
    errors.push('Preview evidence must not report carrier calls, organization synchronization, or service changes')
  }
  return errors
}

function runtimeEvidenceBlockers(section, environment) {
  if (environment === 'production') {
    return ITEMS.flatMap(item => section[item]?.payload ? [] : [`Missing ${item} evidence`])
  }
  return validatePreviewPayloads(section, environment)
}
function productionOperatorBlockers(payload, expected) {
  const errors = []
  try { operatorPayload(payload, expected) } catch (error) { errors.push(error.message) }
  return errors
}
function productionEvidenceBlockers(section, expected) {
  try {
    return collectProductionEvidenceBlockers(section, expected)
  } catch (error) {
    return [error.message]
  }
}
function collectProductionEvidenceBlockers(section, expected) {
  const errors = []
  const operatorHash = section.shipping_settings?.payload?.source_operator_sha256
  check(HASH.test(operatorHash || ''), 'Source operator hash missing')
  const verifier = section.verifier?.payload
  const verifiedAt = stamp(verifier?.observed_at)
  for (const item of ITEMS) {
    keys(section[item]?.payload, [
      'contract_version', 'environment', 'origin', 'commit', 'deployment_id', 'source', 'read_only', 'result',
      ...(item === 'shipping_settings' ? ['source_operator_sha256', 'operator_attestation', 'attachments'] : []),
      ...(item === 'shipping_access' ? ['source_operator_sha256', 'anonymous_access_denied', 'probes', 'attachments'] : []),
    ], item + ' receipt')
    const value = section[item].payload
    if (value.contract_version !== CONTRACT || value.environment !== 'production' || value.origin !== ORIGIN
      || value.commit !== expected.commit || value.deployment_id !== expected.deploymentId
      || value.read_only !== true || value.result !== 'pass' || value.source_operator_sha256 !== operatorHash) {
      errors.push(item + ' receipt binding mismatch')
    }
  }
  const settings = section.shipping_settings.payload
  if (settings.source !== 'trusted_existing_chrome_operator') errors.push('Shipping settings source is not the trusted existing Chrome operator')
  try { operatorPayload(settings.operator_attestation, expected, verifiedAt) } catch (error) { errors.push(error.message) }
  const access = section.shipping_access.payload
  if (access.source !== 'live_shipping_settings_verifier' || access.anonymous_access_denied !== true) errors.push('Anonymous settings denial missing')
  if (!Array.isArray(access.probes) || access.probes.length !== ROUTES.length) errors.push('Anonymous settings probe is incomplete')
  for (const [index, probe] of (access.probes || []).entries()) {
    keys(probe, ['method', 'path', 'credentials', 'status', 'content_type', 'error', 'observed_at', 'response_body_sha256', 'response_artifact'], 'anonymous probe')
    if (probe.method !== 'GET' || probe.path !== ROUTES[index] || probe.credentials !== 'omit' || probe.status !== 401
      || !/^application\/json(?:\s*;|$)/i.test(probe.content_type || '') || !['Unauthorized', '请先登录。'].includes(probe.error)
      || !HASH.test(probe.response_body_sha256 || '')) errors.push('Anonymous settings probe is not an application JSON 401')
    stamp(probe.observed_at)
  }
  keys(verifier, ['contract_version', 'environment', 'origin', 'commit', 'deployment_id', 'source', 'read_only', 'result',
    'source_operator_sha256', 'observed_at', 'source_operator_artifact', 'probes', 'attachments'], 'verifier receipt')
  if (verifier.contract_version !== CONTRACT || verifier.environment !== 'production' || verifier.origin !== ORIGIN
    || verifier.commit !== expected.commit || verifier.deployment_id !== expected.deploymentId
    || verifier.source !== 'live_shipping_settings_verifier' || verifier.read_only !== true || verifier.result !== 'pass'
    || verifier.source_operator_sha256 !== operatorHash || !same(verifier.probes, access.probes)) errors.push('Controlled verifier receipt binding mismatch')
  stamp(verifier.observed_at)
  if (expected.runtime) {
    try {
      const source = artifact(expected.runtime, verifier.source_operator_artifact)
      if (!same(source.value, settings.operator_attestation)) errors.push('Original operator payload changed')
      for (const probe of verifier.probes || []) artifact(expected.runtime, probe.response_artifact)
      attachments(verifier.attachments, 'Verifier dependencies')
    } catch (error) { errors.push(error.message) }
  }
  return errors
}

async function verify(options) {
  keys(options, ['runtime', 'operator', 'commit', 'deploymentId'], 'collector options')
  const { runtime, operator, commit, deploymentId } = options
  const expected = { commit, deploymentId }
  keys(operator, ['artifact_path', 'sha256', 'payload'], 'operator envelope')
  const original = artifact(runtime, { path: operator.artifact_path, sha256: operator.sha256 })
  check(same(original.value, operator.payload), 'Operator envelope payload mismatch')
  operatorPayload(original.value, expected)
  const input = original.value
  const copiedAttachments = input.attachments.map(reference => {
    const source = artifact(runtime, reference)
    return write(runtime, 'operator-' + path.basename(reference.path), source.bytes)
  })
  const regression = artifact(runtime, input.payload_regression.test_log)
  const regressionReference = write(runtime, 'payload-regression.log', regression.bytes)
  const probes = []
  for (const route of ROUTES) {
    let response
    try {
      response = await fetch(ORIGIN + route, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'manual' })
    } catch (error) { throw Error('Anonymous settings probe failed: ' + error.message) }
    const bytes = Buffer.from(await response.arrayBuffer())
    let body
    try { body = JSON.parse(bytes) } catch { throw Error('Invalid anonymous JSON response') }
    check(response.status === 401 && /^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')
      && ['Unauthorized', '请先登录。'].includes(body.error) && (body.success === undefined || body.success === false), 'Application JSON 401 required')
    const observed = {
      method: 'GET', path: route, credentials: 'omit', status: response.status,
      content_type: response.headers.get('content-type'), error: body.error,
      observed_at: new Date().toISOString(), response_body_sha256: sha(bytes), response_artifact: null,
    }
    observed.response_artifact = write(runtime, 'anonymous-' + probes.length + '.json', bytes)
    probes.push(observed)
  }
  const observedAt = new Date().toISOString()
  const common = { contract_version: CONTRACT, environment: 'production', origin: ORIGIN, commit, deployment_id: deploymentId }
  const sourceOperatorReference = write(runtime, 'source-operator.json', original.bytes)
  const verifier = {
    ...common, source: 'live_shipping_settings_verifier', read_only: true, result: 'pass',
    source_operator_sha256: operator.sha256, observed_at: observedAt,
    source_operator_artifact: sourceOperatorReference, probes,
    attachments: [sourceOperatorReference, ...copiedAttachments, regressionReference, ...probes.map(item => item.response_artifact)],
  }
  const make = (name, payload) => {
    const reference = write(runtime, name + '.json', payload)
    return { artifact_path: reference.path, sha256: reference.sha256, payload }
  }
  const result = {
    shipping_settings: make('settings', {
      ...common, source: 'trusted_existing_chrome_operator', read_only: true, result: 'pass',
      source_operator_sha256: operator.sha256, operator_attestation: input,
      attachments: [...copiedAttachments, regressionReference],
    }),
    shipping_access: make('access', {
      ...common, source: verifier.source, read_only: true, anonymous_access_denied: true, result: 'pass',
      source_operator_sha256: operator.sha256, probes, attachments: probes.map(item => item.response_artifact),
    }),
    verifier: make('verifier', verifier),
  }
  const blockers = productionEvidenceBlockers(result, expected)
  check(blockers.length === 0, blockers.join('; '))
  return result
}

module.exports = {
  CONTRACT, ITEMS, ACTIONS, ROUTES, productionFirstExceptionBlockers, operatorPayload, runtimeEvidenceBlockers,
  productionEvidenceBlockers, productionOperatorBlockers, verify,
}
