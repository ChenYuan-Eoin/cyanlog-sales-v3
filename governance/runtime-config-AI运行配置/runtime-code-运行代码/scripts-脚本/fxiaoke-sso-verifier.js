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
const RULE_PATHS = new Set([
  'governance/runtime-state/active-task.json',
  'governance/runtime-state/demand-inbox.jsonl',
  'product-truth/product-code/app/api/admin/users/[id]/identity-binding/route.ts',
  'product-truth/product-code/app/api/auth/fxiaoke/start/route.test.ts',
  'product-truth/product-code/lib/auth/session-response.ts',
  'product-truth/product-code/lib/auth/session-response.test.ts',
  'product-truth/product-code/lib/auth/oauth-state.ts',
  'product-truth/product-code/lib/auth/oauth-state.test.ts',
  'product-truth/product-code/lib/fxiaoke/admin-binding-migration.test.ts',
  'product-truth/product-code/supabase/migrations/20261030110000_fix_fxiaoke_identity_binding_uuid.sql',
  ...['project-registry.js', 'fxiaoke-sso-verifier.js', 'fxiaoke-sso-verifier.test.js', 'harness-selftest.js']
    .map(name => `governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/${name}`)
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

function productionFirstExceptionBlockers({
  approval,
  activeId,
  contractVersion,
  productTree,
  changedPaths,
  candidateIsAncestor
} = {}) {
  const errors = [];
  if (activeId !== 'WP94' || contractVersion !== CONTRACT) {
    errors.push('F003 SSO Production-first ordering is limited to WP94');
  }
  if (
    approval?.type !== 'final_production_release_authorization'
    || approval?.source !== 'user_explicit'
    || approval?.state !== 'approved'
    || approval?.preview_order_exception !== true
    || approval?.preview_status !== 'not_passed'
  ) {
    errors.push('Explicit F003 SSO release authority must preserve Preview as not passed');
  }
  if (
    approval?.code_release_authorized !== true
    || typeof approval?.production_database_write_authorized !== 'boolean'
    || approval?.carrier_calls_authorized !== false
    || approval?.account_merge_execution_authorized !== false
    || approval?.phone_history_migration_authorized !== false
    || approval?.password_removal_authorized !== false
  ) {
    errors.push('F003 SSO release must allow only scoped SSO migrations and preserve excluded write boundaries');
  }
  if (
    !/^[a-f0-9]{40}$/.test(approval?.approved_candidate || '')
    || candidateIsAncestor !== true
    || !/^[a-f0-9]{40}$/.test(approval?.approved_product_tree || '')
    || productTree !== approval?.approved_product_tree
  ) {
    errors.push('F003 SSO release must retain the approved product tree and ancestry');
  }
  if (
    !Array.isArray(changedPaths)
    || changedPaths.some(file => !RULE_PATHS.has(file))
  ) {
    errors.push('Only scoped F003 SSO delivery rules may follow the approved candidate');
  }
  if (!/^[a-f0-9]{40}$/.test(approval?.rollback_commit || '')) {
    errors.push('Concrete F003 SSO rollback commit required');
  }
  const migrations = approval?.authorized_migrations;
  if (
    !Array.isArray(migrations)
    || (approval?.production_database_write_authorized !== false && migrations.length === 0)
    || migrations.some(item => !nonempty(item?.path) || !SHA256.test(String(item?.sha256 || '')))
  ) {
    errors.push('Explicit F003 SSO migration hashes are required');
  }
  return errors;
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
  productionFirstExceptionBlockers,
  previewBlockers,
  productionOperatorBlockers,
  productionBlockers,
  verify
};

// A code-only organization member page release is independent of full SSO
// acceptance. The old contract above remains unchanged and still requires its
// real identity-denial matrix.
const MEMBER_CONTRACT = 'f003-org-member-ui-v1';
const MEMBER_ACTIONS = Object.freeze(['default_active_members', 'departed_members', 'directory_controls', 'employee_login_entry', 'manual_member_boundary']);
const MEMBER_FLAGS = Object.freeze(['active_members_only_by_default', 'departed_not_first_login', 'historical_records_queryable', 'manual_member_controls_preserved', 'directory_lifecycle_controls_absent', 'employee_login_link_visible']);
function memberOperatorBlockers(payload, expected = {}) {
  const errors = [];
  if (!payload || payload.contract_version !== MEMBER_CONTRACT || payload.environment !== 'production'
    || payload.url !== ORIGIN + '/configs?tab=org-structure') errors.push('Member UI operator scope mismatch');
  if (payload?.commit !== expected.commit || payload?.deployment_id !== expected.deploymentId) errors.push('Member UI operator commit/deployment mismatch');
  if (payload?.attestation_type !== 'trusted_operator_browser' || payload?.trust_boundary !== 'operator_attestation_not_machine_proof'
    || payload?.source !== 'trusted_existing_iab_operator' || payload?.browser_context !== 'existing_user_iab'
    || payload?.attestation_method !== 'codex_iab_control_existing_session' || !nonempty(payload?.existing_tab_id)
    || payload?.new_tabs !== 0 || payload?.new_browser_contexts !== 0 || !nonempty(payload?.attested_by)) errors.push('Member UI needs the user existing IAB session');
  const age = (expected.now ?? Date.now()) - Date.parse(payload?.attested_at || '');
  if (!Number.isFinite(age) || age < -60000 || age > 2 * 3600000) errors.push('Member UI operator evidence must be fresh');
  if (payload?.result !== 'pass' || payload?.no_business_writes !== true || payload?.carrier_calls !== false
    || payload?.full_sso_acceptance !== false) errors.push('Member UI must remain read-only and cannot claim full SSO acceptance');
  if (!sameActions(payload?.actions, MEMBER_ACTIONS) || !Array.isArray(payload?.observations)
    || payload.observations.length !== MEMBER_ACTIONS.length
    || payload.observations.some((x,i) => x?.action !== MEMBER_ACTIONS[i] || x?.result !== 'pass' || !nonempty(x?.detail))) errors.push('Member UI observations incomplete');
  for (const flag of MEMBER_FLAGS) if (payload?.[flag] !== true) errors.push('Member UI missing observation: ' + flag);
  if (!attachmentShapeValid(payload?.attachments)) errors.push('Member UI raw observations missing');
  return errors;
}
function memberProductionFirstBlockers(args = {}) {
  const { approval, productTree, changedPaths, candidateIsAncestor } = args;
  const errors = [];
  if (args.activeId !== 'WP94' || args.contractVersion !== MEMBER_CONTRACT) errors.push('Member UI scope mismatch');
  if (approval?.type !== 'final_production_release_authorization' || approval?.state !== 'approved' || approval?.source !== 'user_explicit'
    || approval?.preview_order_exception !== true || approval?.preview_status !== 'not_passed'
    || approval?.code_release_authorized !== true || approval?.production_database_write_authorized !== false
    || approval?.database_write_authorized !== false || approval?.carrier_calls_authorized !== false
    || approval?.full_sso_acceptance !== false || approval?.operator_browser !== 'existing_user_iab') errors.push('Member UI requires scoped code-only authority');
  if (!/^[a-f0-9]{40}$/.test(approval?.approved_candidate || '') || !/^[a-f0-9]{40}$/.test(approval?.approved_product_tree || '')
    || candidateIsAncestor !== true || productTree !== approval.approved_product_tree) errors.push('Member UI candidate tree/ancestry mismatch');
  const rules = new Set(['governance/runtime-state/active-task.json', 'governance/runtime-state/demand-inbox.jsonl',
    ...['project-registry.js','fxiaoke-sso-verifier.js','fxiaoke-sso-verifier.test.js','harness-selftest.js'].map(x=>'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/'+x)]);
  if (!Array.isArray(changedPaths) || changedPaths.some(x=>!rules.has(x))) errors.push('Member UI post-approval product changes');
  if (!/^[a-f0-9]{40}$/.test(approval?.rollback_commit || '')) errors.push('Member UI rollback required');
  return errors;
}
function memberProductionBlockers(section, expected = {}) {
  const errors=[];const page=section?.org_member_ui?.payload, proof=section?.verifier?.payload;
  if (!page || !proof || page.contract_version !== MEMBER_CONTRACT || proof.contract_version !== MEMBER_CONTRACT
    || page.commit !== expected.commit || proof.commit !== expected.commit || page.deployment_id !== expected.deploymentId
    || proof.deployment_id !== expected.deploymentId || page.environment !== 'production' || proof.environment !== 'production'
    || page.source !== 'trusted_existing_iab_operator' || proof.source !== 'live_member_ui_verifier'
    || page.full_sso_acceptance !== false || proof.read_only !== true || proof.result !== 'pass') errors.push('Member UI controlled receipt mismatch');
  if (!SHA256.test(page?.source_operator_sha256 || '') || page.source_operator_sha256 !== proof?.source_operator_sha256) errors.push('Member UI operator binding mismatch');
  if (!Array.isArray(proof?.probes) || proof.probes.length !== 2 || proof.probes[0]?.path !== '/api/auth/providers'
    || proof.probes[0]?.status !== 200 || proof.probes[0]?.provider_available !== true
    || proof.probes[1]?.path !== '/configs?tab=org-structure' || ![302,303,307,308].includes(proof.probes[1]?.status)
    || proof.probes[1]?.location !== '/login') errors.push('Member UI anonymous/login probes incomplete');
  if (page) errors.push(...memberOperatorBlockers(page.operator_attestation, {...expected,now:Date.parse(proof?.observed_at||'')}));
  return errors;
}
async function verifyMemberUi({runtime,operator,commit,deploymentId,request=fetch}={}) {
  const expected={commit,deploymentId};const errors=memberOperatorBlockers(operator?.payload,expected);if(errors.length)throw Error(errors.join('; '));
  const original=readArtifact(runtime,operator.artifact_path,operator.sha256);
  if (JSON.stringify(JSON.parse(original)) !== JSON.stringify(operator.payload)) throw Error('Member UI operator envelope mismatch');
  const folder=path.join(runtime,'production-runtime-verifier');fs.mkdirSync(folder,{recursive:true});
  const write=(name,value)=>{const b=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));const p=path.join(folder,'member-'+name);fs.writeFileSync(p,b);return {path:'production-runtime-verifier/member-'+name,sha256:sha256(b)}};
  const attachments=operator.payload.attachments.map((x,i)=>write('attachment-'+i+path.extname(x.path),readArtifact(runtime,x.path,x.sha256)));
  attachments.push(write('operator-original.json',original));
  const probes=[];
  for(const endpoint of ['/api/auth/providers','/configs?tab=org-structure']){
    const response=await request(ORIGIN+endpoint,{method:'GET',credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(15000)});
    const raw=await response.text();const probe={path:endpoint,status:response.status,location:response.headers.get('location')||'',credentials:'omit'};
    if(endpoint==='/api/auth/providers'){let body;try{body=JSON.parse(raw)}catch{}probe.provider_available=body?.providers?.some(x=>x.id==='fxiaoke'&&x.startUrl==='/api/auth/fxiaoke/start')===true;}
    probe.raw=write('probe-'+probes.length+'.json',{...probe,response_sha256:sha256(raw)});probes.push(probe);
  }
  const common={contract_version:MEMBER_CONTRACT,environment:'production',origin:ORIGIN,commit,deployment_id:deploymentId,source_operator_sha256:operator.sha256,attachments};
  const envelope=(name,payload)=>{const ref=write(name+'.json',payload);return {artifact_path:ref.path,sha256:ref.sha256,payload}};
  const section={org_member_ui:envelope('page',{...common,source:'trusted_existing_iab_operator',full_sso_acceptance:false,operator_attestation:operator.payload}),verifier:envelope('verifier',{...common,source:'live_member_ui_verifier',read_only:true,result:'pass',observed_at:new Date().toISOString(),probes})};
  const blockers=memberProductionBlockers(section,expected);if(blockers.length)throw Error(blockers.join('; '));return section;
}
const memberAdapter={CONTRACT:MEMBER_CONTRACT,ITEMS:['org_member_ui'],PRODUCTION_ITEMS:['org_member_ui'],PREVIEW_ACTIONS:MEMBER_ACTIONS,PRODUCTION_ACTIONS:MEMBER_ACTIONS,
  productionFirstExceptionBlockers:memberProductionFirstBlockers,productionOperatorBlockers:memberOperatorBlockers,productionBlockers:memberProductionBlockers,
  previewBlockers:()=>['Member UI Preview remains not passed until a real isolated operator journey is available'],verify:verifyMemberUi};
module.exports.forContract = version => version === MEMBER_CONTRACT ? memberAdapter : module.exports;
