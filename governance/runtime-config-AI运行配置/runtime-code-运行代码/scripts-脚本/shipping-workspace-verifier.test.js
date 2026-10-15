const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { verify } = require('./shipping-workspace-verifier.js');
const { shippingWorkspaceEvidenceBlockers, SHIPPING_UI_FLAGS } = require('./project-registry.js');
const ORIGIN = 'https://sales.cyanlog.icu';
const CONTRACT_TABLES = ['contract_ai_chats','contract_comparisons','contract_items','contract_signatures','contract_risk_cards','contract_template_params','contract_rule_snapshots','contract_risk_card_fixes','contract_rules_v2','contract_drafts','contract_comparison_diffs'];
const TABLES = [...CONTRACT_TABLES, 'shipping_requests','shipping_contacts','shipping_outbound_imports','shipping_orders','shipping_waybills','shipping_tracking_events','shipping_intake_rate_limits','shipping_carrier_connections','shipping_billing_accounts','shipping_sender_profiles'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const id = digit => digit.repeat(8)+'-'+digit.repeat(4)+'-4'+digit.repeat(3)+'-8'+digit.repeat(3)+'-'+digit.repeat(12);

function fixture(t) {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'shipping-verifier-test-'));
  t.after(() => fs.rmSync(runtime, { recursive: true, force: true }));
  const now = Date.now(), stamp = seconds => new Date(now+seconds*1000).toISOString();
  const options = { commit: 'a'.repeat(40), deploymentId: 'dpl_example', runtime, token: 'example-management-token', ownerId: '30000001-0000-0000-0000-000000000000', orgId: '00000001-0000-0000-0000-000000000000', orderId: id('3'), waybill: 'SF1234567890123' };
  const ui = {
    source: 'trusted_existing_chrome_operator', commit: options.commit, deployment_id: options.deploymentId, origin: ORIGIN, environment: 'production', org_id: options.orgId, operator_id: options.ownerId,
    browser_context: 'existing_user_chrome', existing_tab_id: '1234', new_tabs: 0, new_browser_contexts: 0,
    attestation_type: 'trusted_operator_browser', trust_boundary: 'operator_attestation_not_machine_proof', attested_by: 'codex:operator', attested_at: stamp(-30),
    ledger_filters: ['sales','customer','contact','status'],
    tracking: { order_id: options.orderId, waybill: options.waybill, app_endpoint: ORIGIN+'/api/shipping/tracking', started_at: stamp(-110), observed_at: stamp(-90), success: true, source: 'carrier', mock: false, event_count: 2 },
    cancellation: { order_id: id('4'), waybill: 'SF1234567890456', started_at: stamp(-80), observed_at: stamp(-60), success: true, before_status: 'waybill_created', after_status: 'cancelled', service_code: 'EXP_RECE_UPDATE_ORDER' },
    attachments: [],
  };
  for (const key of ['page_accessible','anonymous_form_submittable','receipt_recoverable','owner_direct_available','review_queue_available','production_submission_enabled','configuration_center','credentials_masked','public_intake_allowed','guest_ledger_denied','owner_can_read','relationship_assignment_controlled','rate_limit_enforced']) ui[key] = true;
  for (const action of ['workspace','configuration','access','tracking','cancellation']) {
    const data = { source: 'redacted_existing_chrome_observation', commit: options.commit, deployment_id: options.deploymentId, origin: ORIGIN, org_id: options.orgId, operator_id: options.ownerId, existing_tab_id: ui.existing_tab_id, action, result: 'pass', observed_at: action === 'tracking' ? ui.tracking.observed_at : action === 'cancellation' ? ui.cancellation.observed_at : stamp(-40), redacted: true };
    const bytes = Buffer.from(JSON.stringify(data)), filename = action+'.json';
    fs.writeFileSync(path.join(runtime, filename), bytes);
    ui.attachments.push({ path: filename, sha256: hash(bytes), media_type: 'application/json', redacted: true });
  }
  function seal() {
    const bytes = Buffer.from(JSON.stringify(ui));
    fs.writeFileSync(path.join(runtime, 'operator.json'), bytes);
    options.operator = { artifact_path: 'operator.json', sha256: hash(bytes), payload: structuredClone(ui) };
  }
  seal();
  const snapshot = (cancelled = false) => ({
    order_id: cancelled ? ui.cancellation.order_id : options.orderId, org_id: options.orgId, status: cancelled ? 'cancelled' : 'in_transit', order_updated_at: stamp(-70),
    waybill_id: cancelled ? id('6') : id('5'), waybill_no: cancelled ? ui.cancellation.waybill : options.waybill,
    latest_status: cancelled ? 'cancelled' : 'in_transit', latest_event_at: stamp(-3600), connection_id: id('7'), connection_org_id: options.orgId,
    environment: 'production', connection_status: 'connected', tracking_capability: 'verified', cancel_capability: 'verified', connection_updated_at: stamp(-70), account_org_id: options.orgId, account_status: 'active', sender_org_id: options.orgId, snapshot_matches: true,
  });
  const data = {
    catalog: TABLES.map(relname => ({ relname, relrowsecurity: true })),
    acl: TABLES.map(relname => ({ relname, anon_access: false, client_access: false, service_read: true, service_insert: !CONTRACT_TABLES.includes(relname), service_update: !CONTRACT_TABLES.includes(relname) && relname !== 'shipping_tracking_events', service_delete: ['shipping_intake_rate_limits','shipping_carrier_connections','shipping_billing_accounts','shipping_sender_profiles'].includes(relname) })),
    rpc: ['exec_sql','claim_contract_analysis_job','claim_shipping_intake_rate'].map(name => ({ name, signature: name+'(text)', anon_execute: false, client_execute: false, service_execute: true })),
    advisor: { lints: [] },
    users: [{ id: options.ownerId, status: 'active', login_enabled: true, org_matches: true }],
    tracked: [snapshot()], cancelled: [snapshot(true)],
    events: [{ event_count: 2, latest_event_at: stamp(-3600), latest_persisted_at: stamp(-100) }],
    boundaries: { '/shipping': { status: 307, location: '/login?redirect=%2Fshipping' }, '/sales-portal': { status: 200 } },
  };
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    requests.push({ url, init });
    const parsed = new URL(url);
    if (parsed.origin === ORIGIN) {
      assert.equal(init.method, undefined, 'application probes must be anonymous GET');
      assert.equal(init.headers, undefined, 'no copied session credential is permitted');
      assert.equal(init.redirect, 'manual');
      assert.ok(['/shipping','/sales-portal','/api/shipping/orders','/api/shipping/contacts','/api/shipping/ledger','/api/shipping/settings'].includes(parsed.pathname));
      const boundary = data.boundaries[parsed.pathname] || { status: 401 };
      return new Response('synthetic page', { status: boundary.status, headers: boundary.location ? { location: boundary.location } : {} });
    }
    assert.equal(parsed.origin, 'https://api.supabase.com', 'no carrier or other external requests');
    assert.equal(init.redirect, 'error', 'management credentials must not follow redirects');
    if (parsed.pathname.endsWith('/advisors/security')) return Response.json(data.advisor);
    assert.equal(parsed.pathname, '/v1/projects/wfawwhphfqqwfwrrkogy/database/query');
    assert.equal(init.method, 'POST');
    const sql = JSON.parse(init.body).query;
    assert.match(sql, /^select\s/i);
    assert.doesNotMatch(sql, /;|auth_tokens|credentials_ciphertext|account_ciphertext|verification_suffix|shipment_payload|raw_payload|sfPartner|sfCheckWord/i);
    let result;
    if (sql.includes('from pg_class')) result = sql.includes('has_table_privilege') ? data.acl : data.catalog;
    else if (sql.includes('from pg_proc')) result = data.rpc;
    else if (sql.includes('from public.users')) result = data.users;
    else if (sql.includes('from public.shipping_tracking_events')) result = data.events;
    else if (sql.includes('from public.shipping_orders')) result = ui.cancellation && sql.includes("o.id='"+ui.cancellation.order_id+"'") ? data.cancelled : data.tracked;
    else assert.fail('Unexpected SQL');
    return Response.json(result);
  });
  return { options, ui, data, seal, requests, runtime, stamp };
}

