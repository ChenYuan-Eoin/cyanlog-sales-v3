const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const v = require('./shipping-service-selection-verifier');
const ORIGIN = 'https://sales.cyanlog.icu';
const nativeFetch = global.fetch;
const expected = { commit: 'a'.repeat(40), deploymentId: 'dpl_selection' };
const ids = ['10000001-0000-0000-0000-000000000000', '10000002-0000-0000-0000-000000000000'];
const localAssertions = ['per_order_payload', 'original_product_fallback', 'batch_requires_explicit_apply', 'batch_applies_selected_only', 'empty_restores_original', 'invalid_blocks_before_request', 'unknown_does_not_reconfirm', 'server_readback_authoritative'];
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
function fixture(t) {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'shipping-selection-proof-'));
  t.after(() => fs.rmSync(runtime, { recursive: true, force: true }));
  const write = (name, value) => { const bytes = json(value); fs.writeFileSync(path.join(runtime, name), bytes); return { path: name, sha256: sha(bytes) }; };
  const testLogBytes = Buffer.from('Synthetic isolated target regression fixture: pass.\n');
  fs.writeFileSync(path.join(runtime, 'test-log.txt'), testLogBytes);
  const testLog = { path: 'test-log.txt', sha256: sha(testLogBytes) };
  const now = new Date().toISOString();
  const initial = [2, 2], changed = [1, 2], applied = [1, 1];
  const observations = v.ACTIONS.map((action, index) => ({
    action, observed_at: now,
    services: ids.map((order_id, i) => ({ order_id, service_id: (index < 2 || index >= 7 ? initial : index === 6 ? applied : changed)[i] })),
    selected_order_ids: index === 0 || index === 9 ? [] : [...ids],
    batch_service_id: index >= 4 && index <= 6 ? 1 : null,
  }));
  const payload = {
    contract_version: v.CONTRACT, source: 'trusted_existing_chrome_operator', environment: 'production', origin: ORIGIN, url: ORIGIN + '/shipping',
    commit: expected.commit, deployment_id: expected.deploymentId,
    browser_context: 'existing_user_chrome', existing_tab_id: '12345', new_tabs: 0, new_browser_contexts: 0,
    attestation_type: 'trusted_operator_browser', trust_boundary: 'operator_attestation_not_machine_proof', attestation_method: 'codex_chrome_control_existing_session', attested_by: 'codex', attested_at: now,
    viewport: { width: 1920, height: 873 }, org_id: '00000001-0000-0000-0000-000000000000', operator_id: '30000001-0000-0000-0000-000000000000',
    actions: [...v.ACTIONS], original_service_basis: 'initial_ui_resolution',
    orders: ids.map(order_id => ({ order_id, revision: 1, original_service_id: 2, original_input_service_id: null, source: 'existing_production_ledger', demo: false, status: 'awaiting_confirmation' })),
    observations, confirmation_clicked: false, business_write_requests_observed: [], result: 'pass',
    attachments: [], payload_regression: write('local.json', { contract_version: v.CONTRACT, source: 'local_target_payload_regression', commit: expected.commit, result: 'pass', production_requests_exercised: false, test_file: 'product-truth/product-code/app/shipping/workbench-service-selection.test.tsx', test_file_sha256: 'b'.repeat(64), test_log: testLog, exit_code: 0, timeout: false, assertions: localAssertions }),
  };
  function save() {
    payload.attachments = payload.observations.map((observation, index) => write('step-' + index + '.json', {
      source: 'redacted_existing_chrome_observation', contract_version: v.CONTRACT, commit: payload.commit, deployment_id: payload.deployment_id, origin: payload.origin,
      existing_tab_id: payload.existing_tab_id, org_id: payload.org_id, operator_id: payload.operator_id, action: observation.action, result: 'pass', redacted: true, observation,
    }));
    const reference = write('operator.json', payload);
    return { artifact_path: reference.path, sha256: reference.sha256, payload: structuredClone(payload) };
  }
  return { runtime, payload, save, write };
}
function mockFetch(t, respond) {
  const calls = [];
  global.fetch = async (url, options) => { calls.push({ url, options }); return respond ? respond(url, options) : new Response('{"error":"Unauthorized"}', { status: 401, headers: { 'content-type': 'application/json; charset=utf-8' } }); };
  t.after(() => { global.fetch = nativeFetch; });
  return calls;
}
function refreshEnvelope(envelope) { envelope.sha256 = sha(json(envelope.payload)); }

