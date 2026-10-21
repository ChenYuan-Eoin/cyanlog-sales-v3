// F003 code-only release: public denial probes are machine evidence; logged-in
// editing is an existing-Chrome operator attestation. No production save occurs.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONTRACT = 'f003-role-permissions-v1';
const ORIGIN = 'https://sales.cyanlog.icu';
const PREVIEW_ACTIONS = Object.freeze(['open_roles', 'save_role_permissions', 'verify_saved_permissions', 'revoke_role_permissions', 'verify_access_denied', 'restore_role_permissions']);
const PRODUCTION_ACTIONS = Object.freeze(['open_roles', 'read_effective_permissions', 'edit_role_permissions', 'discard_role_changes', 'verify_no_saved_change']);
const EDIT_FLAGS = ['super_admin', 'role_list_read', 'effective_permissions_read', 'permission_checkbox_changed', 'changes_discarded'];
const SHA256 = /^[0-9a-f]{64}$/;
const ROLE_ID = /^[a-zA-Z0-9-]{1,80}$/;
const isJson = value => /^application\/json(?:\s*;|$)/i.test(value || '');
const isApplicationDenial = (status, code) => status === 401 ? ['Unauthorized', 'A001'].includes(code) : status === 403 && ['Forbidden', 'A002'].includes(code);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const permissionList = value => Array.isArray(value) && value.length <= 300 && value.every(nonempty) && new Set(value).size === value.length;
const samePermissions = (a, b) => permissionList(a) && permissionList(b) && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function previewBlockers(section) {
  const errors = [];
  const save = section.role_edit_save?.payload || {}, access = section.role_access_enforcement?.payload || {};
  for (const [name, payload] of [['role_edit_save', save], ['role_access_enforcement', access]]) {
    if (payload.contract_version !== CONTRACT || payload.environment !== 'preview' || payload.source !== 'preview_api'
      || payload.isolated_project_ref !== 'vsfropnfsmnonkotywsx') errors.push(`F003 ${name} requires the isolated Preview API contract`);
    if (['org_id', 'role_id', 'actor_id'].some(key => !nonempty(payload[key]))) errors.push(`F003 ${name} lacks scoped actor/role identity`);
    if (!Array.isArray(payload.attachments) || !payload.attachments.length) errors.push(`F003 ${name} lacks raw API attachments`);
  }
  if (save.org_id !== access.org_id) errors.push('F003 Preview operations must use the same organization');
  if (!permissionList(save.before_permissions) || !permissionList(save.saved_permissions)
    || samePermissions(save.before_permissions, save.saved_permissions)
    || !samePermissions(save.before_permissions, save.restored_permissions)) errors.push('F003 Preview must change and restore a permission snapshot');
  for (const key of ['read_before_status', 'read_after_status', 'read_restored_status', 'save_status', 'restore_status']) {
    if (save[key] !== 200) errors.push(`F003 Preview save/readback failed: ${key}`);
  }
  for (const key of ['persisted_readback', 'template_unchanged', 'other_settings_preserved', 'restored']) {
    if (save[key] !== true) errors.push(`F003 Preview persistence proof missing: ${key}`);
  }
  if (access.revoke_status !== 200 || !Array.isArray(access.revoked_permissions) || access.revoked_permissions.length
    || access.revoked_readback !== true || access.restored !== true) errors.push('F003 Preview revocation and restoration are not verified');
  for (const key of ['revoked_access_status', 'non_root_patch_status', 'cross_org_patch_status']) {
    if (access[key] !== 403) errors.push(`F003 Preview access denial missing: ${key}`);
  }
  if (access.stale_snapshot_status !== 409) errors.push('F003 Preview stale permission snapshot must conflict');
  return errors;
}