function uiFixture(t) {
  const f = fixture(t);
  f.options.contractVersion = 'f054-ui-v1';
  delete f.ui.cancellation;
  f.ui.attachments = f.ui.attachments.filter(item => item.path !== 'cancellation.json');
  for (const key of SHIPPING_UI_FLAGS) f.ui[key] = true;
  f.seal();
  return f;
}

test('UI release verifies unchanged security boundaries and existing tracking without requiring a cancellation', async t => {
  const f = uiFixture(t);
  f.data.tracked[0].sender_org_id = null;
  f.data.tracked[0].snapshot_matches = false;
  f.data.tracked[0].connection_updated_at = f.stamp(-3600);
  const result = await verify(f.options);
  assert.deepEqual(shippingWorkspaceEvidenceBlockers(result, 'production', 'f054-ui-v1'), []);
  assert.equal(result.shipping_workspace.payload.cancel_before_collection_verified, undefined);
  const sql = f.requests.filter(item => item.init.body).map(item => JSON.parse(item.init.body).query);
  assert.equal(sql.filter(query => query.includes('from public.shipping_orders')).length, 1);
  assert.ok(sql.every(query => /^select\s/i.test(query)));
  assert.ok(sql.filter(query => query.includes('from public.shipping_orders')).every(query => !query.includes('sender_profile')));
});