test('exports only the new finite contract and accepts candidate evidence without claiming Production requests', () => {
  assert.equal(v.CONTRACT, 'f054-service-selection-v1');
  assert.deepEqual(v.ITEMS, ['shipping_service_selection', 'shipping_access']);
  assert.equal(v.ACTIONS.length, 10);
  const base = { contract_version: v.CONTRACT, environment: 'preview', commit: expected.commit, result: 'pass', read_only: true, production_requests_exercised: false };
  const section = { shipping_service_selection: { payload: { ...base, per_order_isolation: true, payload_regression_passed: true } }, shipping_access: { payload: { ...base, anonymous_access_denied: true } } };
  assert.deepEqual(v.runtimeEvidenceBlockers(section, 'sandbox', expected), []);
  assert.ok(v.runtimeEvidenceBlockers(section, 'sandbox', { commit: 'b'.repeat(40) }).length);
  assert.ok(v.runtimeEvidenceBlockers({ ...section, shipping_tracking: {} }, 'sandbox', expected).length);
  section.shipping_service_selection.payload.production_requests_exercised = true;
  assert.ok(v.runtimeEvidenceBlockers(section, 'sandbox', expected).length);
});

test('collects exactly two anonymous fixed-origin application denials and copies immutable proof dependencies', async t => {
  const f = fixture(t), calls = mockFetch(t);
  const operator = f.save();
  const proof = await v.verify({ runtime: f.runtime, operator, ...expected });
  assert.deepEqual(Object.keys(proof).sort(), [...v.ITEMS, 'verifier'].sort());
  assert.deepEqual(calls.map(call => call.url), [ORIGIN + '/api/shipping/ledger?limit=1', ORIGIN + '/api/shipping/settings']);
  for (const { options } of calls) {
    assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, { Accept: 'application/json' }); assert.ok(options.signal instanceof AbortSignal); assert.equal(options.body, undefined);
  }
  assert.deepEqual(v.productionEvidenceBlockers(proof, { ...expected, runtime: f.runtime }), []);
  assert.deepEqual(v.runtimeEvidenceBlockers(proof, 'production', { ...expected, runtime: f.runtime }), []);
  assert.equal(proof.verifier.payload.source_operator_sha256, operator.sha256);
  assert.ok(proof.verifier.artifact_path.startsWith('production-runtime-verifier/'));
  assert.deepEqual(proof.shipping_service_selection.payload.operator_attestation.orders.map(order => order.original_input_service_id), [null, null]);
});

test('rejects wrong candidate, origin, browser, viewport, invented tickets, changed B, pending mutation and incorrect restore before networking', async t => {
  const patches = [
    value => { value.commit = 'b'.repeat(40); }, value => { value.deployment_id = 'dpl_other'; },
    value => { value.origin = 'https://preview.vercel.app'; }, value => { value.url = ORIGIN + '/sales-portal'; },
    value => { value.new_tabs = 1; }, value => { value.new_browser_contexts = 1; }, value => { value.browser_context = 'local_playwright'; },
    value => { value.viewport.width = 0; }, value => { value.org_id = 'org-other'; }, value => { value.operator_id = 'operator'; },
    value => { value.orders[1].order_id = value.orders[0].order_id; }, value => { value.orders[0].demo = true; },
    value => { value.orders[0].source = 'demo'; }, value => { value.orders[0].status = 'waybill_created'; }, value => { value.orders[0].revision = 0; },
    value => { value.observations[2].services[1].service_id = 1; },
    value => { value.observations[5].services[0].service_id = 2; },
    value => { value.observations[7].services[0].service_id = 1; },
    value => { value.actions = value.actions.slice(1); }, value => { value.original_service_basis = 'database_field'; },
    value => { value.confirmation_clicked = true; }, value => { delete value.confirmation_clicked; },
    value => { value.business_write_requests_observed = ['/api/shipping/ledger/order/confirm']; }, value => { value.appCookie = 'forbidden'; },
  ];
  const calls = mockFetch(t);
  for (const patch of patches) {
    const f = fixture(t); patch(f.payload);
    await assert.rejects(v.verify({ runtime: f.runtime, operator: f.save(), ...expected }));
  }
  assert.equal(calls.length, 0);
});

test('rejects changed observation attachments, identity mismatches and local regressions from a different SHA', async t => {
  const calls = mockFetch(t);
  for (const change of ['tamper', 'wrong-identity', 'wrong-local-sha', 'production-request-claim', 'test-log-tamper', 'test-log-wrong-hash', 'test-log-exit', 'test-log-timeout']) {
    const f = fixture(t), operator = f.save();
    if (change === 'test-log-tamper') fs.writeFileSync(path.join(f.runtime, 'test-log.txt'), 'changed target log');
    if (change === 'tamper') fs.writeFileSync(path.join(f.runtime, 'step-0.json'), '{}');
    if (change === 'wrong-identity') {
      const ref = operator.payload.attachments[0], value = JSON.parse(fs.readFileSync(path.join(f.runtime, ref.path), 'utf8'));
      value.operator_id = ids[0]; operator.payload.attachments[0] = f.write(ref.path, value);
    }
    if (['wrong-local-sha', 'production-request-claim', 'test-log-wrong-hash', 'test-log-exit', 'test-log-timeout'].includes(change)) {
      const value = JSON.parse(fs.readFileSync(path.join(f.runtime, 'local.json'), 'utf8'));
      if (change === 'wrong-local-sha') value.commit = 'b'.repeat(40);
      if (change === 'production-request-claim') value.production_requests_exercised = true;
      if (change === 'test-log-wrong-hash') value.test_log.sha256 = '0'.repeat(64);
      if (change === 'test-log-exit') value.exit_code = 1;
      if (change === 'test-log-timeout') value.timeout = true;
      operator.payload.payload_regression = f.write('local.json', value);
    }
    if (change !== 'tamper') { const ref = f.write('operator.json', operator.payload); operator.sha256 = ref.sha256; }
    await assert.rejects(v.verify({ runtime: f.runtime, operator, ...expected }));
  }
  assert.equal(calls.length, 0);
});

