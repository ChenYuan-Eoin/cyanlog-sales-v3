// WP95 parser-only release evidence. No database credentials or carrier calls.
// Browser observations remain trusted operator attestations, never machine proof.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CONTRACT = 'f054-parser-v1';
const ORIGIN = 'https://sales.cyanlog.icu';
const ITEMS = Object.freeze(['shipping_parser']);
const ACTIONS = Object.freeze(['open_shipping_parser', 'paste_original_samples', 'parse_original_samples', 'verify_separated_fields', 'verify_village_without_number', 'verify_missing_phone_rejected', 'restore_original_preview']);
const FLAGS = Object.freeze(['company_name_separated', 'recipient_name_separated', 'phone_separated', 'address_separated', 'administrative_area_correct', 'original_text_preserved', 'village_without_door_number_accepted', 'missing_phone_rejected', 'submit_enabled_for_two_valid_rows']);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const isHash = value => /^[a-f0-9]{64}$/.test(value || '');
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const RULE_PATHS = new Set(['AGENTS.md', 'governance/runtime-state/active-task.json', 'governance/runtime-state/demand-inbox.jsonl', ...['project-registry.js', 'shipping-parser-verifier.js', 'shipping-parser-verifier.test.js', 'harness-selftest.js'].map(name => `governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/${name}`)]);

