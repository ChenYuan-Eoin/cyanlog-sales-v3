const test = require('node:test');
const assert = require('node:assert/strict');
const verifier = require('./organization-directory-cutover-verifier');

const expected = { commit: 'a'.repeat(40) };
const proof = {
  contract_version: verifier.CONTRACT,
  environment: 'sandbox',
  source: 'local_target_payload_regression',
  commit: expected.commit,
  result: 'pass',
  exit_code: 0,
  timeout: false,
  read_only: true,
  production_requests_exercised: false,
  test_file: 'product-truth/product-code/lib/organization-connections/directory-cutover.test.ts',
  test_file_sha256: 'b'.repeat(64),
  test_log: { path: 'artifacts/organization-directory-cutover-target.log', sha256: 'c'.repeat(64) },
  connection_truth_table: 'organization_sources',
  assertions: [...verifier.ASSERTIONS],
  directory_synchronized: false,
  primary_source_changed: false,
  scope_unverified_can_apply: false,
  connection_verify_implies_sso: false,
  directory_authority_implies_sso: false,
  provider_specific_runtime_path: false,
  legacy_runtime_fallback: false,
  structural_completeness_verified: true,
  scope_completeness_gate_verified: true,
  immutable_plan_bindings_verified: true,
  conflict_batch_failure_verified: true,
  atomic_apply_verified: true,
  atomic_rollback_verified: true,
  manual_and_history_preserved: true,
  independent_capability_projection_verified: true,
};

test('accepts only the WP92 code-only directory-cutover contract', () => {
  const scope = {
    activeId: 'WP92',
    featureId: 'F003',
    runtimeProfile: 'application',
    runtimeContractVersion: verifier.CONTRACT,
    targetState: 'code_green',
    productionDatabaseMode: 'read_only',
  };
  assert.deepEqual(verifier.contractScopeBlockers(scope), []);
  assert.deepEqual(verifier.candidateEvidenceBlockers(proof, expected), []);
  assert.equal(verifier.CONTRACT, 'f003-directory-cutover-v1');
  assert.deepEqual(verifier.ITEMS, ['organization_directory_snapshot', 'organization_directory_cutover']);
});

test('rejects writes, source switches, conflated capabilities and incomplete scope proof', () => {
  for (const patch of [
    { directory_synchronized: true },
    { primary_source_changed: true },
    { scope_unverified_can_apply: true },
    { connection_verify_implies_sso: true },
    { directory_authority_implies_sso: true },
    { provider_specific_runtime_path: true },
    { legacy_runtime_fallback: true },
    { structural_completeness_verified: false },
    { scope_completeness_gate_verified: false },
    { immutable_plan_bindings_verified: false },
    { conflict_batch_failure_verified: false },
    { atomic_apply_verified: false },
    { atomic_rollback_verified: false },
    { manual_and_history_preserved: false },
    { independent_capability_projection_verified: false },
    { production_requests_exercised: true },
    { connection_truth_table: 'organization_fxiaoke_connections' },
    { assertions: verifier.ASSERTIONS.slice(0, -1) },
    { commit: 'd'.repeat(40) },
    { environment: 'production' },
  ]) {
    assert.ok(verifier.candidateEvidenceBlockers({ ...proof, ...patch }, expected).length, JSON.stringify(patch));
  }
});

test('scope cannot be reused for another work package, profile or delivery stage', () => {
  const scope = {
    activeId: 'WP92',
    featureId: 'F003',
    runtimeProfile: 'application',
    runtimeContractVersion: verifier.CONTRACT,
    targetState: 'code_green',
    productionDatabaseMode: 'read_only',
  };
  for (const patch of [
    { activeId: 'WP50' },
    { featureId: 'F054' },
    { runtimeProfile: 'shipping_workspace' },
    { runtimeContractVersion: 'f003-organization-connections-v1' },
    { targetState: 'clean_preview_green' },
    { productionDatabaseMode: 'controlled_write_approved' },
  ]) {
    assert.ok(verifier.contractScopeBlockers({ ...scope, ...patch }).length, JSON.stringify(patch));
  }
  assert.ok(verifier.runtimeEvidenceBlockers({}, 'sandbox').length);
  assert.ok(verifier.runtimeEvidenceBlockers({}, 'production').length);
});
