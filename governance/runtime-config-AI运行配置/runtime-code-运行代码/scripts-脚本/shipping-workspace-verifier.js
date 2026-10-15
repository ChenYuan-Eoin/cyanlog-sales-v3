// Production SQL is read-only. Chrome observations are operator attestations,
// not independently captured HTTP responses. This verifier never places orders.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SHIPPING_UI_FLAGS } = require('./project-registry');
const PROJECT = 'wfawwhphfqqwfwrrkogy';
const ORIGIN = 'https://sales.cyanlog.icu';
const CONTRACT_TABLES = ['contract_ai_chats','contract_comparisons','contract_items','contract_signatures','contract_risk_cards','contract_template_params','contract_rule_snapshots','contract_risk_card_fixes','contract_rules_v2','contract_drafts','contract_comparison_diffs'];
const SHIPPING_TABLES = ['shipping_requests', 'shipping_contacts', 'shipping_outbound_imports', 'shipping_orders', 'shipping_waybills', 'shipping_tracking_events', 'shipping_intake_rate_limits', 'shipping_carrier_connections', 'shipping_billing_accounts', 'shipping_sender_profiles'];
const TABLES = [...CONTRACT_TABLES, ...SHIPPING_TABLES];
const DELETE_TABLES = ['shipping_intake_rate_limits', 'shipping_carrier_connections', 'shipping_billing_accounts', 'shipping_sender_profiles'];
const RPC_NAMES = ['exec_sql', 'claim_contract_analysis_job', 'claim_shipping_intake_rate'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WAYBILL = /^(?:SF)?[0-9]{10,15}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UI_FLAGS = ['page_accessible', 'anonymous_form_submittable', 'receipt_recoverable', 'owner_direct_available', 'review_queue_available', 'production_submission_enabled', 'configuration_center', 'credentials_masked', 'public_intake_allowed', 'guest_ledger_denied', 'owner_can_read', 'relationship_assignment_controlled', 'rate_limit_enforced'];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function assert(condition, message) { if (!condition) throw Error(message); }
function exactKeys(value, keys, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Invalid '+label);
  assert(Object.keys(value).every(key => keys.includes(key)), 'Unapproved field in '+label);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function time(value) {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)), 'Invalid observation timestamp');
  return Date.parse(value);
}
function readArtifact(runtime, file, expectedHash) {
  assert(typeof file === 'string' && SHA256.test(expectedHash || ''), 'Invalid operator artifact reference');
  const base = fs.realpathSync(runtime), resolved = fs.realpathSync(path.resolve(runtime, file));
  assert(resolved.startsWith(base+path.sep) && path.extname(resolved) === '.json', 'Only scoped redacted JSON operator artifacts are allowed');
  const stat = fs.statSync(resolved);
  assert(stat.isFile() && stat.size > 0 && stat.size <= 128*1024, 'Invalid operator artifact size');
  const bytes = fs.readFileSync(resolved);
  assert(hash(bytes) === expectedHash, 'Operator artifact hash mismatch');
  return { bytes, value: JSON.parse(bytes.toString('utf8')) };
}
function verifyOperator({ runtime, operator, commit, deploymentId, orgId, ownerId, orderId, waybill, now, contractVersion }) {
  const artifact = readArtifact(runtime, operator?.artifact_path, operator?.sha256);
  assert(JSON.stringify(canonical(artifact.value)) === JSON.stringify(canonical(operator.payload)), 'Operator envelope payload mismatch');
  const ui = artifact.value;
  const uiOnly = contractVersion === 'f054-ui-v1';
  exactKeys(ui, ['source', 'commit', 'deployment_id', 'origin', 'environment', 'org_id', 'operator_id', 'browser_context', 'existing_tab_id', 'new_tabs', 'new_browser_contexts', 'attestation_type', 'trust_boundary', 'attested_by', 'attested_at', 'ledger_filters', 'tracking', 'cancellation', 'attachments', ...UI_FLAGS, ...(uiOnly ? SHIPPING_UI_FLAGS : [])], 'operator evidence');
  assert(ui.source === 'trusted_existing_chrome_operator' && ui.commit === commit && ui.deployment_id === deploymentId && ui.origin === ORIGIN && ui.environment === 'production', 'Current Production operator attestation required');
  assert(ui.org_id === orgId && ui.operator_id === ownerId, 'Operator organization or identity mismatch');
  assert(ui.browser_context === 'existing_user_chrome' && ui.new_tabs === 0 && ui.new_browser_contexts === 0 && /^[a-zA-Z0-9_-]{1,100}$/.test(ui.existing_tab_id || ''), 'Existing Chrome session required');
  assert(ui.attestation_type === 'trusted_operator_browser' && ui.trust_boundary === 'operator_attestation_not_machine_proof' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(ui.attested_by || ''), 'Explicit operator trust boundary required');
  const attested = time(ui.attested_at);
  assert(attested <= now + 60_000 && now - attested <= 60*60_000, 'Operator attestation is not fresh');
  for (const key of (uiOnly ? [...SHIPPING_UI_FLAGS, 'guest_ledger_denied', 'owner_can_read'] : UI_FLAGS)) assert(ui[key] === true, 'Missing operator observation: '+key);
  if (!uiOnly) assert(Array.isArray(ui.ledger_filters) && ui.ledger_filters.length === 4 && ['sales', 'customer', 'contact', 'status'].every(key => ui.ledger_filters.includes(key)), 'Complete ledger filter observations required');
  exactKeys(ui.tracking, ['order_id', 'waybill', 'app_endpoint', 'started_at', 'observed_at', 'success', 'source', 'mock', 'event_count'], 'tracking observation');
  assert(ui.tracking.order_id === orderId && ui.tracking.waybill === waybill && ui.tracking.app_endpoint === ORIGIN+'/api/shipping/tracking', 'Tracking observation target mismatch');
  assert(ui.tracking.success === true && ui.tracking.source === 'carrier' && ui.tracking.mock === false && Number.isInteger(ui.tracking.event_count) && ui.tracking.event_count > 0, 'Real non-mock tracking observation required');
  if (uiOnly) assert(ui.cancellation === undefined, 'UI-only release must not contain cancellation operations');
  else {
    exactKeys(ui.cancellation, ['order_id', 'waybill', 'started_at', 'observed_at', 'success', 'before_status', 'after_status', 'service_code'], 'cancellation observation');
    assert(UUID.test(ui.cancellation.order_id || '') && WAYBILL.test(ui.cancellation.waybill || '') && ui.cancellation.success === true && ui.cancellation.before_status === 'waybill_created' && ui.cancellation.after_status === 'cancelled' && ui.cancellation.service_code === 'EXP_RECE_UPDATE_ORDER', 'Successful pre-collection cancellation observation required');
  }
  for (const item of (uiOnly ? [ui.tracking] : [ui.tracking, ui.cancellation])) {
    const started = time(item.started_at), observed = time(item.observed_at);
    assert(started <= observed && observed <= attested && now - started <= 60*60_000, 'Observation time sequence mismatch');
  }
  assert(Array.isArray(ui.attachments) && ui.attachments.length > 0, 'Redacted operator observation attachments required');
  const actions = new Set();
  const attachments = ui.attachments.map(item => {
    exactKeys(item, ['path', 'sha256', 'media_type', 'redacted'], 'operator attachment');
    assert(item.media_type === 'application/json' && item.redacted === true, 'Only redacted JSON observations may be copied');
    const entry = readArtifact(runtime, item.path, item.sha256), value = entry.value;
    exactKeys(value, ['source', 'commit', 'deployment_id', 'origin', 'org_id', 'operator_id', 'existing_tab_id', 'action', 'result', 'observed_at', 'redacted'], 'redacted observation');
    assert(value.source === 'redacted_existing_chrome_observation' && value.redacted === true && value.commit === commit && value.deployment_id === deploymentId && value.origin === ORIGIN && value.org_id === orgId && value.operator_id === ownerId && value.existing_tab_id === ui.existing_tab_id, 'Redacted observation binding mismatch');
    assert((uiOnly ? ['workspace', 'configuration', 'access', 'tracking'] : ['workspace', 'configuration', 'access', 'tracking', 'cancellation']).includes(value.action) && value.result === 'pass', 'Invalid redacted observation action');
    assert(time(value.observed_at) <= attested && now - time(value.observed_at) <= 60*60_000, 'Redacted observation is not fresh');
    if (value.action === 'tracking' || value.action === 'cancellation') assert(value.observed_at === ui[value.action].observed_at, 'Observation attachment timestamp mismatch');
    actions.add(value.action);
    return entry.bytes;
  });
  assert((uiOnly ? ['workspace', 'configuration', 'access', 'tracking'] : ['workspace', 'configuration', 'access', 'tracking', 'cancellation']).every(action => actions.has(action)), 'Operator observation attachment coverage incomplete');
  return { ui, bytes: artifact.bytes, attachments };
}