test('UI-only historical tracking still rejects a cross-organization connection', async t => {
  const f = uiFixture(t); f.data.tracked[0].connection_org_id = id('9');
  await assert.rejects(verify(f.options), /organization mismatch/);
});

for (const [label, mutate, message] of [
  ['missing draft retention', f => { f.ui.draft_retention = false; }, /draft_retention/],
  ['business mutation', f => { f.ui.no_business_mutations = false; }, /no_business_mutations/],
  ['cancellation included in UI-only evidence', f => { f.ui.cancellation = {}; }, /must not contain cancellation/],
  ['unknown UI contract', f => { f.options.contractVersion = 'anything'; }, /Unsupported verification contract/],
]) test('UI release rejects '+label, async t => {
  const f = uiFixture(t); mutate(f); f.seal();
  await assert.rejects(verify(f.options), message);
  assert.equal(f.requests.length, 0);
});

test('verifies current deployed shipping flow using SQL and explicit Chrome attestations, preserving evidence hashes', async t => {
  const f = fixture(t), result = await verify(f.options);
  assert.deepEqual(shippingWorkspaceEvidenceBlockers(result, 'production', 'f054-v2'), []);
  assert.equal(result.shipping_tracking.payload.source, 'production_database');
  assert.equal(result.shipping_tracking.payload.mock, false);
  assert.equal(result.shipping_tracking.payload.operator_observations_are_attested, true);
  assert.equal(result.shipping_tracking.payload.event_count, 2);
  assert.equal(result.shipping_workspace.payload.cancelled_order_id, f.ui.cancellation.order_id);
  for (const envelope of Object.values(result)) {
    assert.ok(envelope.artifact_path.startsWith('production-runtime-verifier/'));
    const bytes = fs.readFileSync(path.join(f.runtime, envelope.artifact_path));
    assert.equal(hash(bytes), envelope.sha256);
    assert.deepEqual(JSON.parse(bytes), envelope.payload);
    for (const attachment of envelope.payload.attachments) {
      assert.ok(attachment.path.startsWith('production-runtime-verifier/'));
      assert.equal(hash(fs.readFileSync(path.join(f.runtime, attachment.path))), attachment.sha256);
    }
  }
  const copied = result.verifier.payload.operator_attestation;
  assert.deepEqual(fs.readFileSync(path.join(f.runtime, copied.path)), fs.readFileSync(path.join(f.runtime, 'operator.json')));
  const serialized = JSON.stringify(result)+Object.values(result).flatMap(envelope => envelope.payload.attachments.map(item => fs.readFileSync(path.join(f.runtime, item.path), 'utf8'))).join('');
  assert.ok(!serialized.includes(f.options.token));
  assert.ok(!serialized.includes('tracking_verified_at'));
});

