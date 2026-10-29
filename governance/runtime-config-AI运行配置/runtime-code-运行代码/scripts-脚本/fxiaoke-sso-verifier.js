// WP94: evidence checks for the Fxiaoke employee OAuth journey. This module
// validates artifacts and public rejection probes; it never exchanges real user
// codes, creates sessions, changes identities or claims an operator observation
// as machine proof.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONTRACT = 'f003-fxiaoke-sso-v1';
const ORIGIN = 'https://sales.cyanlog.icu';
const PREVIEW_ACTIONS = Object.freeze([
  'open_login',
  'start_fxiaoke_sso',
  'complete_fxiaoke_sso',
  'verify_session_scope',
  'verify_invalid_state',
  'verify_replayed_state',
  'verify_cross_enterprise_denial',
  'verify_unmapped_identity_denial',
  'verify_binding_required_denial'
]);
const PRODUCTION_ACTIONS = Object.freeze([
  'open_login',
  'login_admin_with_fxiaoke',
  'verify_admin_role_and_tenant',
  'login_ordinary_employee_with_fxiaoke',
  'verify_employee_role_and_tenant',
  'verify_invalid_state',
  'verify_replayed_state',
  'verify_replayed_code',
  'verify_cross_enterprise_denial',
  'verify_unmapped_identity_denial',
  'verify_disabled_identity_denial',
  'verify_identity_conflict_denial',
  'verify_cross_tenant_isolation',
  'verify_no_silent_phone_autolink',
  'verify_password_recovery_removed'
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function sameActions(value, actions) {
  return JSON.stringify(value) === JSON.stringify(actions);
}

function safeOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : '';
  } catch {
    return '';
  }
}

function attachmentShapeValid(attachments) {
  return Array.isArray(attachments)
    && attachments.length > 0
    && attachments.every(item => nonempty(item?.path) && SHA256.test(String(item?.sha256 || '')));
}

function previewBlockers(payload, expected = {}) {
  const errors = [];
  if (!payload || typeof payload !== 'object') return ['F003 SSO Preview evidence is missing'];
  if (payload.contract_version !== CONTRACT || payload.environment !== 'preview') {
    errors.push('F003 SSO Preview contract or environment is invalid');
  }
  if (payload.commit !== expected.commit || payload.deployment_id !== expected.deploymentId) {
    errors.push('F003 SSO Preview evidence is not bound to the candidate commit/deployment');
  }
  if (!safeOrigin(payload.origin)) errors.push('F003 SSO Preview origin is missing or invalid');
  if (payload.source !== 'preview_api_and_existing_chrome_operator') {
    errors.push('F003 SSO Preview needs API and existing-Chrome operator evidence');
  }
  if (!sameActions(payload.actions, PREVIEW_ACTIONS)) {
    errors.push('F003 SSO Preview action sequence is incomplete');
  }
  for (const key of [
    'provider_visible',
    'authorization_start_redirect',
    'admin_login_success',
    'ordinary_login_success',
    'session_issued',
    'state_server_consumed',
    'session_cookie_http_only',
    'state_cookie_http_only'
  ]) {
    if (payload[key] !== true) errors.push(`F003 SSO Preview proof missing: ${key}`);
  }
  if (payload.state_cookie_same_site !== 'lax' || payload.state_cookie_secure !== true
    || !Number.isInteger(payload.state_cookie_max_age_seconds)
    || payload.state_cookie_max_age_seconds < 60 || payload.state_cookie_max_age_seconds > 600) {
    errors.push('F003 SSO Preview state cookie is not short-lived, Secure and SameSite=Lax');
  }
  const statuses = {
    invalid_state_status: 302,
    replayed_state_status: 302,
    cross_enterprise_status: 302,
    unmapped_identity_status: 302
  };
  for (const [key, status] of Object.entries(statuses)) {
    if (payload[key] !== status) errors.push(`F003 SSO Preview denial mismatch: ${key}`);
  }
  if (payload.identity_match_method !== 'stable_mapping') {
    errors.push('F003 SSO Preview must resolve only through external_identities stable mapping');
  }
  if (payload.name_matching_used !== false) errors.push('F003 SSO Preview used name matching');
  if (payload.silent_phone_autolink_used !== false) errors.push('F003 SSO Preview used silent phone auto-linking');
  if (payload.cross_tenant_session_created !== false) errors.push('F003 SSO Preview created a cross-tenant session');
  if (!UUID.test(String(payload.admin_user_id || '')) || !UUID.test(String(payload.ordinary_user_id || ''))
    || !nonempty(payload.org_id) || payload.org_id !== payload.admin_org_id || payload.org_id !== payload.ordinary_org_id) {
    errors.push('F003 SSO Preview identities are not bound to the same exact organization');
  }
  if (!Array.isArray(payload.admin_role_codes) || !payload.admin_role_codes.includes('SUPER_ADMIN')
    || !Array.isArray(payload.ordinary_role_codes) || payload.ordinary_role_codes.includes('SUPER_ADMIN')) {
    errors.push('F003 SSO Preview does not distinguish the real administrator and ordinary employee roles');
  }
  if (!attachmentShapeValid(payload.attachments)) errors.push('F003 SSO Preview lacks hashed raw attachments');
  return errors;
}

