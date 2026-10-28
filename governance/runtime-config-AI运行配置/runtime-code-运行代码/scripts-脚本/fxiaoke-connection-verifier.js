// WP91: evidence checks for the Fxiaoke connection journey. This module only
// validates evidence; it does not create credentials, save configuration or
// claim that an operator observation is machine-verified.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CONTRACT = 'f003-fxiaoke-connection-v1';
const ORIGIN = 'https://sales.cyanlog.icu';
const PREVIEW_ACTIONS = Object.freeze(['open_fxiaoke_configuration', 'inspect_required_fields', 'verify_internal_account_hidden']);
const PRODUCTION_ACTIONS = Object.freeze(['open_fxiaoke_configuration', 'save_application_configuration', 'reload_configuration', 'preview_directory']);
// The user journey writes only connection configuration and preview metadata.
// It never grants migration, organization-sync or shipping-permission authority.
function productionWriteBoundaryBlockers(value) {
  const errors = [];
  if (JSON.stringify(value?.production_write_scope) !== JSON.stringify(['organization_fxiaoke_connections'])) errors.push('Fxiaoke Production writes must be limited to the connection table');
  for (const flag of ['production_migrations_authorized', 'organization_sync_authorized', 'sales_permissions_authorized']) {
    if (value?.[flag] !== false) errors.push(`Fxiaoke connection acceptance must explicitly exclude ${flag}`);
  }
  return errors;
}
function productionReleaseScopeBlockers(contract) {
  const authorization = contract?.production_release_authorization;
  const approved = authorization?.status === 'approved_for_final_release';
  const errors = productionWriteBoundaryBlockers(authorization);
  if (!approved && authorization?.status !== 'pending_security_gate_and_final_write_approval') errors.push('Fxiaoke save acceptance requires controlled-write approval, not a code-only release');
  const mode = approved ? 'controlled_write_approved' : 'read_only_pending_security_gate_and_final_approval';
  if (contract?.production_database_mode !== mode || contract?.final_acceptance?.production_database_mode !== mode) errors.push('Fxiaoke database modes must match the explicit write-approval state');
  if (authorization?.database_write_authorized !== approved) errors.push('Fxiaoke database-write authorization must match the explicit approval state');
  return errors;
}
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const applicationDenial = (status, error) => status === 401 ? ['Unauthorized', '请先登录。'].includes(error) : status === 403 && ['Forbidden', '无权管理此企业的组织接入。'].includes(error);
const hash = value => /^[a-f0-9]{64}$/.test(value || '');
function hasArtifacts(value) {
  return Array.isArray(value) && value.length > 0 && value.every(item => nonempty(item?.path) && hash(item?.sha256));
}
function common(payload, expected, environment) {
  const issues = [];
  if (!payload || typeof payload !== 'object') return ['missing connection evidence'];
  if (payload.contract_version !== CONTRACT || payload.environment !== environment) issues.push('wrong Fxiaoke contract or environment');
  if (payload.commit !== expected.commit || payload.deployment_id !== expected.deploymentId) issues.push('evidence is not bound to the candidate deployment');
  if (!hasArtifacts(payload.attachments)) issues.push('raw evidence attachments are required');
  return issues;
}
function previewBlockers(payload, expected) {
  const errors = common(payload, expected, 'preview');
  if (JSON.stringify(payload?.actions) !== JSON.stringify(PREVIEW_ACTIONS)) errors.push('Fxiaoke preview journey is incomplete');
  if (payload?.internal_account_hidden !== true || payload?.required_fields_visible !== true || payload?.business_mutations !== false) errors.push('preview must demonstrate the correct fields without writing business data');
  return errors;
}
function productionOperatorBlockers(payload, expected) {
  const errors = common(payload, expected, 'production');
  let origin = '';
  try { origin = new URL(payload?.url || '').origin; } catch { /* invalid URL */ }
  if (origin !== ORIGIN) errors.push('operator must use the production origin');
  if (payload?.browser_context !== 'existing_user_chrome' || payload?.new_tabs !== 0 || payload?.new_browser_contexts !== 0 || !nonempty(payload?.existing_tab_id)) errors.push('operator must use an existing Chrome tab');
  if (payload?.attestation_type !== 'trusted_operator_browser' || payload?.trust_boundary !== 'operator_attestation_not_machine_proof' || payload?.attestation_method !== 'codex_chrome_control_existing_session' || !nonempty(payload?.attested_by)) errors.push('trusted operator attestation is required');
  const observed = Date.parse(payload?.attested_at || ''), now = expected.now ?? Date.now();
  if (!Number.isFinite(now) || !Number.isFinite(observed) || observed > now + 60_000 || now - observed > 60 * 60_000) errors.push('operator observation must be fresh');
  if (JSON.stringify(payload?.actions) !== JSON.stringify(PRODUCTION_ACTIONS)) errors.push('production configuration and directory journey is incomplete');
  if (payload?.save_status !== 200 || payload?.readback_verified !== true || payload?.preview_status !== 200 || payload?.provider_connected !== true) errors.push('saved configuration and actual directory preview are required');
  if (!Number.isSafeInteger(payload?.department_count) || payload.department_count < 1 || !Number.isSafeInteger(payload?.employee_count) || payload.employee_count < 1) errors.push('nonempty department and employee previews are required');
  if (payload?.sync_applied !== false || payload?.primary_source_changed !== false || payload?.sales_permissions_changed !== false) errors.push('WP91 must not change organization, primary source or shipping permissions');
  if (payload?.result !== 'pass') errors.push('production operator journey did not pass');
  return errors;
}
function productionBlockers(section, expected) {
  const verifier = section?.verifier?.payload || {};
  const observation = section?.connection_preview?.payload || {};
  const errors = common(verifier, expected, 'production');
  errors.push(...productionOperatorBlockers(observation, { ...expected, now: Date.parse(verifier.observed_at || '') }));
  if (verifier.origin !== ORIGIN || verifier.source !== 'live_fxiaoke_connection_verifier' || verifier.read_only !== true || !Number.isFinite(Date.parse(verifier.observed_at || '')) || Date.parse(verifier.observed_at) > Date.now() + 60_000) errors.push('missing controlled production verifier');
  if (observation.source !== 'trusted_existing_chrome_operator') errors.push('connection observation must be an operator attestation');
  if (!hash(verifier.source_operator_sha256) || verifier.source_operator_sha256 !== observation.source_operator_sha256) errors.push('operator observation must be bound to the verifier receipt');
  const probes = verifier.probes;
  if (!Array.isArray(probes) || probes.length !== 2) errors.push('anonymous access probes are missing');
  else for (const [index, method] of ['GET', 'POST'].entries()) {
    const probe = probes[index];
    if (probe?.method !== method || probe?.path !== '/api/admin/organization-sources/fxiaoke' || probe?.credentials !== 'omit' || !applicationDenial(probe?.status, probe?.error) || !/^application\/json(?:\s*;|$)/i.test(probe?.content_type || '')) errors.push(`anonymous ${method} was not denied by the application`);
    if (!verifier.attachments?.some(item => item.path === probe?.response_artifact?.path && item.sha256 === probe?.response_artifact?.sha256)) errors.push(`anonymous ${method} response is not bound to an attachment`);
  }
  return errors;
}
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function readArtifact(runtime, file, expectedHash) {
  if (!nonempty(file) || !hash(expectedHash)) throw Error('invalid Fxiaoke evidence attachment');
  const real = fs.realpathSync(path.resolve(runtime, file));
  if (!real.startsWith(runtime + path.sep)) throw Error('Fxiaoke evidence attachment escapes runtime');
  const stat = fs.statSync(real);
  if (!stat.isFile() || stat.size <= 0 || stat.size > 25 * 1024 * 1024) throw Error('invalid Fxiaoke evidence attachment size');
  const bytes = fs.readFileSync(real);
  if (digest(bytes) !== expectedHash) throw Error('Fxiaoke evidence attachment hash mismatch');
  return bytes;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
async function verify({ runtime, operator, commit, deploymentId, request = fetch }) {
  const expected = { commit, deploymentId };
  const errors = productionOperatorBlockers(operator?.payload, expected);
  if (errors.length) throw Error(errors.join('; '));
  runtime = fs.realpathSync(runtime);
  const original = readArtifact(runtime, operator.artifact_path, operator.sha256);
  if (JSON.stringify(canonical(JSON.parse(original.toString('utf8')))) !== JSON.stringify(canonical(operator.payload))) throw Error('operator payload does not match evidence');
  const parent = path.join(runtime, 'production-runtime-verifier');
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (!fs.realpathSync(parent).startsWith(runtime + path.sep)) throw Error('evidence output escapes runtime');
  const prefix = `production-runtime-verifier/fxiaoke-${crypto.randomUUID()}`;
  fs.mkdirSync(path.join(runtime, prefix), { mode: 0o700 });
  const write = (filename, bytes) => {
    const artifact_path = `${prefix}/${filename}`;
    fs.writeFileSync(path.join(runtime, artifact_path), bytes, { mode: 0o600, flag: 'wx' });
    return { path: artifact_path, sha256: digest(bytes) };
  };
  const envelope = (filename, payload) => {
    const item = write(`${filename}.json`, JSON.stringify(payload, null, 2) + '\n');
    return { artifact_path: item.path, sha256: item.sha256, payload };
  };
  const operatorArtifacts = operator.payload.attachments.map((item, index) => {
    const suffix = path.extname(item.path).replace(/[^.a-zA-Z0-9]/g, '') || '.bin';
    return write(`operator-${index}${suffix}`, readArtifact(runtime, item.path, item.sha256));
  });
  operatorArtifacts.push(write('operator-original.json', original));
  const probes = [], apiArtifacts = [];
  for (const method of ['GET', 'POST']) {
    const endpoint = '/api/admin/organization-sources/fxiaoke';
    const response = await request(ORIGIN + endpoint, { method, credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: '{}' } : {}) });
    const raw = await response.text();
    if (raw.length > 128 * 1024) throw Error('Fxiaoke anonymous response exceeds evidence limit');
    let body;
    try { body = JSON.parse(raw); } catch { throw Error(`Fxiaoke anonymous ${method} did not return JSON`); }
    const probe = { method, path: endpoint, status: response.status, credentials: 'omit', content_type: response.headers.get('content-type'), error: typeof body?.error === 'string' ? body.error : '' };
    if (!applicationDenial(probe.status, probe.error) || !/^application\/json(?:\s*;|$)/i.test(probe.content_type || '')) throw Error(`Fxiaoke anonymous ${method} was not denied by the application`);
    // Record only allowlisted error data, never provider bodies or credentials.
    probe.response_artifact = write(`anonymous-${method.toLowerCase()}.json`, JSON.stringify(probe, null, 2) + '\n');
    apiArtifacts.push(probe.response_artifact); probes.push(probe);
  }
  const commonFields = { contract_version: CONTRACT, environment: 'production', origin: ORIGIN, commit, deployment_id: deploymentId };
  const section = {
    connection_preview: envelope('connection-preview', { ...operator.payload, ...commonFields, source: 'trusted_existing_chrome_operator', source_operator_sha256: operator.sha256, attachments: operatorArtifacts }),
    verifier: envelope('verifier', { ...commonFields, source: 'live_fxiaoke_connection_verifier', read_only: true, source_operator_sha256: operator.sha256, observed_at: new Date().toISOString(), probes, attachments: [...apiArtifacts, ...operatorArtifacts] }),
  };
  const blockers = productionBlockers(section, expected);
  if (blockers.length) throw Error(blockers.join('; '));
  return section;
}
module.exports = { CONTRACT, ORIGIN, PREVIEW_ACTIONS, PRODUCTION_ACTIONS, productionWriteBoundaryBlockers, productionReleaseScopeBlockers, previewBlockers, productionOperatorBlockers, productionBlockers, verify };