function productionOperatorBlockers(payload, expected = {}) {
  const errors = [];
  if (!payload || typeof payload !== 'object') return ['F003 Production operator payload is missing'];
  if (payload.contract_version !== CONTRACT) errors.push('F003 operator contract version is invalid');
  if (payload.commit !== expected.commit || payload.deployment_id !== expected.deploymentId) errors.push('F003 operator is not bound to the released commit/deployment');
  let origin;
  try { origin = new URL(payload.url || payload.origin).origin; } catch { origin = ''; }
  if (origin !== ORIGIN || payload.environment !== 'production') errors.push('F003 operator must observe the exact Production origin');
  if (!ROLE_ID.test(payload.role_id || '') || !nonempty(payload.org_id) || !nonempty(payload.operator_id)) errors.push('F003 operator lacks scoped organization/role identity');
  if (payload.attestation_type !== 'trusted_operator_browser' || payload.trust_boundary !== 'operator_attestation_not_machine_proof'
    || payload.attestation_method !== 'codex_chrome_control_existing_session' || !nonempty(payload.attested_by)
    || payload.browser_context !== 'existing_user_chrome' || !nonempty(payload.existing_tab_id)
    || payload.new_tabs !== 0 || payload.new_browser_contexts !== 0 || payload.result !== 'pass') errors.push('F003 requires an explicit existing-Chrome operator attestation');
  const observed = Date.parse(payload.attested_at || ''), now = expected.now ?? Date.now();
  if (!Number.isFinite(observed) || observed > now + 60_000 || now - observed > 60 * 60_000) errors.push('F003 operator attestation is not fresh');
  for (const key of EDIT_FLAGS) if (payload[key] !== true) errors.push(`F003 operator observation missing: ${key}`);
  if (payload.save_submitted !== false || payload.business_mutations !== false || payload.persistence_verified !== false) errors.push('F003 Production acceptance must discard edits and explicitly leave persistence unverified');
  if (JSON.stringify(payload.actions) !== JSON.stringify(PRODUCTION_ACTIONS)) errors.push('F003 Production operator action sequence is incomplete');
  if (!Array.isArray(payload.attachments) || !payload.attachments.length) errors.push('F003 Production operator has no visual/trace attachments');
  return errors;
}

function productionBlockers(section, expected) {
  const errors = [];
  const verifier = section.verifier?.payload || {}, read = section.role_read_edit?.payload || {}, access = section.role_unauthorized_access?.payload || {};
  for (const [name, payload] of [['verifier', verifier], ['role_read_edit', read], ['role_unauthorized_access', access]]) {
    if (payload.contract_version !== CONTRACT || payload.environment !== 'production' || payload.origin !== ORIGIN
      || payload.commit !== expected.commit || payload.deployment_id !== expected.deploymentId) errors.push(`F003 ${name} Production binding is invalid`);
    if (payload.business_mutations !== false || payload.persistence_verified !== false) errors.push(`F003 ${name} must preserve the read-only acceptance boundary`);
    if (!Array.isArray(payload.attachments) || !payload.attachments.length) errors.push(`F003 ${name} has no controlled evidence attachments`);
  }
  if (verifier.source !== 'live_production_application_verifier' || verifier.read_only !== true || verifier.request_count !== 2) errors.push('F003 controlled Production verifier receipt is invalid');
  if (read.source !== 'trusted_existing_chrome_operator' || !SHA256.test(read.source_operator_sha256 || '')
    || read.source_operator_sha256 !== verifier.source_operator_sha256) errors.push('F003 operator proof is not bound to the controlled receipt');
  const verifiedAt = Date.parse(verifier.observed_at || '');
  if (!Number.isFinite(verifiedAt) || verifiedAt > Date.now() + 60_000) errors.push('F003 controlled verifier timestamp is missing or in the future');
  // Freshness is checked at collection, so a sealed historical proof remains
  // verifiable later without pretending the operator is still in that session.
  errors.push(...productionOperatorBlockers(read, { ...expected, now: Number.isFinite(verifiedAt) ? verifiedAt : Date.now() }));
  if (access.source !== 'production_api') errors.push('F003 access proof must come from the Production API');
  const probes = access.probes;
  if (!Array.isArray(probes) || probes.length !== 2) errors.push('F003 must perform exactly the anonymous GET and PATCH probes');
  else for (const [index, method] of ['GET', 'PATCH'].entries()) {
    const probe = probes[index], endpoint = method === 'GET' ? '/api/roles' : `/api/roles/${read.role_id}`;
    if (!probe || typeof probe !== 'object') { errors.push(`F003 anonymous ${method} probe is malformed`); continue; }
    if (probe.method !== method || probe.path !== endpoint || probe.credentials !== 'omit' || ![401, 403].includes(probe.status)) errors.push(`F003 anonymous ${method} was not denied by Production`);
    if (!isJson(probe.content_type) || !isApplicationDenial(probe.status, probe.application_error_code)) errors.push(`F003 anonymous ${method} lacks an application JSON authorization error`);
    if (!access.attachments?.some(item => item.path === probe.response_artifact?.path && item.sha256 === probe.response_artifact?.sha256)) errors.push(`F003 anonymous ${method} lacks its raw response binding`);
  }
  return errors;
}

function readArtifact(runtime, file, expectedHash) {
  if (typeof file !== 'string' || !SHA256.test(expectedHash || '')) throw Error('Invalid F003 input artifact');
  const real = fs.realpathSync(path.resolve(runtime, file));
  if (!real.startsWith(runtime + path.sep)) throw Error('F003 input artifact escapes the worktree runtime');
  const stat = fs.statSync(real);
  if (!stat.isFile() || stat.size <= 0 || stat.size > 25 * 1024 * 1024) throw Error('Invalid F003 input artifact size');
  const bytes = fs.readFileSync(real);
  if (hash(bytes) !== expectedHash) throw Error('F003 input artifact hash mismatch');
  return bytes;
}

