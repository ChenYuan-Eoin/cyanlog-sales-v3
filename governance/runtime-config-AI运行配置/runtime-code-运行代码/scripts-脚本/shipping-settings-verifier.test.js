const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const v = require('./shipping-settings-verifier')

const nativeFetch = global.fetch
const ORIGIN = 'https://sales.cyanlog.icu'
const expected = { commit: 'a'.repeat(40), deploymentId: 'dpl_settings' }
const sha = value => crypto.createHash('sha256').update(value).digest('hex')
const json = value => JSON.stringify(value, null, 2) + '\n'
function ref(runtime, name, value) {
  const bytes = Buffer.from(typeof value === 'string' ? value : json(value))
  fs.writeFileSync(path.join(runtime, name), bytes)
  return { path: name, sha256: sha(bytes) }
}
function checks(action) {
  if (action === 'open_shipping_settings') return { page_accessible: true, merged_settings_page: true }
  if (action === 'inspect_carrier_controls') return { sf_connection_section_visible: true }
  if (action === 'inspect_billing_service_controls') return { billing_accounts_visible: true, services_visible: true }
  if (action === 'inspect_default_sender') return { default_sender_visible: true }
  if (action === 'inspect_intake_rules') return { intake_rules_visible: true }
  if (action === 'inspect_organization_permission_entry') return { organization_permission_entry_visible: true }
  if (action === 'verify_legacy_enterprise_ui_absent') return { enterprise_tab_absent: true, wecom_app_absent: true, robot_section_absent: true, legacy_employee_count_absent: true }
  return { save_clicked: false, carrier_api_clicked: false, organization_sync_clicked: false, service_state_change_clicked: false }
}
function fixture(t) {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'shipping-settings-proof-'))
  t.after(() => fs.rmSync(runtime, { recursive: true, force: true }))
  const now = new Date().toISOString()
  const attachments = v.ACTIONS.map((action, index) => ref(runtime, `screen-${index}.json`, { action, redacted: true }))
  const testLog = ref(runtime, 'target-tests.log', 'shipping settings target regression: pass\n')
  const payload = {
    contract_version: v.CONTRACT, source: 'trusted_existing_chrome_operator', environment: 'production',
    origin: ORIGIN, url: ORIGIN + '/configs?tab=shipping', commit: expected.commit, deployment_id: expected.deploymentId,
    browser_context: 'existing_user_chrome', existing_tab_id: '12345', new_tabs: 0, new_browser_contexts: 0,
    attestation_type: 'trusted_operator_browser', trust_boundary: 'operator_attestation_not_machine_proof',
    attestation_method: 'codex_chrome_control_existing_session', attested_by: 'codex', attested_at: now,
    viewport: { width: 1440, height: 900 },
    org_id: '00000001-0000-0000-0000-000000000000', operator_id: '30000001-0000-0000-0000-000000000000',
    actions: [...v.ACTIONS], observations: v.ACTIONS.map(action => ({ action, observed_at: now, result: 'pass', checks: checks(action) })),
    clicked_save: false, clicked_carrier_api: false, clicked_organization_sync: false, clicked_service_control: false,
    business_write_requests_observed: [], result: 'pass', attachments,
    payload_regression: {
      contract_version: v.CONTRACT, source: 'local_target_payload_regression', commit: expected.commit,
      result: 'pass', production_requests_exercised: false,
      test_file: 'product-truth/product-code/app/shipping/config-drawer.test.tsx', test_file_sha256: 'b'.repeat(64),
      test_log: testLog, exit_code: 0, timeout: false,
      assertions: ['one_page_merged', 'legacy_wecom_ui_removed', 'no_business_mutation'],
    },
  }
  function save() {
    const operator = ref(runtime, 'operator.json', payload)
    return { artifact_path: operator.path, sha256: operator.sha256, payload: structuredClone(payload) }
  }
  return { runtime, payload, save }
}
function mockFetch(t) {
  global.fetch = async () => new Response('{"error":"Unauthorized"}', { status: 401, headers: { 'content-type': 'application/json; charset=utf-8' } })
  t.after(() => { global.fetch = nativeFetch })
}

test('exports the finite merged-settings contract and rejects mutation-shaped operator evidence', t => {
  assert.equal(v.CONTRACT, 'f054-shipping-settings-v1')
  assert.deepEqual(v.ITEMS, ['shipping_settings', 'shipping_access'])
  assert.equal(v.ACTIONS.length, 8)
  const f = fixture(t)
  assert.doesNotThrow(() => v.operatorPayload(f.payload, expected))
  for (const patch of [
    value => { value.clicked_save = true },
    value => { value.business_write_requests_observed = ['POST /api/shipping/settings'] },
    value => { value.actions = value.actions.slice().reverse() },
    value => { value.observations[0].checks.merged_settings_page = false },
    value => { value.observations[6].checks.wecom_app_absent = false },
    value => { value.new_tabs = 1 },
  ]) {
    const changed = structuredClone(f.payload); patch(changed)
    assert.throws(() => v.operatorPayload(changed, expected))
  }
})

