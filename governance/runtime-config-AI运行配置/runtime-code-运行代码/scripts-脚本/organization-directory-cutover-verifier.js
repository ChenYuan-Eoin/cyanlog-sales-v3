// WP92 code-only contract. Verifies the provider-neutral directory plan,
// scope gate, capability separation and atomic cutover contract. It does not
// authorize a Production migration, directory write, source switch or release.
const CONTRACT = 'f003-directory-cutover-v1';
const ITEMS = Object.freeze([
  'organization_directory_snapshot',
  'organization_directory_cutover',
]);
const ASSERTIONS = Object.freeze([
  'shared_connection_truth',
  'provider_adapter_capabilities',
  'structural_and_scope_completeness_separate',
  'scope_unverified_blocks_plan',
  'immutable_plan_bindings',
  'conflict_batch_failure',
  'atomic_apply_and_rollback',
  'manual_and_historical_data_preserved',
  'directory_authority_not_login_enablement',
  'login_requires_identity_authority',
  'ui_capability_states_independent',
]);
const CANDIDATE_ACTIONS = Object.freeze([
  'open_integrations',
  'select_configured_provider',
  'inspect_connection_capability_state',
  'verify_scope_gate',
  'inspect_directory_plan',
  'verify_no_implicit_sync',
  'verify_directory_and_sso_separation',
]);

function same(value, expected) {
  return JSON.stringify(value) === JSON.stringify(expected);
}

function contractScopeBlockers(scope) {
  const errors = [];
  if (scope?.activeId !== 'WP92') errors.push('Directory cutover contract is limited to WP92');
  if (scope?.featureId !== 'F003') errors.push('Directory cutover contract requires F003');
  if (scope?.runtimeProfile !== 'application') errors.push('Directory cutover contract requires the application profile');
  if (scope?.runtimeContractVersion !== CONTRACT) errors.push('Directory cutover runtime contract mismatch');
  if (scope?.targetState !== 'code_green') errors.push('Directory cutover contract stops at code_green');
  if (scope?.productionDatabaseMode !== 'read_only') errors.push('Directory cutover contract requires read-only Production data');
  return errors;
}

function candidateEvidenceBlockers(payload, expected = {}) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return ['Directory cutover candidate evidence must be an object'];
  if (payload.contract_version !== CONTRACT) errors.push('Directory cutover candidate contract mismatch');
  if (payload.environment !== 'sandbox' && payload.environment !== 'preview') errors.push('Directory cutover candidate evidence must be isolated from Production');
  if (payload.source !== 'local_target_payload_regression') errors.push('Directory cutover candidate source is invalid');
  if (payload.result !== 'pass' || payload.exit_code !== 0 || payload.timeout !== false) errors.push('Directory cutover candidate regression did not pass');
  if (payload.read_only !== true || payload.production_requests_exercised !== false) errors.push('Directory cutover candidate cannot claim Production activity');
  if (expected.commit && payload.commit !== expected.commit) errors.push('Directory cutover candidate commit mismatch');
  if (!/^[a-f0-9]{40}$/.test(String(payload.commit || ''))) errors.push('Directory cutover candidate commit is invalid');
  if (!String(payload.test_file || '').startsWith('product-truth/product-code/')) errors.push('Directory cutover target test path is invalid');
  if (!/^[a-f0-9]{64}$/.test(String(payload.test_file_sha256 || ''))) errors.push('Directory cutover target test checksum is invalid');
  if (!payload.test_log || typeof payload.test_log !== 'object') errors.push('Directory cutover target test log is missing');
  if (payload.connection_truth_table !== 'organization_sources') errors.push('organization_sources must be the only runtime connection truth');
  if (!same(payload.assertions, ASSERTIONS)) errors.push('Directory cutover candidate assertions are incomplete or out of order');
  for (const flag of [
    'directory_synchronized',
    'primary_source_changed',
    'scope_unverified_can_apply',
    'connection_verify_implies_sso',
    'directory_authority_implies_sso',
    'provider_specific_runtime_path',
    'legacy_runtime_fallback',
  ]) {
    if (payload[flag] !== false) errors.push(`Directory cutover candidate must prove ${flag}=false`);
  }
  for (const flag of [
    'structural_completeness_verified',
    'scope_completeness_gate_verified',
    'immutable_plan_bindings_verified',
    'conflict_batch_failure_verified',
    'atomic_apply_verified',
    'atomic_rollback_verified',
    'manual_and_history_preserved',
    'independent_capability_projection_verified',
  ]) {
    if (payload[flag] !== true) errors.push(`Directory cutover candidate must prove ${flag}=true`);
  }
  return errors;
}

function runtimeEvidenceBlockers(section, environment, expected = {}) {
  if (environment === 'production') return ['Directory cutover contract stops at code_green and cannot claim Production runtime evidence'];
  const errors = [];
  for (const item of ITEMS) {
    const payload = section?.[item]?.payload;
    if (!payload) {
      errors.push(`Directory cutover runtime evidence missing: ${item}`);
      continue;
    }
    errors.push(...candidateEvidenceBlockers(payload, expected).map(error => `${item}: ${error}`));
  }
  return errors;
}

module.exports = {
  CONTRACT,
  ITEMS,
  ASSERTIONS,
  CANDIDATE_ACTIONS,
  contractScopeBlockers,
  candidateEvidenceBlockers,
  runtimeEvidenceBlockers,
};
