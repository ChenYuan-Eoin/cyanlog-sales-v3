// WP50 code-only contract. This verifier describes the evidence shape for the
// shared organization connection lifecycle; it does not call providers or
// authorize activation, directory synchronization or a primary-source switch.
const CONTRACT = 'f003-organization-connections-v1';
const ITEMS = Object.freeze([
  'organization_connection_lifecycle',
  'organization_directory_preview',
]);
const PROVIDERS = Object.freeze(['feishu', 'fxiaoke', 'wecom', 'dingtalk']);
const CONFIGURABLE_PROVIDERS = Object.freeze(['feishu', 'fxiaoke']);
const ASSERTIONS = Object.freeze([
  'single_connection_truth',
  'provider_adapter_boundary',
  'encrypted_revisioned_draft_effective_state',
  'verification_failure_preserves_effective',
  'no_implicit_activation_or_sync',
  'no_primary_source_switch',
  'migration_preserves_source_and_identity',
  'legacy_inputs_require_explicit_import',
  'runtime_requires_verified_connection',
  'ui_capabilities_follow_real_state',
]);
const CANDIDATE_ACTIONS = Object.freeze([
  'open_organization_sources',
  'select_provider',
  'save_connection_draft',
  'verify_directory_preview',
  'inspect_connection_states',
  'verify_no_implicit_activation',
]);

function same(value, expected) {
  return JSON.stringify(value) === JSON.stringify(expected);
}

function contractScopeBlockers(scope) {
  const errors = [];
  if (scope?.activeId !== 'WP50') errors.push('Organization connection contract is limited to WP50');
  if (scope?.featureId !== 'F003') errors.push('Organization connection contract requires F003');
  if (scope?.runtimeProfile !== 'application') errors.push('Organization connection contract requires the application profile');
  if (scope?.runtimeContractVersion !== CONTRACT) errors.push('Organization connection runtime contract mismatch');
  if (scope?.targetState !== 'code_green') errors.push('Organization connection contract stops at code_green');
  if (scope?.productionDatabaseMode !== 'read_only') errors.push('Organization connection contract requires read-only Production data');
  return errors;
}

function candidateEvidenceBlockers(payload, expected = {}) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return ['Organization connection candidate evidence must be an object'];
  if (payload.contract_version !== CONTRACT) errors.push('Organization connection candidate contract mismatch');
  if (payload.environment !== 'sandbox' && payload.environment !== 'preview') errors.push('Organization connection candidate evidence must be isolated from Production');
  if (payload.source !== 'local_target_payload_regression') errors.push('Organization connection candidate source is invalid');
  if (payload.result !== 'pass' || payload.exit_code !== 0 || payload.timeout !== false) errors.push('Organization connection candidate regression did not pass');
  if (payload.read_only !== true || payload.production_requests_exercised !== false) errors.push('Organization connection candidate cannot claim Production activity');
  if (expected.commit && payload.commit !== expected.commit) errors.push('Organization connection candidate commit mismatch');
  if (!/^[a-f0-9]{40}$/.test(String(payload.commit || ''))) errors.push('Organization connection candidate commit is invalid');
  if (!String(payload.test_file || '').startsWith('product-truth/product-code/')) errors.push('Organization connection target test path is invalid');
  if (!/^[a-f0-9]{64}$/.test(String(payload.test_file_sha256 || ''))) errors.push('Organization connection target test checksum is invalid');
  if (!payload.test_log || typeof payload.test_log !== 'object') errors.push('Organization connection target test log is missing');
  if (!same(payload.providers, PROVIDERS)) errors.push('Organization connection provider registry is incomplete');
  if (!same(payload.configurable_providers, CONFIGURABLE_PROVIDERS)) errors.push('Organization connection configurable providers exceed the implemented adapters');
  if (payload.connection_truth_table !== 'organization_sources') errors.push('organization_sources must be the only runtime connection truth');
  if (!same(payload.assertions, ASSERTIONS)) errors.push('Organization connection candidate assertions are incomplete or out of order');
  for (const flag of [
    'source_activated',
    'directory_synchronized',
    'primary_source_changed',
    'legacy_runtime_fallback',
    'old_fxiaoke_table_writable',
  ]) {
    if (payload[flag] !== false) errors.push(`Organization connection candidate must prove ${flag}=false`);
  }
  for (const flag of [
    'effective_configuration_preserved_on_failure',
    'runtime_requires_verified_connection',
    'stale_effective_state_not_claimed',
  ]) {
    if (payload[flag] !== true) errors.push(`Organization connection candidate must prove ${flag}=true`);
  }
  return errors;
}

function runtimeEvidenceBlockers(section, environment, expected = {}) {
  if (environment === 'production') return ['Organization connection contract stops at code_green and cannot claim Production runtime evidence'];
  const errors = [];
  for (const item of ITEMS) {
    const payload = section?.[item]?.payload;
    if (!payload) {
      errors.push(`Organization connection runtime evidence missing: ${item}`);
      continue;
    }
    errors.push(...candidateEvidenceBlockers(payload, expected).map(error => `${item}: ${error}`));
  }
  return errors;
}

module.exports = {
  CONTRACT,
  ITEMS,
  PROVIDERS,
  CONFIGURABLE_PROVIDERS,
  ASSERTIONS,
  CANDIDATE_ACTIONS,
  contractScopeBlockers,
  candidateEvidenceBlockers,
  runtimeEvidenceBlockers,
};