test('collects one anonymous 401 read and seals operator plus access dependencies', async t => {
  const f = fixture(t); mockFetch(t)
  const proof = await v.verify({ runtime: f.runtime, operator: f.save(), ...expected })
  assert.equal(proof.shipping_settings.payload.source, 'trusted_existing_chrome_operator')
  assert.equal(proof.shipping_access.payload.anonymous_access_denied, true)
  assert.equal(proof.verifier.payload.source, 'live_shipping_settings_verifier')
  assert.equal(proof.verifier.payload.probes.length, 1)
  assert.deepEqual(v.productionEvidenceBlockers(proof, expected), [])
  for (const item of Object.values(proof)) {
    assert.equal(sha(fs.readFileSync(path.join(f.runtime, item.artifact_path))), item.sha256)
  }
})

test('Production evidence stays verifiable after collection and rejects rebinding or mutation claims', t => {
  const f = fixture(t)
  const operatorHash = sha(json(f.payload))
  const now = new Date().toISOString()
  const probe = {
    method: 'GET', path: '/api/shipping/settings', credentials: 'omit', status: 401,
    content_type: 'application/json; charset=utf-8', error: 'Unauthorized', observed_at: now,
    response_body_sha256: 'c'.repeat(64), response_artifact: { path: 'probe.json', sha256: 'c'.repeat(64) },
  }
  const common = { contract_version: v.CONTRACT, environment: 'production', origin: ORIGIN, commit: expected.commit, deployment_id: expected.deploymentId }
  const section = {
    shipping_settings: { payload: { ...common, source: 'trusted_existing_chrome_operator', read_only: true, result: 'pass', source_operator_sha256: operatorHash, operator_attestation: f.payload, attachments: f.payload.attachments } },
    shipping_access: { payload: { ...common, source: 'live_shipping_settings_verifier', read_only: true, result: 'pass', source_operator_sha256: operatorHash, anonymous_access_denied: true, probes: [probe], attachments: [probe.response_artifact] } },
    verifier: { payload: { ...common, source: 'live_shipping_settings_verifier', read_only: true, result: 'pass', source_operator_sha256: operatorHash, observed_at: now, source_operator_artifact: { path: 'operator.json', sha256: operatorHash }, probes: [probe], attachments: [probe.response_artifact] } },
  }
  assert.deepEqual(v.productionEvidenceBlockers(section, expected), [])
  const later = Date.now
  Date.now = () => later() + 24 * 3600000
  t.after(() => { Date.now = later })
  assert.deepEqual(v.productionEvidenceBlockers(section, expected), [])
  for (const patch of [
    value => { value.shipping_settings.payload.operator_attestation.clicked_save = true },
    value => { value.shipping_access.payload.probes[0].status = 200 },
    value => { value.verifier.payload.deployment_id = 'dpl_other' },
  ]) {
    const changed = structuredClone(section); patch(changed)
    assert.ok(v.productionEvidenceBlockers(changed, expected).length)
  }
})

test('Preview evidence proves one page, legacy UI absence, and zero business mutations', () => {
  const preview = {
    shipping_settings: { payload: { contract_version: v.CONTRACT, environment: 'preview', one_page_merged: true, carrier_controls_visible: true, billing_service_controls_visible: true, default_sender_visible: true, intake_rules_visible: true, organization_permission_entry_visible: true, legacy_enterprise_ui_absent: true, save_clicked: false, no_business_mutations: true, carrier_calls_observed: false, organization_sync_requests_observed: false, service_state_changes_observed: false } },
    shipping_access: { payload: { contract_version: v.CONTRACT, environment: 'preview', anonymous_access_denied: true, application_response: true, anonymous_status: 401, no_business_mutations: true } },
  }
  assert.deepEqual(v.runtimeEvidenceBlockers(preview, 'preview'), [])
  const changed = structuredClone(preview); changed.shipping_settings.payload.legacy_enterprise_ui_absent = false
  assert.ok(v.runtimeEvidenceBlockers(changed, 'preview').length)
})

test('Production-first exception is bounded to the approved WP40 release', () => {
  const approval = {
    type: 'final_production_release_authorization', source: 'user_explicit', state: 'approved',
    code_release_authorized: true, database_write_authorized: false, production_database_write_authorized: false,
    carrier_calls_authorized: false, organization_sync_authorized: false, service_retirement_authorized: false,
    preview_order_exception: true, preview_status: 'not_passed',
    approved_candidate: 'a'.repeat(40), approved_product_tree: 'b'.repeat(40), rollback_commit: 'c'.repeat(40),
  }
  const scope = {
    approval, activeId: 'WP40', featureId: 'F054', runtimeProfile: 'shipping_workspace', contractVersion: v.CONTRACT,
    productTree: approval.approved_product_tree, candidateIsAncestor: true,
    changedPaths: ['governance/runtime-state/demand-inbox.jsonl'],
  }
  assert.deepEqual(v.productionFirstExceptionBlockers(scope), [])
  for (const patch of [
    { approval: { ...approval, preview_order_exception: false } },
    { approval: { ...approval, preview_status: 'passed' } },
    { approval: { ...approval, production_database_write_authorized: true } },
    { approval: { ...approval, carrier_calls_authorized: true } },
    { activeId: 'WP53' }, { featureId: 'F003' }, { runtimeProfile: 'application' },
    { productTree: 'f'.repeat(40) }, { candidateIsAncestor: false },
    { changedPaths: ['product-truth/product-code/app/shipping/config-drawer.tsx'] },
  ]) assert.ok(v.productionFirstExceptionBlockers({ ...scope, ...patch }).length)
})
