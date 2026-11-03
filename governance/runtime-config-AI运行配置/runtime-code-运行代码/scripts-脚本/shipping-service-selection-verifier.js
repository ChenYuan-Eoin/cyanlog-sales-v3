// UI observations are trusted existing-Chrome attestations, never machine proof
// of a business request. This collector makes two anonymous GETs and no business writes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CONTRACT = 'f054-service-selection-v1';
const ITEMS = Object.freeze(['shipping_service_selection', 'shipping_access']);
const ACTIONS = Object.freeze(['open_shipping_workspace', 'select_two_existing_pending_orders', 'change_service_for_order_a', 'verify_order_b_unchanged', 'choose_batch_service_without_apply', 'verify_pending_batch_choice_no_change', 'apply_batch_service_to_selected_orders', 'restore_original_services_explicitly', 'review_per_order_service_summary', 'leave_confirmation_unsubmitted']);
const ORIGIN = 'https://sales.cyanlog.icu';
const PREFIX = 'production-runtime-verifier';
const ROUTES = ['/api/shipping/ledger?limit=1', '/api/shipping/settings'];
const LOCAL_ASSERTIONS = ['per_order_payload', 'original_product_fallback', 'batch_requires_explicit_apply', 'batch_applies_selected_only', 'empty_restores_original', 'invalid_blocks_before_request', 'unknown_does_not_reconfirm', 'server_readback_authoritative'];
const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
// Existing production seeds use Postgres UUIDs without RFC version/variant bits.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function check(ok, message) { if (!ok) throw Error(message); }
function keys(value, allowed, label) {
  check(value && typeof value === 'object' && !Array.isArray(value), 'Invalid ' + label);
  check(Object.keys(value).every(key => allowed.includes(key)), 'Unapproved field in ' + label);
}
function stamp(value) {
  const match = typeof value === 'string' && value.match(/^(\d{4}-\d\d-\d\d)T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/);
  check(match && Number.isFinite(Date.parse(value)) && new Date(match[1] + 'T00:00:00Z').toISOString().slice(0, 10) === match[1], 'Valid ISO observation time required');
  return Date.parse(value);
}
function fresh(value, now = Date.now()) {
  const time = stamp(value);
  check(time <= now + 60000 && now - time <= 3600000, 'Fresh observation required');
  return time;
}