function productionOperatorBlockers(payload, expected = {}) {
  const errors = [];
  if (!payload || typeof payload !== 'object') return ['F003 SSO Production operator payload is missing'];
  if (payload.contract_version !== CONTRACT) errors.push('F003 SSO operator contract version is invalid');
  if (payload.commit !== expected.commit || payload.deployment_id !== expected.deploymentId) {
    errors.push('F003 SSO operator is not bound to the released commit/deployment');
  }
  if (safeOrigin(payload.url || payload.origin) !== ORIGIN || payload.environment !== 'production') {
    errors.push('F003 SSO operator must observe the exact Production origin');
  }
  if (payload.attestation_type !== 'trusted_operator_browser'
    || payload.trust_boundary !== 'operator_attestation_not_machine_proof'
    || payload.attestation_method !== 'codex_chrome_control_existing_session'
    || payload.browser_context !== 'existing_user_chrome'
    || !nonempty(payload.existing_tab_id)
    || payload.new_tabs !== 0
    || payload.new_browser_contexts !== 0
    || !nonempty(payload.attested_by)
    || payload.result !== 'pass') {
    errors.push('F003 SSO requires an explicit existing-Chrome operator attestation');
  }
  const observed = Date.parse(payload.attested_at || '');
  const now = expected.now ?? Date.now();
  if (!Number.isFinite(observed) || observed > now + 60_000 || now - observed > 60 * 60_000) {
    errors.push('F003 SSO operator attestation is not fresh');
  }
  if (!sameActions(payload.actions, PRODUCTION_ACTIONS)) {
    errors.push('F003 SSO Production action sequence is incomplete');
  }
  for (const key of [
    'admin_login_success',
    'ordinary_login_success',
    'session_issued',
    'admin_role_verified',
    'employee_role_verified',
    'admin_corp_matches',
    'ordinary_corp_matches',
    'tenant_isolation_verified',
    'invalid_state_rejected',
    'replayed_state_rejected',
    'replayed_code_rejected',
    'cross_enterprise_rejected',
    'unmapped_identity_rejected',
    'disabled_identity_rejected',
    'identity_conflict_rejected',
    'password_recovery_removed'
  ]) {
    if (payload[key] !== true) errors.push(`F003 SSO Production observation missing: ${key}`);
  }
  if (payload.name_matching_used !== false || payload.cross_tenant_session_created !== false) {
    errors.push('F003 SSO Production acceptance must prove name matching and cross-tenant login are disabled');
  }
  if (payload.identity_match_method !== 'stable_mapping' || payload.silent_phone_autolink_used !== false) {
    errors.push('F003 SSO Production must resolve only through stable mapping with no silent phone auto-link');
  }
  if (!UUID.test(String(payload.admin_user_id || '')) || !UUID.test(String(payload.ordinary_user_id || ''))
    || !UUID.test(String(payload.org_id || ''))) {
    errors.push('F003 SSO Production identities are incomplete');
  }
  if (!Array.isArray(payload.admin_role_codes) || !payload.admin_role_codes.includes('SUPER_ADMIN')
    || !Array.isArray(payload.ordinary_role_codes) || payload.ordinary_role_codes.includes('SUPER_ADMIN')) {
    errors.push('F003 SSO Production roles are not verified');
  }
  if (!attachmentShapeValid(payload.attachments)) errors.push('F003 SSO operator lacks hashed raw attachments');
  return errors;
}

function envelopePayload(section, name) {
  return section?.[name]?.payload || {};
}