async function verify({ runtime, operator, commit, deploymentId }) {
  const errors = productionOperatorBlockers(operator?.payload, { commit, deploymentId });
  if (errors.length) throw Error(errors.join('; '));
  runtime = fs.realpathSync(runtime);
  const original = readArtifact(runtime, operator.artifact_path, operator.sha256);
  if (JSON.stringify(canonical(JSON.parse(original.toString('utf8')))) !== JSON.stringify(canonical(operator.payload))) throw Error('F003 operator envelope payload mismatch');
  const parent = path.join(runtime, 'production-runtime-verifier');
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (!fs.realpathSync(parent).startsWith(runtime + path.sep)) throw Error('F003 output directory escapes the worktree runtime');
  const prefix = `production-runtime-verifier/f003-${crypto.randomUUID()}`;
  fs.mkdirSync(path.join(runtime, prefix), { mode: 0o700 });
  const write = (name, bytes) => {
    const artifact_path = `${prefix}/${name}`;
    fs.writeFileSync(path.join(runtime, artifact_path), bytes, { mode: 0o600, flag: 'wx' });
    return { path: artifact_path, sha256: hash(bytes) };
  };
  const envelope = (name, payload) => {
    const artifact = write(`${name}.json`, JSON.stringify(payload, null, 2) + '\n');
    return { artifact_path: artifact.path, sha256: artifact.sha256, payload };
  };
  const operatorArtifacts = operator.payload.attachments.map((item, index) => {
    const suffix = path.extname(item.path).replace(/[^.a-zA-Z0-9]/g, '') || '.bin';
    return write(`operator-attachment-${index}${suffix}`, readArtifact(runtime, item.path, item.sha256));
  });
  operatorArtifacts.push(write('operator-original.json', original));
  const probes = [], apiArtifacts = [];
  for (const method of ['GET', 'PATCH']) {
    const endpoint = method === 'GET' ? '/api/roles' : `/api/roles/${operator.payload.role_id}`;
    const response = await fetch(ORIGIN + endpoint, {
      method, credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(15_000),
      headers: { accept: 'application/json', ...(method === 'PATCH' ? { 'content-type': 'application/json' } : {}) },
      // Missing mutation fields remain invalid even if authentication regresses;
      // the expected 401/403 still proves rejection before business validation.
      ...(method === 'PATCH' ? { body: '{}' } : {})
    });
    const body = await response.text();
    if (body.length > 128 * 1024) throw Error('F003 public response exceeded the evidence limit');
    const raw = { method, path: endpoint, url: ORIGIN + endpoint, status: response.status, credentials: 'omit', observed_at: new Date().toISOString(), content_type: response.headers.get('content-type'), response_body: body };
    const artifact = write(`anonymous-${method.toLowerCase()}.json`, JSON.stringify(raw, null, 2) + '\n');
    if (![401, 403].includes(response.status)) throw Error(`F003 anonymous ${method} unexpectedly returned ${response.status}; acceptance denied`);
    let responseBody;
    try { responseBody = JSON.parse(body); } catch { throw Error(`F003 anonymous ${method} did not return an application JSON error`); }
    const applicationErrorCode = typeof responseBody?.error === 'string'
      ? responseBody.error : responseBody?.success === false ? responseBody.error?.code : null;
    if (!isJson(raw.content_type) || !isApplicationDenial(response.status, applicationErrorCode)) throw Error(`F003 anonymous ${method} lacks the expected application authorization error`);
    apiArtifacts.push(artifact);
    probes.push({ method, path: endpoint, status: response.status, credentials: 'omit', content_type: raw.content_type, application_error_code: applicationErrorCode, response_artifact: artifact });
  }
  const common = { contract_version: CONTRACT, environment: 'production', origin: ORIGIN, commit, deployment_id: deploymentId, business_mutations: false, persistence_verified: false };
  const section = {
    role_read_edit: envelope('role-read-edit', { ...operator.payload, ...common, source: 'trusted_existing_chrome_operator', source_operator_sha256: operator.sha256, attachments: operatorArtifacts }),
    role_unauthorized_access: envelope('role-unauthorized-access', { ...common, source: 'production_api', probes, attachments: apiArtifacts }),
    verifier: envelope('verifier', { ...common, source: 'live_production_application_verifier', read_only: true, request_count: 2, source_operator_sha256: operator.sha256, observed_at: new Date().toISOString(), attachments: [...apiArtifacts, ...operatorArtifacts] })
  };
  const blockers = productionBlockers(section, { commit, deploymentId });
  if (blockers.length) throw Error(blockers.join('; '));
  return section;
}

module.exports = { CONTRACT, PREVIEW_ACTIONS, PRODUCTION_ACTIONS, previewBlockers, productionOperatorBlockers, productionBlockers, verify };