function binding(value, expected) {
  check(value.contract_version === CONTRACT && value.environment === 'production' && value.origin === ORIGIN, 'Exact Production contract and origin required');
  check(typeof expected.commit === 'string' && COMMIT.test(expected.commit) && typeof expected.deploymentId === 'string' && /^dpl_[A-Za-z0-9]+$/.test(expected.deploymentId), 'Exact commit and deployment required');
  check(value.commit === expected.commit && value.deployment_id === expected.deploymentId, 'Candidate binding mismatch');
}
function relative(file, prefix) {
  check(typeof file === 'string' && file.length > 0 && !path.isAbsolute(file) && !file.includes('\\') && !file.split('/').some(part => part === '..' || !part), 'Invalid scoped artifact path');
  if (prefix) check(file.startsWith(prefix + '/'), 'Artifact prefix mismatch');
}
function artifact(runtime, reference, text = false) {
  keys(reference, ['path', 'sha256'], 'artifact reference');
  relative(reference.path); check(HASH.test(reference.sha256 || ''), 'Artifact SHA256 required');
  const base = fs.realpathSync(runtime), real = fs.realpathSync(path.resolve(base, reference.path));
  check(real.startsWith(base + path.sep) && (text ? ['.log', '.txt'].includes(path.extname(real)) : path.extname(real) === '.json'), 'Artifact escapes runtime or is not JSON');
  const stat = fs.statSync(real);
  check(stat.isFile() && stat.size > 0 && stat.size <= (text ? 2 * 1024 * 1024 : 128 * 1024), 'Invalid JSON artifact size');
  const bytes = fs.readFileSync(real);
  check(sha(bytes) === reference.sha256, 'Artifact hash mismatch');
  if (text) return { bytes };
  let value; try { value = JSON.parse(bytes.toString('utf8')); } catch { throw Error('Invalid JSON artifact'); }
  check(value && typeof value === 'object' && !Array.isArray(value), 'JSON object artifact required');
  return { bytes, value };
}
function envelope(value, expected, runtime) {
  keys(value, ['artifact_path', 'sha256', 'payload'], 'evidence envelope');
  relative(value.artifact_path, PREFIX); check(HASH.test(value.sha256 || ''), 'Envelope SHA256 required');
  check(sha(json(value.payload)) === value.sha256, 'Controlled envelope payload hash mismatch');
  if (runtime) check(same(artifact(runtime, { path: value.artifact_path, sha256: value.sha256 }).value, value.payload), 'Envelope file mismatch');
  binding(value.payload, expected);
  return value.payload;
}
function localPayload(value, commit) {
  keys(value, ['contract_version', 'source', 'commit', 'result', 'production_requests_exercised', 'test_file', 'test_file_sha256', 'test_log', 'exit_code', 'timeout', 'assertions'], 'local payload regression');
  check(value.contract_version === CONTRACT && value.source === 'local_target_payload_regression' && value.commit === commit && value.result === 'pass', 'Same-commit local payload regression required');
  check(value.exit_code === 0 && value.timeout === false, 'Successful non-timeout target test log required');
  keys(value.test_log, ['path', 'sha256'], 'target test log'); relative(value.test_log.path); check(HASH.test(value.test_log.sha256 || ''), 'Target test log hash required');
  check(value.production_requests_exercised === false, 'Local regression cannot claim Production confirmation requests');
  check(value.test_file === 'product-truth/product-code/app/shipping/workbench-service-selection.test.tsx' && HASH.test(value.test_file_sha256 || ''), 'Bound service-selection test required');
  check(same(value.assertions, LOCAL_ASSERTIONS), 'Complete ordered local payload assertions required');
}
function operatorPayload(value, expected, now = Date.now()) {
  keys(value, ['contract_version', 'source', 'environment', 'origin', 'url', 'commit', 'deployment_id', 'browser_context', 'existing_tab_id', 'new_tabs', 'new_browser_contexts', 'attestation_type', 'trust_boundary', 'attestation_method', 'attested_by', 'attested_at', 'viewport', 'org_id', 'operator_id', 'actions', 'orders', 'original_service_basis', 'observations', 'confirmation_clicked', 'business_write_requests_observed', 'result', 'attachments', 'payload_regression'], 'operator attestation');
  binding(value, expected);
  check(value.source === 'trusted_existing_chrome_operator' && value.url === ORIGIN + '/shipping', 'Actual shipping operator replay required');
  check(value.browser_context === 'existing_user_chrome' && typeof value.existing_tab_id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value.existing_tab_id) && value.new_tabs === 0 && value.new_browser_contexts === 0, 'Existing Chrome only; no new tabs or contexts');
  check(value.attestation_type === 'trusted_operator_browser' && value.trust_boundary === 'operator_attestation_not_machine_proof' && value.attestation_method === 'codex_chrome_control_existing_session' && typeof value.attested_by === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(value.attested_by), 'Explicit trusted operator boundary required');
  check(UUID.test(value.org_id || '') && UUID.test(value.operator_id || ''), 'Operator organization and user UUID attestation required');
  const attested = fresh(value.attested_at, now);
  keys(value.viewport, ['width', 'height'], 'viewport');
  check(Number.isInteger(value.viewport.width) && value.viewport.width >= 320 && value.viewport.width <= 7680 && Number.isInteger(value.viewport.height) && value.viewport.height >= 240 && value.viewport.height <= 4320, 'Actual viewport required');
  check(value.result === 'pass' && value.confirmation_clicked === false && same(value.business_write_requests_observed, []), 'Confirmation and business writes must remain unsubmitted');
  check(same(value.actions, ACTIONS), 'Exact ordered service-selection actions required');
  check(value.original_service_basis === 'initial_ui_resolution', 'Original service means initial UI resolution, not a raw database field');
  check(Array.isArray(value.orders) && value.orders.length === 2, 'Two existing production orders required');
  for (const order of value.orders) {
    keys(order, ['order_id', 'revision', 'original_service_id', 'original_input_service_id', 'source', 'demo', 'status'], 'order');
    check(UUID.test(order.order_id || '') && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(order.order_id) && Number.isSafeInteger(order.revision) && order.revision >= 1 && Number.isSafeInteger(order.original_service_id) && order.original_service_id > 0, 'Real order UUID, revision and resolved original product required');
    check(order.source === 'existing_production_ledger' && order.demo === false && order.status === 'awaiting_confirmation', 'Demo or invented order evidence rejected');
    check(order.original_input_service_id === undefined || order.original_input_service_id === null || Number.isSafeInteger(order.original_input_service_id) && order.original_input_service_id > 0, 'Invalid optional raw input service');
  }
  const ids = value.orders.map(order => order.order_id);
  check(ids[0] !== ids[1], 'Two distinct orders required');
  const initial = Object.fromEntries(value.orders.map(order => [order.order_id, order.original_service_id]));
  check(Array.isArray(value.observations) && value.observations.length === ACTIONS.length, 'Every action requires an observation');
  let previous = attested - 3600000;
  const states = value.observations.map((observation, index) => {
    keys(observation, ['action', 'observed_at', 'services', 'selected_order_ids', 'batch_service_id'], 'step observation');
    check(observation.action === ACTIONS[index], 'Observation action order mismatch');
    const observed = fresh(observation.observed_at, now);
    check(observed >= previous && observed <= attested, 'Observation chronology mismatch'); previous = observed;
    check(Array.isArray(observation.services) && observation.services.length === 2 && new Set(observation.services.map(item => item.order_id)).size === 2, 'Both order states required');
    for (const item of observation.services) { keys(item, ['order_id', 'service_id'], 'observed service'); check(ids.includes(item.order_id) && Number.isSafeInteger(item.service_id) && item.service_id > 0, 'Invalid observed product'); }
    check(Array.isArray(observation.selected_order_ids) && new Set(observation.selected_order_ids).size === observation.selected_order_ids.length && observation.selected_order_ids.every(id => ids.includes(id)), 'Invalid selected order set');
    check(observation.batch_service_id === null || Number.isSafeInteger(observation.batch_service_id) && observation.batch_service_id > 0, 'Invalid pending batch product');
    return Object.fromEntries(observation.services.map(item => [item.order_id, item.service_id]));
  });
  check(same(states[0], initial) && same(states[1], initial) && value.observations[1].selected_order_ids.length === 2, 'Initial product and two-order selection evidence mismatch');
  check(states[2][ids[0]] !== initial[ids[0]] && states[2][ids[1]] === initial[ids[1]] && same(states[3], states[2]), 'Changing A must leave B unchanged');
  check(same(states[4], states[3]) && same(states[5], states[3]), 'Pending batch choice must not change either ticket');
  const selected = value.observations[4].selected_order_ids, batch = value.observations[4].batch_service_id;
  check(selected.length > 0 && batch !== null && same(value.observations[5].selected_order_ids, selected) && value.observations[5].batch_service_id === batch && same(value.observations[6].selected_order_ids, selected) && value.observations[6].batch_service_id === batch, 'Explicit batch application target mismatch');
  check(selected.some(id => states[5][id] !== batch) && ids.every(id => states[6][id] === (selected.includes(id) ? batch : states[5][id])), 'Batch application must change selected tickets only');
  check(ids.some(id => states[6][id] !== initial[id]) && value.observations[7].selected_order_ids.length === 2 && value.observations[7].batch_service_id === null && same(states[7], initial) && same(states[8], initial) && same(states[9], initial), 'Explicit restore and final per-order summary must retain each original');
}
function probePayload(probe, index, now = Date.now()) {
  keys(probe, ['method', 'path', 'credentials', 'status', 'content_type', 'error', 'observed_at', 'response_body_sha256', 'response_artifact'], 'anonymous probe');
  check(probe.method === 'GET' && probe.path === ROUTES[index] && probe.credentials === 'omit' && probe.status === 401 && /^application\/json(?:\s*;|$)/i.test(probe.content_type || '') && ['Unauthorized', '请先登录。'].includes(probe.error), 'Application JSON 401 required; HTML and login redirects rejected');
  check(HASH.test(probe.response_body_sha256 || ''), 'Real response hash required'); fresh(probe.observed_at, now);
  keys(probe.response_artifact, ['path', 'sha256'], 'probe artifact'); relative(probe.response_artifact.path, PREFIX); check(HASH.test(probe.response_artifact.sha256 || ''), 'Probe artifact hash required');
}
function productionEvidenceBlockers(section, expected = {}) {
  try {
    keys(section, [...ITEMS, 'verifier'], 'Production section');
    check(expected.runtimeContractVersion === undefined || expected.runtimeContractVersion === CONTRACT, 'Runtime contract mismatch');
    const verifier = envelope(section.verifier, expected, expected.runtime), selection = envelope(section.shipping_service_selection, expected, expected.runtime), access = envelope(section.shipping_access, expected, expected.runtime);
    const { source_operator_sha256: operatorHash, operator_attestation: operator, ...selectionFields } = selection;
    check(HASH.test(operatorHash || '') && verifier.source_operator_sha256 === operatorHash && access.source_operator_sha256 === operatorHash, 'Source operator hash binding mismatch');
    keys(selectionFields, ['contract_version', 'environment', 'origin', 'commit', 'deployment_id', 'source', 'read_only', 'result', 'attachments', 'payload_regression', 'payload_regression_test_log'], 'selection receipt');
    const verifiedAt = stamp(verifier.observed_at);
    check(verifiedAt <= Date.now() + 60000, 'Invalid or future verifier time');
    check(selection.source === 'trusted_existing_chrome_operator' && selection.read_only === true && selection.result === 'pass', 'Operator service-selection receipt required'); operatorPayload(operator, expected, verifiedAt);
    check(selection.payload_regression?.sha256 === operator.payload_regression?.sha256, 'Local regression dependency mismatch');
    keys(selection.payload_regression_test_log, ['path', 'sha256'], 'copied target log'); relative(selection.payload_regression_test_log.path, PREFIX); check(HASH.test(selection.payload_regression_test_log.sha256 || ''), 'Copied target log hash required');
    keys(access, ['contract_version', 'environment', 'origin', 'commit', 'deployment_id', 'source', 'read_only', 'anonymous_access_denied', 'result', 'source_operator_sha256', 'probes', 'attachments'], 'access receipt');
    keys(verifier, ['contract_version', 'environment', 'origin', 'commit', 'deployment_id', 'source', 'read_only', 'result', 'source_operator_sha256', 'observed_at', 'source_operator_artifact', 'probes', 'attachments'], 'verifier receipt');
    check(verifier.source === 'live_shipping_service_selection_verifier' && verifier.read_only === true && verifier.result === 'pass' && access.source === verifier.source && access.anonymous_access_denied === true && access.read_only === true && access.result === 'pass', 'Controlled read-only verifier required');
    check(Array.isArray(verifier.probes) && verifier.probes.length === 2 && same(access.probes, verifier.probes), 'Both fixed anonymous probes required');
    verifier.probes.forEach((probe, index) => probePayload(probe, index, verifiedAt));
    check(verifier.source_operator_artifact?.sha256 === operatorHash, 'Original operator artifact binding missing');
    for (const payload of [selection, access, verifier]) {
      check(Array.isArray(payload.attachments) && payload.attachments.length > 0, 'Hashed dependencies required');
      for (const reference of payload.attachments) { keys(reference, ['path', 'sha256'], 'receipt dependency'); relative(reference.path, PREFIX); check(HASH.test(reference.sha256 || ''), 'Dependency hash required'); if (expected.runtime) artifact(expected.runtime, reference, same(reference, selection.payload_regression_test_log)); }
    }
    check(verifier.probes.every(probe => verifier.attachments.some(item => same(item, probe.response_artifact))) && verifier.attachments.some(item => same(item, verifier.source_operator_artifact)), 'Verifier dependency coverage missing');
    if (expected.runtime) {
      const source = artifact(expected.runtime, verifier.source_operator_artifact); check(same(source.value, operator), 'Original operator payload changed');
      const regression = artifact(expected.runtime, selection.payload_regression).value; localPayload(regression, expected.commit);
      check(regression.test_log.sha256 === selection.payload_regression_test_log.sha256, 'Copied target log binding mismatch');
      artifact(expected.runtime, selection.payload_regression_test_log, true);
      check(selection.attachments.length === operator.attachments.length + 2 && operator.attachments.every(item => selection.attachments.some(copy => copy.sha256 === item.sha256)) && selection.attachments.some(item => same(item, selection.payload_regression)) && selection.attachments.some(item => same(item, selection.payload_regression_test_log)) && verifier.attachments.some(item => same(item, selection.payload_regression_test_log)), 'Copied operator dependency coverage incomplete');
      for (const probe of verifier.probes) { const { response_artifact, ...metadata } = probe; check(same(artifact(expected.runtime, response_artifact).value, metadata), 'Anonymous response artifact content mismatch'); }
    }
    return [];
  } catch (error) { return [error.message]; }
}
function runtimeEvidenceBlockers(section, environment, expected = {}) {
  if (environment === 'production') {
    const value = section?.verifier?.payload || {};
    return productionEvidenceBlockers(section, { ...expected, commit: expected.commit || value.commit, deploymentId: expected.deploymentId || value.deployment_id });
  }
  try {
    keys(section, [...ITEMS, 'verifier'], 'candidate section');
    for (const item of ITEMS) {
      const value = section[item]?.payload;
      check(value?.contract_version === CONTRACT && [environment, ...(environment === 'sandbox' ? ['preview'] : [])].includes(value.environment) && COMMIT.test(value.commit || ''), 'Candidate contract, environment and SHA required');
      check(!expected.commit || value.commit === expected.commit, 'Candidate SHA mismatch');
      check(value.read_only === true && value.result === 'pass' && value.production_requests_exercised === false, 'Candidate evidence cannot claim Production requests');
      check(item === 'shipping_access' ? value.anonymous_access_denied === true : value.per_order_isolation === true && value.payload_regression_passed === true, 'Candidate service-selection assertion missing');
    }
    return [];
  } catch (error) { return [error.message]; }
}
async function limitedText(response) {
  const reader = response.body?.getReader(); check(reader, 'Anonymous JSON body required');
  const chunks = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; check(size <= 16384, 'Anonymous response too large'); chunks.push(Buffer.from(value)); } }
  finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}