function productionBlockers(section, expected) {
  const errors = [];
  const login = envelopePayload(section, 'fxiaoke_sso_login');
  const denials = envelopePayload(section, 'fxiaoke_sso_denials');
  const verifier = envelopePayload(section, 'verifier');
  for (const [name, payload] of [['fxiaoke_sso_login', login], ['fxiaoke_sso_denials', denials], ['verifier', verifier]]) {
    if (payload.contract_version !== CONTRACT || payload.environment !== 'production'
      || payload.commit !== expected.commit || payload.deployment_id !== expected.deploymentId
      || safeOrigin(payload.origin) !== ORIGIN) {
      errors.push(`F003 SSO Production evidence binding mismatch: ${name}`);
    }
    if (!attachmentShapeValid(payload.attachments)) errors.push(`F003 SSO Production evidence lacks raw attachments: ${name}`);
  }
  if (login.source !== 'trusted_existing_chrome_operator') errors.push('F003 SSO login evidence is not operator-attested');
  if (login.admin_login_success !== true || login.ordinary_login_success !== true || login.session_issued !== true) {
    errors.push('F003 SSO Production did not complete both real logins');
  }
  if (login.admin_corp_matches !== true || login.ordinary_corp_matches !== true || login.name_matching_used !== false) {
    errors.push('F003 SSO Production enterprise or identity checks are incomplete');
  }
  if (login.identity_match_method !== 'stable_mapping' || login.silent_phone_autolink_used !== false) {
    errors.push('F003 SSO Production login did not use stable mapping only');
  }
  for (const key of [
    'invalid_state_rejected',
    'replayed_state_rejected',
    'replayed_code_rejected',
    'cross_enterprise_rejected',
    'unmapped_identity_rejected',
    'disabled_identity_rejected',
    'identity_conflict_rejected',
    'tenant_isolation_verified'
  ]) {
    if (login[key] !== true) errors.push(`F003 SSO Production operator denial proof missing: ${key}`);
  }
  if (denials.invalid_state_probe_status !== 302 || denials.invalid_state_error_code !== 'SSO_STATE_INVALID') {
    errors.push('F003 SSO Production invalid-state probe did not fail closed through login');
  }
  if (denials.password_login_removed !== true || denials.public_password_endpoint_status !== 404) {
    errors.push('F003 SSO Production must remove the browser password recovery path');
  }
  if (verifier.source !== 'live_fxiaoke_sso_verifier' || verifier.request_count !== 4) {
    errors.push('F003 SSO Production has no controlled public-route verifier');
  }
  if (!Array.isArray(verifier.probes) || verifier.probes.length !== 4
    || !sameActions(verifier.probes.map(probe => probe?.name), ['providers', 'start', 'invalid-state', 'password-login'])) {
    errors.push('F003 SSO Production verifier probes are incomplete');
  }
  if (verifier.state_cookie_present !== true || verifier.state_cookie_http_only !== true
    || verifier.state_cookie_secure !== true || verifier.state_cookie_same_site_lax !== true
    || verifier.state_cookie_callback_path !== true) {
    errors.push('F003 SSO Production state cookie security attributes are incomplete');
  }
  if (login.source_operator_sha256 !== verifier.source_operator_sha256
    || denials.source_operator_sha256 !== verifier.source_operator_sha256) {
    errors.push('F003 SSO Production evidence sections do not share the same operator source');
  }
  return errors;
}