function productionFirstExceptionBlockers({ approval, activeId, contractVersion, productTree, changedPaths, candidateIsAncestor } = {}) {
  const errors = [];
  if (activeId !== 'WP95' || contractVersion !== CONTRACT) errors.push('Parser release ordering is limited to WP95');
  if (approval?.type !== 'final_production_release_authorization' || approval.source !== 'user_explicit' || approval.state !== 'approved' || approval.preview_order_exception !== true || approval.preview_status !== 'not_passed') errors.push('Explicit parser release authority must preserve Preview as not passed');
  if (approval?.code_release_authorized !== true || approval.production_database_write_authorized !== false || approval.carrier_calls_authorized !== false) errors.push('Parser release permits no business writes or carrier calls');
  if (!/^[a-f0-9]{40}$/.test(approval?.approved_candidate || '') || candidateIsAncestor !== true || !/^[a-f0-9]{40}$/.test(approval?.approved_product_tree || '') || productTree !== approval.approved_product_tree) errors.push('Parser release must retain the approved product tree and ancestry');
  if (!Array.isArray(changedPaths) || changedPaths.some(file => !RULE_PATHS.has(file))) errors.push('Only scoped parser delivery rules may follow the approved candidate');
  if (!/^[a-f0-9]{40}$/.test(approval?.rollback_commit || '')) errors.push('Concrete rollback commit required');
  return errors;
}
function common(payload, expected) {
  const errors = [];
  if (payload?.contract_version !== CONTRACT || payload.environment !== 'production' || payload.commit !== expected.commit || payload.deployment_id !== expected.deploymentId) errors.push('Parser proof is not bound to the production candidate');
  if (!Array.isArray(payload?.attachments) || !payload.attachments.length || payload.attachments.some(item => !nonempty(item.path) || !isHash(item.sha256))) errors.push('Raw parser observation attachments required');
  return errors;
}
function productionOperatorBlockers(payload, expected) {
  const errors = common(payload, expected);
  let url;
  try { url = new URL(payload?.url); } catch { /* rejected below */ }
  if (url?.origin !== ORIGIN || url.pathname !== '/shipping') errors.push('Parser replay must use the actual production shipping page');
  if (payload?.browser_context !== 'existing_user_chrome' || payload.new_tabs !== 0 || payload.new_browser_contexts !== 0 || !nonempty(payload.existing_tab_id)) errors.push('Existing user Chrome required');
  if (payload?.attestation_type !== 'trusted_operator_browser' || payload.trust_boundary !== 'operator_attestation_not_machine_proof' || payload.attestation_method !== 'codex_chrome_control_existing_session' || !nonempty(payload.attested_by)) errors.push('Explicit operator observation trust boundary required');
  const now = expected.now ?? Date.now(), observed = Date.parse(payload?.attested_at || '');
  if (!Number.isFinite(now) || !Number.isFinite(observed) || observed > now + 60000 || now - observed > 3600000) errors.push('Fresh parser observation required');
  if (JSON.stringify(payload?.actions) !== JSON.stringify(ACTIONS)) errors.push('Complete ordered parser replay required');
  for (const field of FLAGS) if (payload?.[field] !== true) errors.push(`Parser assertion missing: ${field}`);
  if (JSON.stringify(payload?.sample_ids) !== JSON.stringify(['beijing-office', 'wuxi-village']) || payload?.valid_rows !== 2 || payload?.invalid_rows !== 0) errors.push('Both exact original samples must be valid');
  if (payload?.workorders_created !== 0 || payload.existing_orders_changed !== false || payload.carrier_calls !== 0 || payload.database_migrations !== 0) errors.push('Parser replay must not mutate business data or call the carrier');
  if (payload?.actual_submission_verified !== false) errors.push('Parser preview cannot claim actual workorder submission');
  if (payload?.result !== 'pass') errors.push('Parser replay did not pass');
  return errors;
}
function productionBlockers(section, expected) {
  const verifier = section?.verifier?.payload || {}, observation = section?.shipping_parser?.payload || {};
  const errors = common(verifier, expected);
  errors.push(...productionOperatorBlockers(observation, { ...expected, now: Date.parse(verifier.observed_at || '') }));
  if (verifier.source !== 'live_shipping_parser_verifier' || verifier.origin !== ORIGIN || verifier.read_only !== true || !Number.isFinite(Date.parse(verifier.observed_at || '')) || Date.parse(verifier.observed_at) > Date.now() + 60000) errors.push('Controlled production parser verifier required');
  if (observation.source !== 'trusted_existing_chrome_operator' || !isHash(verifier.source_operator_sha256) || verifier.source_operator_sha256 !== observation.source_operator_sha256) errors.push('Parser operator evidence must be bound to verifier receipt');
  const probe = verifier.probe;
  if (probe?.method !== 'GET' || probe.path !== '/api/shipping/ledger' || probe.credentials !== 'omit' || probe.status !== 401 || !['Unauthorized', '请先登录。'].includes(probe.error) || !/^application\/json(?:\s*;|$)/i.test(probe.content_type || '')) errors.push('Anonymous ledger access must be rejected by the application');
  if (!verifier.attachments?.some(item => item.path === probe?.response_artifact?.path && item.sha256 === probe?.response_artifact?.sha256)) errors.push('Anonymous denial response attachment required');
  return errors;
}
function readArtifact(runtime, file, expectedHash) {
  if (!nonempty(file) || !isHash(expectedHash)) throw Error('Invalid parser artifact');
  const real = fs.realpathSync(path.resolve(runtime, file));
  if (!real.startsWith(runtime + path.sep)) throw Error('Parser artifact escapes runtime');
  const stat = fs.statSync(real);
  if (!stat.isFile() || stat.size <= 0 || stat.size > 25 * 1024 * 1024) throw Error('Invalid parser artifact size');
  const bytes = fs.readFileSync(real);
  if (hash(bytes) !== expectedHash) throw Error('Parser artifact hash mismatch');
  return bytes;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  return value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
async function verify({ runtime, operator, commit, deploymentId, request = fetch }) {
  runtime = fs.realpathSync(runtime);
  const expected = { commit, deploymentId };
  const blockers = productionOperatorBlockers(operator?.payload, expected);
  if (blockers.length) throw Error(blockers.join('; '));
  const original = readArtifact(runtime, operator.artifact_path, operator.sha256);
  if (JSON.stringify(canonical(JSON.parse(original))) !== JSON.stringify(canonical(operator.payload))) throw Error('Parser operator envelope mismatch');
  const prefix = `production-runtime-verifier/parser-${Date.now()}-${process.pid}`;
  fs.mkdirSync(path.join(runtime, prefix), { recursive: true });
  const write = (name, bytes) => {
    const file = `${prefix}/${name}`;
    fs.writeFileSync(path.join(runtime, file), bytes);
    return { path: file, sha256: hash(bytes) };
  };
  const envelope = (name, payload) => {
    const file = write(`${name}.json`, JSON.stringify(payload, null, 2) + '\n');
    return { artifact_path: file.path, sha256: file.sha256, payload };
  };
  const attachments = operator.payload.attachments.map((item, index) => write(`operator-${index}${path.extname(item.path).replace(/[^.a-zA-Z0-9]/g, '') || '.bin'}`, readArtifact(runtime, item.path, item.sha256)));
  attachments.push(write('operator-original.json', original));
  const response = await request(ORIGIN + '/api/shipping/ledger', { method: 'GET', credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { accept: 'application/json' } });
  const raw = await response.text();
  if (raw.length > 128 * 1024) throw Error('Anonymous response exceeds evidence limit');
  let body;
  try { body = JSON.parse(raw); } catch { throw Error('Anonymous ledger response is not JSON'); }
  const probe = { method: 'GET', path: '/api/shipping/ledger', credentials: 'omit', status: response.status, content_type: response.headers.get('content-type'), error: typeof body?.error === 'string' ? body.error : '' };
  probe.response_artifact = write('anonymous-ledger.json', JSON.stringify(probe, null, 2) + '\n');
  const commonFields = { contract_version: CONTRACT, environment: 'production', origin: ORIGIN, commit, deployment_id: deploymentId };
  const result = {
    shipping_parser: envelope('parser', { ...operator.payload, ...commonFields, source: 'trusted_existing_chrome_operator', source_operator_sha256: operator.sha256, attachments }),
    verifier: envelope('verifier', { ...commonFields, source: 'live_shipping_parser_verifier', read_only: true, source_operator_sha256: operator.sha256, observed_at: new Date().toISOString(), probe, attachments: [probe.response_artifact, ...attachments] }),
  };
  const errors = productionBlockers(result, expected);
  if (errors.length) throw Error(errors.join('; '));
  return result;
}
module.exports = { CONTRACT, ITEMS, ORIGIN, ACTIONS, FLAGS, productionFirstExceptionBlockers, productionOperatorBlockers, productionBlockers, verify };