async function verify(options) {
  keys(options, ['runtime', 'operator', 'commit', 'deploymentId'], 'collector options');
  const { runtime, operator, commit, deploymentId } = options, expected = { commit, deploymentId };
  keys(operator, ['artifact_path', 'sha256', 'payload'], 'operator envelope');
  const original = artifact(runtime, { path: operator.artifact_path, sha256: operator.sha256 });
  check(same(original.value, operator.payload), 'Operator envelope payload mismatch'); operatorPayload(original.value, expected);
  const input = original.value;
  check(Array.isArray(input.attachments) && input.attachments.length === ACTIONS.length, 'One redacted JSON attachment per action required');
  const observations = input.attachments.map((reference, index) => {
    const entry = artifact(runtime, reference), value = entry.value;
    keys(value, ['source', 'contract_version', 'commit', 'deployment_id', 'origin', 'existing_tab_id', 'org_id', 'operator_id', 'action', 'result', 'redacted', 'observation'], 'redacted observation attachment');
    check(value.source === 'redacted_existing_chrome_observation' && value.contract_version === CONTRACT && value.commit === commit && value.deployment_id === deploymentId && value.origin === ORIGIN && value.existing_tab_id === input.existing_tab_id && value.org_id === input.org_id && value.operator_id === input.operator_id && value.action === ACTIONS[index] && value.result === 'pass' && value.redacted === true && same(value.observation, input.observations[index]), 'Observation attachment binding mismatch');
    return entry;
  });
  const local = artifact(runtime, input.payload_regression); localPayload(local.value, commit);
  const testLog = artifact(runtime, local.value.test_log, true);
  const probes = [];
  for (const route of ROUTES) {
    let response;
    try { response = await fetch(ORIGIN + route, { method: 'GET', credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) }); }
    catch { throw Error('Anonymous shipping probe unavailable'); }
    check(response.status === 401 && /^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || ''), 'Application JSON 401 required; HTML and redirects rejected');
    const bytes = await limitedText(response);
    let body; try { body = JSON.parse(bytes); } catch { throw Error('Invalid anonymous JSON response'); }
    keys(body, ['error', 'code', 'success'], 'anonymous denial'); check(['Unauthorized', '请先登录。'].includes(body.error) && (body.success === undefined || body.success === false), 'Application authentication denial required');
    probes.push({ method: 'GET', path: route, credentials: 'omit', status: 401, content_type: response.headers.get('content-type'), error: body.error, observed_at: new Date().toISOString(), response_body_sha256: sha(bytes) });
  }
  const base = fs.realpathSync(runtime), prefix = path.join(base, PREFIX);
  fs.mkdirSync(prefix, { recursive: true }); check(fs.realpathSync(prefix).startsWith(base + path.sep), 'Output prefix escapes runtime');
  const directory = fs.mkdtempSync(path.join(prefix, 'shipping-service-selection-' + commit.slice(0, 12) + '-'));
  const write = (name, bytes) => { const file = path.join(directory, name); fs.writeFileSync(file, bytes, { flag: 'wx' }); return { path: path.relative(base, file).split(path.sep).join('/'), sha256: sha(bytes) }; };
  const operatorReference = write('source-operator.json', original.bytes);
  const attachments = observations.map((entry, index) => write('observation-' + index + '.json', entry.bytes));
  const localReference = write('local-payload-regression.json', local.bytes);
  const testLogReference = write('target-tests.log', testLog.bytes);
  probes.forEach((probe, index) => { probe.response_artifact = write('anonymous-' + index + '.json', json(probe)); });
  const common = { contract_version: CONTRACT, environment: 'production', origin: ORIGIN, commit, deployment_id: deploymentId };
  const attestation = input;
  const make = (name, payload) => { const reference = write(name + '.json', json(payload)); return { artifact_path: reference.path, sha256: reference.sha256, payload }; };
  const source = 'live_shipping_service_selection_verifier';
  const result = {
    shipping_service_selection: make('selection', { ...common, source: 'trusted_existing_chrome_operator', read_only: true, result: 'pass', source_operator_sha256: operator.sha256, operator_attestation: attestation, attachments: [...attachments, localReference, testLogReference], payload_regression: localReference, payload_regression_test_log: testLogReference }),
    shipping_access: make('access', { ...common, source, read_only: true, anonymous_access_denied: true, result: 'pass', source_operator_sha256: operator.sha256, probes, attachments: probes.map(probe => probe.response_artifact) }),
    verifier: make('verifier', { ...common, source, read_only: true, result: 'pass', source_operator_sha256: operator.sha256, observed_at: new Date().toISOString(), source_operator_artifact: operatorReference, probes, attachments: [operatorReference, ...attachments, localReference, testLogReference, ...probes.map(probe => probe.response_artifact)] }),
  };
  // The copied source retains original input references; compare its immutable
  // content separately from the receipt's relocated, equally hashed dependencies.
  const blockers = productionEvidenceBlockers(result, expected);
  check(blockers.length === 0, blockers.join('; '));
  return result;
}
module.exports = { CONTRACT, ITEMS, ACTIONS, runtimeEvidenceBlockers, productionEvidenceBlockers, verify };