function readArtifact(runtime, file, expectedHash) {
  if (!nonempty(file) || !SHA256.test(String(expectedHash || ''))) throw Error('invalid F003 SSO evidence attachment');
  const real = fs.realpathSync(path.resolve(runtime, file));
  if (!real.startsWith(runtime + path.sep)) throw Error('F003 SSO evidence attachment escapes runtime');
  const stat = fs.statSync(real);
  if (!stat.isFile() || stat.size <= 0 || stat.size > 25 * 1024 * 1024) throw Error('invalid F003 SSO evidence attachment size');
  const bytes = fs.readFileSync(real);
  if (sha256(bytes) !== expectedHash) throw Error('F003 SSO evidence attachment hash mismatch');
  return bytes;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

async function verify({ runtime, operator, commit, deploymentId, request = fetch }) {
  const expected = { commit, deploymentId };
  const operatorErrors = productionOperatorBlockers(operator?.payload, expected);
  if (operatorErrors.length) throw Error(operatorErrors.join('; '));
  runtime = fs.realpathSync(runtime);
  const original = readArtifact(runtime, operator.artifact_path, operator.sha256);
  if (JSON.stringify(canonical(JSON.parse(original.toString('utf8')))) !== JSON.stringify(canonical(operator.payload))) {
    throw Error('F003 SSO operator payload does not match its artifact');
  }
  const parent = path.join(runtime, 'production-runtime-verifier');
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (!fs.realpathSync(parent).startsWith(runtime + path.sep)) throw Error('F003 SSO evidence output escapes runtime');
  const prefix = `production-runtime-verifier/fxiaoke-sso-${crypto.randomUUID()}`;
  fs.mkdirSync(path.join(runtime, prefix), { mode: 0o700 });
  const write = (filename, bytes) => {
    const artifact_path = `${prefix}/${filename}`;
    fs.writeFileSync(path.join(runtime, artifact_path), bytes, { mode: 0o600, flag: 'wx' });
    return { path: artifact_path, sha256: sha256(bytes) };
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

  const probes = [], artifacts = [];
  const execute = async (name, endpoint, expectedStatus) => {
    const response = await request(ORIGIN + endpoint, {
      method: 'GET', credentials: 'omit', redirect: 'manual',
      signal: AbortSignal.timeout(15_000), headers: { accept: 'text/html,application/json' }
    });
    const raw = await response.text();
    if (raw.length > 128 * 1024) throw Error(`F003 SSO ${name} response exceeds evidence limit`);
    const setCookie = response.headers.get('set-cookie') || '';
    const probe = {
      name,
      path: endpoint,
      status: response.status,
      location: response.headers.get('location') || '',
      set_cookie_present: Boolean(setCookie),
      set_cookie_http_only: /;\s*httponly(?:;|$)/i.test(setCookie),
      set_cookie_secure: /;\s*secure(?:;|$)/i.test(setCookie),
      set_cookie_same_site_lax: /;\s*samesite=lax(?:;|$)/i.test(setCookie),
      set_cookie_callback_path: /;\s*path=\/api\/auth\/fxiaoke\/callback(?:;|$)/i.test(setCookie),
      credentials: 'omit'
    };
    if (probe.status !== expectedStatus) throw Error(`F003 SSO ${name} returned ${probe.status}, expected ${expectedStatus}`);
    probe.response_artifact = write(`${name}.json`, JSON.stringify(probe, null, 2) + '\n');
    probes.push(probe);
    artifacts.push(probe.response_artifact);
  };
  await execute('providers', '/api/auth/providers', 200);
  await execute('start', `/api/auth/fxiaoke/start?org=${encodeURIComponent(operator.payload.org_id)}`, 302);
  await execute('invalid-state', '/api/auth/fxiaoke/callback?state=invalid&code=invalid', 302);
  if (!/^https:\/\/open\.fxiaoke\.com\/oauth2\.0\/authorize\?/.test(probes[1].location)) {
    throw Error('F003 SSO start did not redirect to the fixed Fxiaoke authorization endpoint');
  }
  if (!/[?&]sso_error=SSO_STATE_INVALID(?:&|$)/.test(probes[2].location)) {
    throw Error('F003 SSO invalid state did not fail closed');
  }
  if (probes[1].set_cookie_present !== true || probes[1].set_cookie_http_only !== true
    || probes[1].set_cookie_secure !== true || probes[1].set_cookie_same_site_lax !== true
    || probes[1].set_cookie_callback_path !== true) {
    throw Error('F003 SSO state cookie is not protected');
  }
  await execute('password-login', '/api/auth/login', 404);

  const common = { contract_version: CONTRACT, environment: 'production', origin: ORIGIN, commit, deployment_id: deploymentId };
  const section = {
    fxiaoke_sso_login: envelope('fxiaoke-sso-login', {
      ...operator.payload,
      ...common,
      source: 'trusted_existing_chrome_operator',
      source_operator_sha256: operator.sha256,
      attachments: operatorArtifacts
    }),
    fxiaoke_sso_denials: envelope('fxiaoke-sso-denials', {
      ...common,
      source: 'production_api_and_operator',
      invalid_state_probe_status: probes[2].status,
      invalid_state_error_code: 'SSO_STATE_INVALID',
      password_login_removed: probes[3].status === 404,
      public_password_endpoint_status: probes[3].status,
      source_operator_sha256: operator.sha256,
      probes,
      attachments: [...artifacts, ...operatorArtifacts]
    }),
    verifier: envelope('verifier', {
      ...common,
      source: 'live_fxiaoke_sso_verifier',
      request_count: 4,
      source_operator_sha256: operator.sha256,
      observed_at: new Date().toISOString(),
      state_cookie_present: probes[1].set_cookie_present,
      state_cookie_http_only: probes[1].set_cookie_http_only,
      state_cookie_secure: probes[1].set_cookie_secure,
      state_cookie_same_site_lax: probes[1].set_cookie_same_site_lax,
      state_cookie_callback_path: probes[1].set_cookie_callback_path,
      probes,
      attachments: [...artifacts, ...operatorArtifacts]
    })
  };
  const blockers = productionBlockers(section, expected);
  if (blockers.length) throw Error(blockers.join('; '));
  return section;
}

module.exports = {
  CONTRACT,
  ORIGIN,
  PREVIEW_ACTIONS,
  PRODUCTION_ACTIONS,
  previewBlockers,
  productionOperatorBlockers,
  productionBlockers,
  verify
};