for (const [label, mutate, message] of [
  ['workspace unexpectedly public', f => { f.data.boundaries['/shipping'] = { status: 200 }; }, /boundary failed/],
  ['portal requires login', f => { f.data.boundaries['/sales-portal'] = { status: 307, location: '/login' }; }, /boundary failed/],
  ['private ledger accessible', f => { f.data.boundaries['/api/shipping/ledger'] = { status: 200 }; }, /boundary failed/],
  ['redirect leaves product domain', f => { f.data.boundaries['/shipping'].location = 'https://other.invalid/login'; }, /boundary failed/],
  ['missing new configuration table', f => { f.data.catalog.pop(); }, /catalog incomplete/],
  ['missing original contract private table', f => { f.data.catalog.shift(); }, /catalog incomplete/],
  ['new configuration table has RLS disabled', f => { f.data.catalog.at(-1).relrowsecurity = false; }, /RLS disabled/],
  ['new configuration table readable by client', f => { f.data.acl.at(-1).client_access = true; }, /ACL mismatch/],
  ['INSERT privilege absent despite SELECT being available', f => { f.data.acl.at(-1).service_insert = false; }, /INSERT privilege/],
  ['UPDATE privilege absent despite SELECT being available', f => { f.data.acl.at(-1).service_update = false; }, /UPDATE privilege/],
  ['DELETE privilege absent despite SELECT being available', f => { f.data.acl.at(-1).service_delete = false; }, /DELETE privilege/],
  ['tracking event INSERT permission absent', f => { f.data.acl.find(row => row.relname === 'shipping_tracking_events').service_insert = false; }, /INSERT privilege/],
  ['original protected RPC check absent', f => { f.data.rpc.shift(); }, /RPC permissions/],
  ['rate RPC callable anonymously', f => { f.data.rpc[0].anon_execute = true; }, /RPC permissions/],
  ['security advisor missing results', f => { f.data.advisor = {}; }, /advisor result/],
  ['organization member disabled', f => { f.data.users[0].login_enabled = false; }, /membership mismatch/],
  ['cross organization account', f => { f.data.tracked[0].account_org_id = id('8'); }, /organization mismatch/],
  ['sandbox connection', f => { f.data.tracked[0].environment = 'sandbox'; }, /snapshot mismatch/],
  ['missing order', f => { f.data.tracked = []; }, /snapshot not found/],
  ['invalid immutable snapshot', f => { f.data.tracked[0].snapshot_matches = false; }, /snapshot mismatch/],
  ['tracking never verified', f => { f.data.tracked[0].tracking_capability = 'not_tested'; }, /capability/],
  ['stale connection update', f => { f.data.tracked[0].connection_updated_at = f.stamp(-7200); }, /capability/],
  ['tracking events absent', f => { f.data.events[0].event_count = 0; }, /tracking events missing/],
  ['observed events not persisted', f => { f.data.events[0].event_count = 1; }, /tracking events missing/],
  ['invalid event timestamp', f => { f.data.events[0].latest_event_at = 'not-a-date'; }, /timestamp/],
  ['cancellation absent', f => { f.data.cancelled[0].status = 'waybill_created'; }, /cancellation missing/],
  ['cancellation capability unverified', f => { f.data.cancelled[0].cancel_capability = 'not_tested'; }, /cancellation missing/],
  ['old cancellation unrelated to observation', f => { f.data.cancelled[0].order_updated_at = f.stamp(-7200); }, /Cancellation time/],
]) {
  test('rejects '+label, async t => {
    const f = fixture(t); mutate(f);
    await assert.rejects(verify(f.options), message);
    assert.equal(fs.existsSync(path.join(f.runtime, 'production-runtime-verifier')), false, 'failed verification must not publish evidence');
  });
}

for (const [label, mutate, message] of [
  ['sandbox mock response', f => { f.ui.tracking.source = 'sandbox_mock'; f.ui.tracking.mock = true; }, /non-mock/],
  ['missing actual response source', f => { delete f.ui.tracking.source; }, /non-mock/],
  ['wrong observed order', f => { f.ui.tracking.order_id = id('8'); }, /target mismatch/],
  ['different deployment', f => { f.ui.deployment_id = 'dpl_other'; }, /Current Production/],
  ['unobserved masking', f => { delete f.ui.credentials_masked; }, /credentials_masked/],
  ['unobserved rate limiting', f => { f.ui.rate_limit_enforced = false; }, /rate_limit_enforced/],
  ['new browser session', f => { f.ui.new_browser_contexts = 1; }, /Existing Chrome/],
  ['stale attestation', f => { f.ui.attested_at = f.stamp(-7200); }, /not fresh/],
  ['wrong cancellation service', f => { f.ui.cancellation.service_code = 'OTHER'; }, /cancellation observation/],
  ['PII in operator payload', f => { f.ui.recipient_address = 'synthetic forbidden address'; }, /Unapproved field/],
  ['HTML attachment', f => { f.ui.attachments[0].media_type = 'text/html'; }, /redacted JSON/],
  ['missing attachment redaction', f => { f.ui.attachments[0].redacted = false; }, /redacted JSON/],
]) {
  test('rejects '+label+' before any network request', async t => {
    const f = fixture(t); mutate(f); f.seal();
    await assert.rejects(verify(f.options), message);
    assert.equal(f.requests.length, 0);
  });
}

