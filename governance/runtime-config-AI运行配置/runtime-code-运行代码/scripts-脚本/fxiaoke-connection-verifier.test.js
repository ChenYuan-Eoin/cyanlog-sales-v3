const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('./fxiaoke-connection-verifier');
const expected = { commit: 'candidate', deploymentId: 'dpl_example', now: Date.parse('2026-10-28T03:00:00Z') };
const base = { contract_version: v.CONTRACT, commit: expected.commit, deployment_id: expected.deploymentId, attachments: [{ path: 'evidence.json', sha256: 'a'.repeat(64) }] };
const operator = { ...base, environment: 'production', url: 'https://sales.cyanlog.icu/configs?tab=org-structure', browser_context: 'existing_user_chrome', existing_tab_id: '123', new_tabs: 0, new_browser_contexts: 0, attestation_type: 'trusted_operator_browser', trust_boundary: 'operator_attestation_not_machine_proof', attestation_method: 'codex_chrome_control_existing_session', attested_by: 'operator', attested_at: '2026-10-28T03:00:00Z', actions: v.PRODUCTION_ACTIONS, save_status: 200, readback_verified: true, preview_status: 200, provider_connected: true, department_count: 2, employee_count: 3, sync_applied: false, primary_source_changed: false, sales_permissions_changed: false, result: 'pass' };
test('requires real production save, readback, provider preview and existing Chrome', () => {
  assert.deepEqual(v.productionOperatorBlockers(operator, expected), []);
  for (const patch of [{ preview_status: 502 }, { readback_verified: false }, { provider_connected: false }, { employee_count: 0 }, { department_count: 0 }, { sync_applied: true }, { new_tabs: 1 }, { commit: 'other' }, { actions: v.PREVIEW_ACTIONS }]) assert.notEqual(v.productionOperatorBlockers({ ...operator, ...patch }, expected).length, 0);
});
test('preview requires the approved view and forbids business mutations', () => {
  const p = { ...base, environment: 'preview', actions: v.PREVIEW_ACTIONS, internal_account_hidden: true, required_fields_visible: true, business_mutations: false };
  assert.deepEqual(v.previewBlockers(p, expected), []);
  assert.notEqual(v.previewBlockers({ ...p, business_mutations: true }, expected).length, 0);
  assert.notEqual(v.previewBlockers({ ...p, internal_account_hidden: false }, expected).length, 0);
});
test('controlled verifier checks anonymous denial and binds operator artifacts', async () => {
  const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'fxiaoke-verifier-test-'));
  try {
    const sha = value => crypto.createHash('sha256').update(value).digest('hex');
    const evidence = Buffer.from('redacted visual evidence');
    fs.writeFileSync(path.join(runtime, 'evidence.png'), evidence);
    const payload = { ...operator, attested_at: new Date().toISOString(), attachments: [{ path: 'evidence.png', sha256: sha(evidence) }] };
    const original = Buffer.from(JSON.stringify(payload));
    fs.writeFileSync(path.join(runtime, 'operator.json'), original);
    const envelope = { artifact_path: 'operator.json', sha256: sha(original), payload };
    const seen = [];
    const request = async (url, options) => { seen.push({ url, ...options }); return new Response(JSON.stringify({ error: '请先登录。' }), { status: 401, headers: { 'content-type': 'application/json' } }); };
    const result = await v.verify({ runtime, operator: envelope, commit: expected.commit, deploymentId: expected.deploymentId, request });
    assert.equal(seen.length, 2);
    assert.deepEqual(seen.map(x => x.method), ['GET', 'POST']);
    assert.ok(seen.every(x => x.credentials === 'omit'));
    assert.deepEqual(v.productionBlockers(result, expected), []);
    assert.notEqual(v.productionBlockers({ ...result, verifier: { payload: { ...result.verifier.payload, observed_at: 'invalid' } } }, expected).length, 0);
    assert.notEqual(v.productionBlockers({ ...result, connection_preview: { payload: { ...result.connection_preview.payload, source: 'machine' } } }, expected).length, 0);
    await assert.rejects(v.verify({ runtime, operator: envelope, commit: expected.commit, deploymentId: expected.deploymentId, request: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) }), /was not denied/);
    fs.writeFileSync(path.join(runtime, 'evidence.png'), 'tampered');
    await assert.rejects(v.verify({ runtime, operator: envelope, commit: expected.commit, deploymentId: expected.deploymentId, request }), /hash mismatch/);
  } finally { fs.rmSync(runtime, { recursive: true, force: true }); }
});