async function verify(options) {
  const { commit, deploymentId, runtime, operator, token, ownerId, orgId, orderId, waybill } = options;
  assert(!('sfPartner' in options) && !('sfCheckWord' in options) && !('appToken' in options) && !('appRequest' in options) && !('fetch' in options), 'Verifier accepts no carrier/session credentials or injected live transport');
  assert(/^[0-9a-f]{40}$/.test(commit || '') && /^dpl_[A-Za-z0-9]+$/.test(deploymentId || ''), 'Exact Production commit and deployment required');
  assert(UUID.test(ownerId || '') && UUID.test(orgId || '') && UUID.test(orderId || '') && WAYBILL.test(waybill || ''), 'Explicit operator, organization, order and waybill required');
  assert(typeof token === 'string' && token.length > 0, 'Existing Supabase management credential required');
  const contractVersion = options.contractVersion || 'f054-v2';
  assert(['f054-v2', 'f054-ui-v1'].includes(contractVersion), 'Unsupported verification contract');
  const uiOnly = contractVersion === 'f054-ui-v1';
  const now = Date.now();
  const proof = verifyOperator({ runtime, operator, commit, deploymentId, orgId, ownerId, orderId, waybill, now, contractVersion });
  const ui = proof.ui;
  async function getJson(url, init = {}) {
    const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) });
    assert(response.ok, 'Read-only verifier request failed: '+response.status);
    return response.json();
  }
  async function query(sql) {
    assert(/^select\s/i.test(sql.trim()) && !sql.includes(';'), 'Only a single fixed SELECT is permitted');
    const result = await getJson(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, { method: 'POST', headers: { Authorization: 'Bearer '+token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
    assert(Array.isArray(result), 'Database result must be an array');
    return result;
  }
  const evidence = {};
  const names = TABLES.map(name => "'"+name+"'").join(',');
  const catalog = await query(`select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${names})`);
  const coversTables = rows => rows.length === TABLES.length && TABLES.every(name => rows.filter(row => row.relname === name).length === 1);
  assert(coversTables(catalog), 'Shipping security catalog incomplete');
  assert(catalog.every(row => row.relrowsecurity === true), 'Shipping RLS disabled');
  evidence.catalog = catalog.map(({ relname, relrowsecurity }) => ({ relname, relrowsecurity }));
  evidence.rls = evidence.catalog.map(row => ({ table: row.relname, enabled: row.relrowsecurity }));
  const acl = await query(`select c.relname,has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access,has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as client_access,has_table_privilege('service_role',c.oid,'SELECT') as service_read,has_table_privilege('service_role',c.oid,'INSERT') as service_insert,has_table_privilege('service_role',c.oid,'UPDATE') as service_update,has_table_privilege('service_role',c.oid,'DELETE') as service_delete from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${names})`);
  assert(coversTables(acl) && acl.every(row => row.anon_access === false && row.client_access === false && row.service_read === true), 'Private table ACL mismatch');
  // has_table_privilege with a comma list means ANY privilege. Required server
  // operations must therefore be checked separately, following the migrations.
  for (const row of acl.filter(item => SHIPPING_TABLES.includes(item.relname))) {
    assert(row.service_insert === true, 'Shipping INSERT privilege missing: '+row.relname);
    if (row.relname !== 'shipping_tracking_events') assert(row.service_update === true, 'Shipping UPDATE privilege missing: '+row.relname);
    if (DELETE_TABLES.includes(row.relname)) assert(row.service_delete === true, 'Shipping DELETE privilege missing: '+row.relname);
  }
  evidence.acl = acl.map(({ relname, anon_access, client_access, service_read, service_insert, service_update, service_delete }) => ({ relname, anon_access, client_access, service_read, service_insert, service_update, service_delete }));
  const rpc = await query("select p.proname as name,p.oid::regprocedure::text as signature,has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') as client_execute,has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('exec_sql','claim_contract_analysis_job','claim_shipping_intake_rate')");
  assert(RPC_NAMES.every(name => rpc.some(row => row.name === name)) && rpc.every(row => RPC_NAMES.includes(row.name) && row.anon_execute === false && row.client_execute === false && row.service_execute === true), 'Protected RPC permissions mismatch');
  evidence.rpc = rpc.map(({ name, signature, anon_execute, client_execute, service_execute }) => ({ name, signature, anon_execute, client_execute, service_execute }));
  const advisor = await getJson(`https://api.supabase.com/v1/projects/${PROJECT}/advisors/security`, { headers: { Authorization: 'Bearer '+token } });
  assert(Array.isArray(advisor.lints), 'Security advisor result unavailable');
  const relevant = advisor.lints.filter(item => TABLES.includes(item.metadata?.name));
  assert(!relevant.some(item => item.level === 'ERROR'), 'Scoped security advisor errors remain');
  evidence.advisor = { scope: TABLES, checked: true, scoped_error_count: 0 };
  const boundaries = {};
  for (const route of ['/shipping', '/sales-portal', '/api/shipping/orders', '/api/shipping/contacts', '/api/shipping/ledger', '/api/shipping/settings']) {
    const response = await fetch(ORIGIN+route, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    const location = response.headers.get('location');
    const loginRedirect = [302, 303, 307, 308].includes(response.status) && location && new URL(location, ORIGIN).origin === ORIGIN && new URL(location, ORIGIN).pathname === '/login';
    assert(route === '/shipping' ? loginRedirect : response.status === (route === '/sales-portal' ? 200 : 401), 'Production public/private boundary failed: '+route);
    boundaries[route] = { status: response.status, ...(route === '/shipping' ? { redirect_path: '/login' } : {}) };
    if (response.body) await response.body.cancel();
  }
  evidence.anon = boundaries;
  const users = await query(`select u.id,u.status,u.login_enabled,(u.org_id='${orgId}' or exists(select 1 from public.user_organizations m where m.user_id=u.id and m.org_id='${orgId}')) as org_matches from public.users u where u.id='${ownerId}'`);
  assert(users.length === 1 && users[0].id === ownerId && users[0].status === 'active' && users[0].login_enabled === true && users[0].org_matches === true, 'Operator organization membership mismatch');
  evidence.operator_membership = { operator_id: ownerId, org_id: orgId, active_member: true };
  async function snapshot(id, number) {
    const rows = await query(`select o.id as order_id,o.org_id,o.status,o.updated_at as order_updated_at,w.id as waybill_id,w.waybill_no,w.latest_status,w.latest_event_at,c.id as connection_id,c.org_id as connection_org_id,c.environment,c.connection_status,c.tracking_capability,c.cancel_capability,c.updated_at as connection_updated_at,b.org_id as account_org_id,b.status as account_status,s.org_id as sender_org_id,(o.connection_environment='production' and b.connection_id=c.id and o.shipping_config_snapshot->>'carrier'='sf' and o.shipping_config_snapshot->>'environment'='production' and o.shipping_config_snapshot->>'connectionId'=c.id::text and o.shipping_config_snapshot->>'billingAccountId'=b.id::text and o.shipping_config_snapshot->>'billingAccountTail'=b.account_tail and o.shipping_config_snapshot->>'senderProfileId'=s.id::text and coalesce(o.shipping_config_snapshot->>'serviceId','') ~ '^[1-9][0-9]*$' and length(coalesce(o.shipping_config_snapshot->>'serviceName',''))>0) as snapshot_matches from public.shipping_orders o join public.shipping_waybills w on w.shipping_order_id=o.id join public.shipping_carrier_connections c on c.id=o.carrier_connection_id join public.shipping_billing_accounts b on b.id=o.billing_account_id join public.shipping_sender_profiles s on s.id=o.sender_profile_id where o.id='${id}' and o.org_id='${orgId}' and w.waybill_no='${number}' and w.carrier_key='sf' and o.provider_key='sf'`);
    assert(rows.length === 1, 'Production order snapshot not found');
    const row = rows[0];
    assert(row.order_id === id && row.waybill_no === number && UUID.test(row.waybill_id || '') && UUID.test(row.connection_id || '') && [row.org_id, row.connection_org_id, row.account_org_id, row.sender_org_id].every(value => value === orgId), 'Order configuration organization mismatch');
    assert(row.environment === 'production' && row.connection_status === 'connected' && row.account_status === 'active' && row.snapshot_matches === true, 'Production order configuration snapshot mismatch');
    assert(time(row.connection_updated_at) <= now+60_000, 'Connection timestamp is in the future');
    return Object.fromEntries(['order_id','org_id','status','order_updated_at','waybill_id','waybill_no','latest_status','latest_event_at','connection_id','connection_org_id','environment','connection_status','tracking_capability','cancel_capability','connection_updated_at','account_org_id','account_status','sender_org_id','snapshot_matches'].map(key => [key, row[key]]));
  }
  const tracked = await snapshot(orderId, waybill);
  assert(tracked.tracking_capability === 'verified' && time(tracked.connection_updated_at) >= time(ui.tracking.started_at)-60_000, 'Tracking capability or recent connection update missing');
  const rows = await query(`select count(*)::int as event_count,max(e.event_at) as latest_event_at,max(e.created_at) as latest_persisted_at from public.shipping_tracking_events e join public.shipping_waybills w on w.id=e.waybill_id join public.shipping_orders o on o.id=w.shipping_order_id where o.id='${orderId}' and o.org_id='${orgId}' and o.connection_environment='production' and w.id='${tracked.waybill_id}' and w.waybill_no='${waybill}' and e.provider_key='sf' and e.event_at is not null and isfinite(e.event_at) and e.event_at<=now() and e.created_at<=now()`);
  assert(rows.length === 1 && Number.isInteger(rows[0].event_count) && rows[0].event_count >= ui.tracking.event_count, 'Matching persisted Production tracking events missing');
  const events = rows[0];
  assert(events.event_count > 0 && time(events.latest_event_at) <= now+60_000 && time(events.latest_persisted_at) <= now+60_000, 'Invalid persisted tracking timestamps');
  let cancelled;
  if (!uiOnly) {
    cancelled = await snapshot(ui.cancellation.order_id, ui.cancellation.waybill);
    assert(cancelled.status === 'cancelled' && cancelled.latest_status === 'cancelled' && cancelled.cancel_capability === 'verified', 'Persisted successful cancellation missing');
    assert(time(cancelled.order_updated_at) >= time(ui.cancellation.started_at)-60_000 && time(cancelled.order_updated_at) <= time(ui.cancellation.observed_at)+60_000 && time(cancelled.connection_updated_at) >= time(ui.cancellation.started_at)-60_000, 'Cancellation time does not match the observed operation');
  }
  evidence.service_role = { source: 'management_database_read', org_id: orgId, tracked_order: tracked, ...(cancelled ? { cancelled_order: cancelled } : {}) };
  evidence.tracking_events = { org_id: orgId, order_id: orderId, waybill, event_count: events.event_count, latest_event_at: events.latest_event_at, latest_persisted_at: events.latest_persisted_at };

  // Only validated, non-secret evidence is written. Original operator bytes are
  // preserved; the output envelope binds copies under the controlled prefix.
  const out = path.join(runtime, 'production-runtime-verifier', commit);
  fs.mkdirSync(path.join(out, 'operator'), { recursive: true, mode: 0o700 });
  const attachments = [];
  function save(name, bytes) {
    const filename = path.join(out, name+'.json');
    fs.writeFileSync(filename, bytes, { mode: 0o600 });
    const item = { path: path.relative(runtime, filename), sha256: hash(bytes) };
    attachments.push(item);
    return item;
  }
  for (const [name, value] of Object.entries(evidence)) save(name, Buffer.from(JSON.stringify(value)));
  const operatorCopy = save('operator/attestation', proof.bytes);
  proof.attachments.forEach((bytes, index) => save('operator/observation-'+index, bytes));
  const common = { commit, deployment_id: deploymentId, environment: 'production', origin: ORIGIN, org_id: orgId };
  function envelope(name, value) {
    const payload = { ...common, ...value, attachments: [...attachments] };
    const bytes = Buffer.from(JSON.stringify(payload)), filename = path.join(out, name+'.json');
    fs.writeFileSync(filename, bytes, { mode: 0o600 });
    return { artifact_path: path.relative(runtime, filename), sha256: hash(bytes), payload };
  }
  const attested = { operator_observations_are_attested: true, operator_attestation: operatorCopy, trust_boundary: 'operator_attestation_not_machine_proof' };
  return {
    security_gate: envelope('security-gate', { source: 'live_production_database_verifier', gate_id: 'SECURITY-P0-RLS-PRODUCTION', status: 'passed', production_project_ref: PROJECT, scope: 'existing_protected_tables_and_shipping_configuration', checks: Object.fromEntries(['catalog','rls','acl','rpc','advisor','anon','service_role'].map(key => [key, 'pass'])) }),
    verifier: envelope('verifier', { source: 'live_production_runtime_verifier', ...attested }),
    shipping_workspace: envelope('workspace', uiOnly
      ? { source: 'production_database', contract_version: contractVersion, ...Object.fromEntries(SHIPPING_UI_FLAGS.map(key => [key, ui[key]])), ...attested }
      : { source: 'production_database', contract_version: 'f054-v2', ...Object.fromEntries(UI_FLAGS.filter(key => !['public_intake_allowed','guest_ledger_denied','owner_can_read','relationship_assignment_controlled','rate_limit_enforced'].includes(key)).map(key => [key, ui[key]])), ledger_filters: ui.ledger_filters, configuration_in_database: true, order_configuration_snapshot_verified: true, cancel_before_collection_verified: true, cancellation_service_code: ui.cancellation.service_code, cancelled_order_id: cancelled.order_id, ...attested }),
    shipping_tracking: envelope('tracking', { source: 'production_database', success: true, order_id: orderId, waybill, event_count: events.event_count, sf_environment: 'production', app_endpoint: ui.tracking.app_endpoint, mock: false, tracking_capability: tracked.tracking_capability, connection_updated_at: tracked.connection_updated_at, latest_event_at: events.latest_event_at, latest_persisted_at: events.latest_persisted_at, query_observed_at: ui.tracking.observed_at, ...attested }),
    shipping_access: envelope('access', { source: 'production_database', ...Object.fromEntries(['public_intake_allowed','guest_ledger_denied','owner_can_read','relationship_assignment_controlled','rate_limit_enforced'].map(key => [key, ui[key]])), organization_matched: true, ...attested }),
  };
}
module.exports = { verify };