test('rejects tampered original artifacts and payload mismatches', async t => {
  const f = fixture(t);
  f.options.operator.payload.credentials_masked = false;
  await assert.rejects(verify(f.options), /payload mismatch/);
  f.seal();
  fs.appendFileSync(path.join(f.runtime, 'tracking.json'), ' ');
  await assert.rejects(verify(f.options), /hash mismatch/);
  assert.equal(f.requests.length, 0);
});

test('rejects an extra private field in a freshly hashed attachment', async t => {
  const f = fixture(t), attachment = f.ui.attachments[0];
  const filename = path.join(f.runtime, attachment.path), data = JSON.parse(fs.readFileSync(filename));
  data.token = 'example-forbidden-value';
  const bytes = Buffer.from(JSON.stringify(data)); fs.writeFileSync(filename, bytes); attachment.sha256 = hash(bytes); f.seal();
  await assert.rejects(verify(f.options), /Unapproved field/);
  assert.equal(f.requests.length, 0);
});

test('rejects carrier credentials, session tokens or injected production transport', async t => {
  const f = fixture(t);
  for (const key of ['sfPartner','sfCheckWord','appToken','appRequest','fetch']) {
    await assert.rejects(verify({ ...f.options, [key]: 'forbidden' }), /no carrier\/session/);
  }
  assert.equal(f.requests.length, 0);
});

test('rejects malformed UUID input before constructing SQL', async t => {
  const f = fixture(t);
  await assert.rejects(verify({ ...f.options, orgId: "' OR true--" }), /Explicit operator/);
  assert.equal(f.requests.length, 0);
});

test('all business SELECT column references exist in the actual shipping migrations', async t => {
  const f = fixture(t);
  await verify(f.options);
  const migrations = path.resolve(__dirname, '../../../../product-truth/product-code/supabase/migrations');
  const schema = new Map();
  for (const filename of fs.readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(migrations, filename), 'utf8');
    for (const match of sql.matchAll(/create table(?: if not exists)? (?:public\.)?(shipping_[a-z_]+)\s*\(([\s\S]*?)\n\);/gi)) {
      const columns = schema.get(match[1]) || new Set();
      for (const line of match[2].split('\n')) {
        const column = /^\s*([a-z_]+)\s+(?:uuid|text|jsonb|timestamptz|integer|boolean)\b/i.exec(line);
        if (column) columns.add(column[1]);
      }
      schema.set(match[1], columns);
    }
    for (const match of sql.matchAll(/alter table(?: if exists)? (?:public\.)?(shipping_[a-z_]+)([\s\S]*?);/gi)) {
      const columns = schema.get(match[1]);
      if (!columns) continue;
      for (const column of match[2].matchAll(/add column(?: if not exists)? ([a-z_]+)\b/gi)) columns.add(column[1]);
    }
  }
  const aliases = { o: 'shipping_orders', w: 'shipping_waybills', c: 'shipping_carrier_connections', b: 'shipping_billing_accounts', s: 'shipping_sender_profiles', e: 'shipping_tracking_events' };
  const businessQueries = f.requests.filter(request => request.init.body).map(request => JSON.parse(request.init.body).query).filter(sql => /from public\.shipping_(orders|tracking_events)\b/.test(sql));
  assert.equal(businessQueries.length, 3);
  for (const query of businessQueries) {
    for (const [, alias, column] of query.matchAll(/\b([owcbse])\.([a-z_]+)\b/g)) {
      assert.ok(schema.get(aliases[alias])?.has(column), 'Unknown migration column '+aliases[alias]+'.'+column);
    }
  }
});
