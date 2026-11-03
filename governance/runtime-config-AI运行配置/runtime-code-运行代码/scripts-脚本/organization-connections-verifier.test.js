const test = require('node:test');
const assert = require('node:assert/strict');
const verifier = require('./organization-connections-verifier');

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
  test_file: 'product-truth/product-code/lib/organization-connections/service.test.ts',
  test_file_sha256: 'b'.repeat(64),
  test_log: { path: 'artifacts/organization-connections-target.log', sha256: 'c'.repeat(64) },
  providers: [...verifier.PROVIDERS],
  configurable_providers: [...verifier.CONFIGURABLE_PROVIDERS],
  connection_truth_table: 'organization_sources',
  assertions: [...verifier.ASSERTIONS],
  source_activated: false,
  directory_synchronized: false,
  primary_source_changed: false,
  legacy_runtime_fallback: false,
  old_fxiaoke_table_writable: false,
  effective_configuration_preserved_on_failure: true,
  runtime_requires_verified_connection: true,
  stale_effective_state_not_claimed: true,
};

test('accepts only the WP50 code-only contract and complete shared-lifecycle proof', () => {
  const scope = {
    activeId: 'WP50',
    featureId: 'F003',
    runtimeProfile: 'application',
    runtimeContractVersion: verifier.CONTRACT,
    targetState: 'code_green',
    productionDatabaseMode: 'read_only',
  };
  assert.deepEqual(verifier.contractScopeBlockers(scope), []);
  assert.deepEqual(verifier.candidateEvidenceBlockers(proof, expected), []);
  assert.equal(verifier.CONTRACT, 'f003-organization-connections-v1');
  assert.deepEqual(verifier.ITEMS, ['organization_connection_lifecycle', 'organization_directory_preview']);
});

test('rejects activation, synchronization, source cutover and runtime dual truth', () => {
  for (const patch of [
    { source_activated: true },
    { directory_synchronized: true },
    { primary_source_changed: true },
    { legacy_runtime_fallback: true },
    { old_fxiaoke_table_writable: true },
    { effective_configuration_preserved_on_failure: false },
    { runtime_requires_verified_connection: false },
    { stale_effective_state_not_claimed: false },
    { production_requests_exercised: true },
    { connection_truth_table: 'organization_fxiaoke_connections' },
    { providers: ['feishu', 'fxiaoke'] },
    { configurable_providers: ['feishu', 'fxiaoke', 'wecom'] },
    { assertions: verifier.ASSERTIONS.slice(0, -1) },
    { commit: 'd'.repeat(40) },
    { environment: 'production' },
  ]) {
    assert.ok(verifier.candidateEvidenceBlockers({ ...proof, ...patch }, expected).length, JSON.stringify(patch));
  }
});

test('scope cannot be reused for another work package, profile or delivery stage', () => {
  const scope = {
    activeId: 'WP50',
    featureId: 'F003',
    runtimeProfile: 'application',
    runtimeContractVersion: verifier.CONTRACT,
    targetState: 'code_green',
    productionDatabaseMode: 'read_only',
  };
  for (const patch of [
    { activeId: 'WP92' },
    { featureId: 'F054' },
    { runtimeProfile: 'shipping_workspace' },
    { runtimeContractVersion: 'f003-role-permissions-v1' },
    { targetState: 'clean_preview_green' },
    { productionDatabaseMode: 'controlled_write_approved' },
  ]) {
    assert.ok(verifier.contractScopeBlockers({ ...scope, ...patch }).length, JSON.stringify(patch));
  }
  assert.ok(verifier.runtimeEvidenceBlockers({}, 'sandbox').length);
  assert.ok(verifier.runtimeEvidenceBlockers({}, 'production').length);
});