test('rejects transport/session injection, symlink escape and oversized JSON artifacts', async t => {
  const f = fixture(t), calls = mockFetch(t), operator = f.save();
  for (const extra of [{ request: () => {} }, { fetch: () => {} }, { token: 'secret' }, { appCookie: 'secret' }, { payload: {} }]) {
    await assert.rejects(v.verify({ runtime: f.runtime, operator, ...expected, ...extra }), /Unapproved field/);
  }
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'escape.json'), json(f.payload)); fs.symlinkSync(path.join(outside, 'escape.json'), path.join(f.runtime, 'link.json'));
  await assert.rejects(v.verify({ runtime: f.runtime, operator: { ...operator, artifact_path: 'link.json' }, ...expected }), /escapes runtime/);
  const bytes = json({ private: 'x'.repeat(128 * 1024) }); fs.writeFileSync(path.join(f.runtime, 'large.json'), bytes);
  await assert.rejects(v.verify({ runtime: f.runtime, operator: { ...operator, artifact_path: 'large.json', sha256: sha(bytes) }, ...expected }), /size/);
  assert.equal(calls.length, 0);
});

test('rejects HTML login pages, redirects, non-authentication JSON, oversized bodies and safe transport failures', async t => {
  for (const response of [
    () => new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    () => new Response('<html>login</html>', { status: 401, headers: { 'content-type': 'text/html' } }),
    () => new Response('', { status: 302, headers: { location: '/login' } }),
    () => Response.json({ error: 'not authentication' }, { status: 401 }),
    () => new Response('x'.repeat(17000), { status: 401, headers: { 'content-type': 'application/json' } }),
    () => { throw Error('PRIVATE_TRANSPORT_DETAIL'); },
  ]) {
    const f = fixture(t), calls = mockFetch(t, response);
    await assert.rejects(v.verify({ runtime: f.runtime, operator: f.save(), ...expected }), error => !error.message.includes('PRIVATE_TRANSPORT_DETAIL'));
    assert.equal(calls.length, 1);
  }
});

test('production recheck rejects modified envelopes, wrong origins and tampered sealed dependencies', async t => {
  const f = fixture(t); mockFetch(t);
  const proof = await v.verify({ runtime: f.runtime, operator: f.save(), ...expected });
  for (const patch of [
    value => { value.shipping_access.payload.origin = 'https://other.test'; },
    value => { value.verifier.payload.source_operator_sha256 = 'c'.repeat(64); },
    value => { value.shipping_service_selection.payload.operator_attestation.orders[0].demo = true; },
    value => { value.verifier.payload.probes[0].status = 200; },
    value => { value.verifier.artifact_path = '../outside.json'; },
  ]) {
    const changed = structuredClone(proof); patch(changed);
    for (const envelope of Object.values(changed)) refreshEnvelope(envelope);
    assert.ok(v.productionEvidenceBlockers(changed, expected).length);
  }
  const logFile = path.join(f.runtime, proof.shipping_service_selection.payload.payload_regression_test_log.path), originalLog = fs.readFileSync(logFile);
  fs.writeFileSync(logFile, 'tampered sealed log');
  assert.ok(v.productionEvidenceBlockers(proof, { ...expected, runtime: f.runtime }).length);
  fs.writeFileSync(logFile, originalLog);
  fs.writeFileSync(path.join(f.runtime, proof.shipping_service_selection.payload.payload_regression.path), '{}');
  assert.ok(v.productionEvidenceBlockers(proof, { ...expected, runtime: f.runtime }).length);
});

test('freshness blocks stale collection but historical sealed evidence remains verifiable', async t => {
  const f = fixture(t); mockFetch(t);
  const operator = f.save(), proof = await v.verify({ runtime: f.runtime, operator, ...expected });
  const originalNow = Date.now, later = originalNow() + 2 * 3600000;
  Date.now = () => later; t.after(() => { Date.now = originalNow; });
  await assert.rejects(v.verify({ runtime: f.runtime, operator, ...expected }), /Fresh observation/);
  assert.deepEqual(v.productionEvidenceBlockers(proof, { ...expected, runtime: f.runtime }), []);
  const future = structuredClone(proof); future.verifier.payload.observed_at = new Date(later + 120000).toISOString(); refreshEnvelope(future.verifier);
  assert.ok(v.productionEvidenceBlockers(future, expected).length);
  future.verifier.payload.observed_at = '2026-02-30T10:00:00Z'; refreshEnvelope(future.verifier);
  assert.ok(v.productionEvidenceBlockers(future, expected).length);
});
