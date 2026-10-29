const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const v = require('./shipping-parser-verifier');
const expected = { commit: 'a'.repeat(40), deploymentId: 'dpl_test' };
const operator = {
  contract_version: v.CONTRACT, environment: 'production', commit: expected.commit, deployment_id: expected.deploymentId,
  url: v.ORIGIN + '/shipping', browser_context: 'existing_user_chrome', new_tabs: 0, new_browser_contexts: 0,
  existing_tab_id: '123', attestation_type: 'trusted_operator_browser', trust_boundary: 'operator_attestation_not_machine_proof',
  attestation_method: 'codex_chrome_control_existing_session', attested_by: 'codex', attested_at: new Date().toISOString(),
  actions: v.ACTIONS, ...Object.fromEntries(v.FLAGS.map(key => [key, true])), sample_ids: ['beijing-office', 'wuxi-village'],
  valid_rows: 2, invalid_rows: 0, workorders_created: 0, existing_orders_changed: false, carrier_calls: 0, database_migrations: 0,
  actual_submission_verified: false, result: 'pass', attachments: [{ path: 'observation.txt', sha256: 'b'.repeat(64) }],
};
test('accepts only complete parser observations without claiming actual submission', () => {
  assert.deepEqual(v.productionOperatorBlockers(operator, expected), []);
  for (const field of v.FLAGS) assert.ok(v.productionOperatorBlockers({ ...operator, [field]: false }, expected).length, field);
  for (const patch of [
    { commit: 'wrong' }, { deployment_id: 'dpl_other' }, { url: 'https://preview.vercel.app/shipping' },
    { url: v.ORIGIN + '/sales-portal' }, { new_tabs: 1 }, { browser_context: 'local_playwright' },
    { attestation_type: 'machine_proof' }, { attested_at: new Date(Date.now() - 7200000).toISOString() },
    { actions: v.ACTIONS.slice(1) }, { valid_rows: 1 }, { invalid_rows: 1 }, { sample_ids: ['other'] },
    { workorders_created: 1 }, { existing_orders_changed: true }, { carrier_calls: 1 }, { database_migrations: 1 },
    { actual_submission_verified: true }, { attachments: [] }, { result: 'fail' },
  ]) assert.ok(v.productionOperatorBlockers({ ...operator, ...patch }, expected).length, JSON.stringify(patch));
});
test('release order preserves the approved product tree and rejects unrelated rule edits', () => {
  const approval = { type: 'final_production_release_authorization', source: 'user_explicit', state: 'approved', preview_order_exception: true,
    preview_status: 'not_passed', code_release_authorized: true, production_database_write_authorized: false, carrier_calls_authorized: false,
    approved_candidate: 'a'.repeat(40), approved_product_tree: 'b'.repeat(40), rollback_commit: 'c'.repeat(40) };
  const input = { approval, activeId: 'WP95', contractVersion: v.CONTRACT, productTree: approval.approved_product_tree, candidateIsAncestor: true, changedPaths: ['AGENTS.md'] };
  assert.deepEqual(v.productionFirstExceptionBlockers(input), []);
  for (const patch of [{ activeId: 'WP91' }, { productTree: 'd'.repeat(40) }, { candidateIsAncestor: false }, { changedPaths: ['product-truth/product-code/app/page.tsx'] }, { changedPaths: ['governance/unrelated.js'] }]) assert.ok(v.productionFirstExceptionBlockers({ ...input, ...patch }).length);
  for (const patch of [{ state: 'pending' }, { source: 'agent' }, { preview_status: 'passed' }, { carrier_calls_authorized: true }, { production_database_write_authorized: true }, { rollback_commit: '' }]) assert.ok(v.productionFirstExceptionBlockers({ ...input, approval: { ...approval, ...patch } }).length);
});
test('controlled verifier checks one read-only anonymous route and binds immutable raw observations', async () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-proof-'));
  const sha = value => crypto.createHash('sha256').update(value).digest('hex');
  try {
    const raw = Buffer.from('redacted original sample outputs and request log');
    fs.writeFileSync(path.join(runtime, 'observation.txt'), raw);
    const payload = { ...operator, attested_at: new Date().toISOString(), attachments: [{ path: 'observation.txt', sha256: sha(raw) }] };
    const original = Buffer.from(JSON.stringify(payload));
    fs.writeFileSync(path.join(runtime, 'operator.json'), original);
    const envelope = { artifact_path: 'operator.json', sha256: sha(original), payload };
    const seen = [];
    const request = async (url, options) => { seen.push({ url, ...options }); return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } }); };
    const result = await v.verify({ runtime, operator: envelope, ...expected, request });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, v.ORIGIN + '/api/shipping/ledger');
    assert.equal(seen[0].method, 'GET');
    assert.equal(seen[0].credentials, 'omit');
    assert.deepEqual(v.productionBlockers(result, expected), []);
    for (const patch of [{ read_only: false }, { source_operator_sha256: 'c'.repeat(64) }, { source: 'generic' }, { probe: { ...result.verifier.payload.probe, status: 200 } }]) assert.ok(v.productionBlockers({ ...result, verifier: { payload: { ...result.verifier.payload, ...patch } } }, expected).length);
    await assert.rejects(v.verify({ runtime, operator: envelope, ...expected, request: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) }), /Anonymous ledger access/);
    fs.writeFileSync(path.join(runtime, 'observation.txt'), 'tampered');
    await assert.rejects(v.verify({ runtime, operator: envelope, ...expected, request }), /hash mismatch/);
  } finally { fs.rmSync(runtime, { recursive: true, force: true }); }
});
