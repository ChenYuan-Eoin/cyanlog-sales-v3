#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const core = require('./harness-core');
const {
  DELIVERY_ATTESTATION_REF,
  REQUIRED_DEFECT_REPLAY_ACTIONS,
  APPLICATION_PERMISSION_ITEMS,
  APPLICATION_PERMISSION_PRODUCTION_ITEMS,
  APPLICATION_PERMISSION_CONTRACT,
  APPLICATION_PERMISSION_ACTIONS,
  APPLICATION_PERMISSION_PRODUCTION_ACTIONS,
  ORGANIZATION_CONNECTIONS_CONTRACT,
  ORGANIZATION_CONNECTIONS_ITEMS,
  FXIAOKE_SSO_CONTRACT,
  SHIPPING_SERVICE_SELECTION_CONTRACT,
  SHIPPING_SETTINGS_CONTRACT,
  CRM_INTAKE_CONTRACT,
  SHIPPING_COLLABORATION_ACTIONS,
  SHIPPING_CONFIG_UI_ITEMS,
  SHIPPING_CONFIG_UI_ACTIONS,
  SHIPPING_CONFIG_UI_FLAGS,
  VERCEL_PRODUCTION_CONTRACT,
  checkDeliveryStage,
  getDeliveryStatus,
  recordDeliveryEvidence,
  productionRuntimeEvidenceBlockers,
  requiredReplayActions,
  shippingWorkspaceEvidenceBlockers,
  shippingProductionVerifierScopeBlockers,
  unresolvedBlockingDefects,
  resolveVercelDeploymentCommit,
  sealDeliveryAttestation,
  transitionDeliveryState,
  validateSchedulerState
} = require('./project-registry');

const SELFTEST_PRODUCTION_DEPLOYMENT_ID = 'dpl_ProductionSelftest';
const GIT_LOCAL_ENV_NAMES = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_DIR',
  'GIT_GRAFT_FILE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_INTERNAL_SUPER_PREFIX',
  'GIT_NAMESPACE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PREFIX',
  'GIT_REPLACE_REF_BASE',
  'GIT_SHALLOW_FILE',
  'GIT_WORK_TREE'
];

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runGit(repoRoot, args) {
  // Git exports repository-local variables to hooks. A selftest that creates
  // nested repositories must not inherit those pointers: doing so can mutate
  // the caller's common .git config (for example `git init --bare` setting the
  // real repository to bare) instead of the temporary fixture.
  const env = { ...process.env };
  for (const name of GIT_LOCAL_ENV_NAMES) {
    delete env[name];
  }
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', env });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return (result.stdout || '').trim();
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function canonicalSha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function deliveryRuntimeRoot(repoRoot) {
  return runGit(repoRoot, ['rev-parse', '--path-format=absolute', '--git-path', 'codex-runtime']);
}

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeRuntimeArtifact(repoRoot, relativePath, contents) {
  const targetPath = path.join(deliveryRuntimeRoot(repoRoot), relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, contents);
  return {
    path: relativePath,
    sha256: fileSha256(targetPath)
  };
}

function evidenceEnvelope(repoRoot, name, payload, attachments = [], artifactRoot = 'artifacts') {
  const materializedAttachments = attachments.map((attachment, index) => (
    writeRuntimeArtifact(
      repoRoot,
      `${artifactRoot}/${name}-${index + 1}-${attachment.filename}`,
      attachment.contents
    )
  ));
  const materializedPayload = materializedAttachments.length
    ? { ...payload, attachments: materializedAttachments }
    : payload;
  const artifactPath = `${artifactRoot}/${name}.json`;
  const artifact = writeRuntimeArtifact(
    repoRoot,
    artifactPath,
    `${JSON.stringify(materializedPayload, null, 2)}\n`
  );
  return {
    artifact_path: artifactPath,
    sha256: artifact.sha256,
    payload: materializedPayload
  };
}

function makeBehaviorEntry(repoRoot, commit) {
  const commitTree = runGit(repoRoot, ['show', '--no-patch', '--format=%T', commit]);
  const parentCommits = runGit(repoRoot, ['show', '--no-patch', '--format=%P', commit])
    .split(' ')
    .filter(Boolean);
  const harnessScriptsRelativeDir = 'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本';
  const names = [
    'harness-selftest',
    'check-01-typecheck',
    'check-02-lint',
    'check-03-test',
    'check-04-nav',
    'check-05-git',
    'check-06-feedback-loop',
    'check-07-healthcheck',
    'check-08-error-handling',
    'check-09-business-loop',
    'check-10-ci-cd-loop'
  ];
  const checkArtifacts = names.map((name) => {
    const filename = name === 'harness-selftest' ? '00-harness-selftest.log' : `${name}.log`;
    const artifact = writeRuntimeArtifact(
      repoRoot,
      `check-logs/${commitTree}/${filename}`,
      `selftest controlled output for ${name}\n`
    );
    return {
      name,
      command: name === 'harness-selftest'
        ? ['npm', '--prefix', harnessScriptsRelativeDir, 'test']
        : ['bash', path.join(repoRoot, 'governance/ai-behavior-准则/checks', `${name}.sh`)],
      artifact_path: artifact.path,
      sha256: artifact.sha256,
      exit_code: 0,
      timeout: false
    };
  });
  return {
    timestamp: new Date().toISOString(),
    commit,
    commitTree,
    parentCommits,
    trigger: 'post-commit',
    aiBehavior: {
      checked: true,
      evidenceBinding: {
        trigger: 'pre-commit',
        timestamp: new Date().toISOString(),
        baseCommit: parentCommits[0] || 'unborn',
        indexTree: commitTree,
        trackedWorkingTreeMatchesIndex: true,
        indexTreeStable: true,
        extraInputsStable: true,
        environmentFingerprint: {
          node: process.version,
          pnpm: 'selftest',
          git: 'selftest',
          variablesPresent: [],
          extraInputSnapshotSha256: crypto.createHash('sha256').update('[]').digest('hex'),
          untrackedFileCount: 0,
          ignoredCheckInputCount: 0
        },
        controlPreflight: 'harness-selftest',
        requiredChecks: 10,
        executedChecks: 10,
        passed: 10,
        failed: 0,
        checkArtifacts
      },
      version: 'selftest'
    }
  };
}

function writeBehaviorEvidence(repoRoot, entry) {
  const artifactPath = 'behavior-log.jsonl';
  const artifact = writeRuntimeArtifact(repoRoot, artifactPath, `${JSON.stringify(entry)}\n`);
  return {
    behavior_log: {
      artifact_path: artifactPath,
      sha256: artifact.sha256,
      entry_sha256: canonicalSha256(entry)
    },
    commandArtifact: {
      artifact_path: artifactPath,
      log_sha256: artifact.sha256
    }
  };
}

function makeSettings(repoRoot) {
  writeJson(core.paths(repoRoot).settingsPath, {
    version: 'selftest',
    gates: {
      HG0: { phase: 'intake', tools: ['Read', 'Grep', 'Glob', 'AskUserQuestion'] },
      HG1: { phase: 'research', tools: ['Read', 'Grep', 'Glob', 'Bash'] },
      HG2: { phase: 'contract_review', tools: ['Read', 'Grep', 'Glob', 'AskUserQuestion'] },
      HG3: { phase: 'execute', tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'MultiEdit', 'Bash'] },
      HG4: { phase: 'verify', tools: ['Read', 'Grep', 'Glob', 'Bash'] },
      HG5: { phase: 'approval', tools: ['Read', 'Grep', 'Glob', 'AskUserQuestion'] }
    }
  });
  writeJson(core.paths(repoRoot).registryPath, {
    version: 'selftest',
    documents: [
      {
        id: 'doc-guide',
        path: 'docs-governance/guide-文档维护指南.md',
        kind: 'file',
        enabled: true,
        maintained: true
      },
      {
        id: 'design-truth',
        path: 'product-truth/03-design-truth',
        kind: 'directory',
        enabled: true,
        maintained: true
      }
    ]
  });
  writeJson(core.paths(repoRoot).documentRulesPath, {
    version: 1,
    rules: {
      documentInventory: {
        newDocumentPolicy: {
          requireRegisteredOrAllowedFamily: true,
          allowedFamilies: [
            {
              id: 'feature-packet',
              root: 'product-truth/feature-packets',
              filenamePattern: '^(F\\d{3}[A-Za-z0-9_-]*|_TEMPLATE)\\.md$'
            }
          ]
        }
      }
    }
  });
}

function runShippingContractSelftest(repoRoot) {
  const scoped = {
    activeId: 'WP18', featureId: 'F054', runtimeProfile: 'shipping_workspace', runtimeContractVersion: 'f054-v2',
    targetState: 'production_released', productionDatabaseMode: 'controlled_write_approved',
    productionReleaseAuthorization: { status: 'approved_for_final_release' }
  };
  assert.deepStrictEqual(shippingProductionVerifierScopeBlockers(scoped), []);
  const uiScoped = { ...scoped, runtimeContractVersion: 'f054-ui-v1', productionDatabaseMode: 'read_only', productionReleaseAuthorization: { status: 'approved_code_only' } };
  assert.deepStrictEqual(shippingProductionVerifierScopeBlockers(uiScoped), []);
  assert.ok(shippingProductionVerifierScopeBlockers({ ...uiScoped, productionDatabaseMode: 'controlled_write_approved' }).length);
  assert.ok(shippingProductionVerifierScopeBlockers({ ...uiScoped, runtimeContractVersion: 'f054-v2' }).length);
  for (const override of [
    { featureId: 'F001' }, { runtimeProfile: 'ai' }, { runtimeContractVersion: 'f054-v1' },
    { activeId: 'G1' }, { targetState: 'code_green' }, { productionDatabaseMode: 'read_only_pending' },
    { productionReleaseAuthorization: { status: 'pending' } }
  ]) assert.ok(shippingProductionVerifierScopeBlockers({ ...scoped, ...override }).length);

  const state = { active_task: { delivery_contract: {
    runtime_profile: 'shipping_workspace', runtime_contract_version: 'f054-v2',
    target_state: 'production_released', blocking_acceptance_defects: ['IN-20261008-001']
  } } };
  assert.deepStrictEqual(requiredReplayActions(state), SHIPPING_COLLABORATION_ACTIONS);
  assert.ok(!requiredReplayActions(state).includes('select_payment'));
  assert.ok(requiredReplayActions(state).includes('cancel_uncollected_order'));
  const production = {
    shipping_workspace: { payload: {
      contract_version: 'f054-v2', origin: 'https://sales.cyanlog.icu',
      ...Object.fromEntries(['page_accessible', 'anonymous_form_submittable', 'receipt_recoverable', 'owner_direct_available',
        'review_queue_available', 'production_submission_enabled', 'configuration_in_database', 'configuration_center',
        'credentials_masked', 'order_configuration_snapshot_verified', 'cancel_before_collection_verified'].map(k => [k, true])),
      ledger_filters: ['sales', 'customer', 'contact', 'status'], cancellation_service_code: 'EXP_RECE_UPDATE_ORDER'
    } },
    shipping_tracking: { payload: {
      success: true, waybill: 'SF1234567890123', event_count: 2, sf_environment: 'production',
      app_endpoint: 'https://sales.cyanlog.icu/api/shipping/tracking', mock: false,
      source: 'production_database', operator_observations_are_attested: true
    } },
    shipping_access: { payload: Object.fromEntries(['public_intake_allowed', 'guest_ledger_denied', 'owner_can_read',
      'relationship_assignment_controlled', 'rate_limit_enforced'].map(k => [k, true])) }
  };
  assert.deepStrictEqual(shippingWorkspaceEvidenceBlockers(production, 'production', 'f054-v2'), []);
  for (const [section, key, value] of [
    ['shipping_workspace', 'contract_version', 'f054-v1'],
    ['shipping_workspace', 'configuration_in_database', false],
    ['shipping_workspace', 'order_configuration_snapshot_verified', false],
    ['shipping_workspace', 'cancel_before_collection_verified', false],
    ['shipping_workspace', 'cancellation_service_code', 'EXP_RECE_CREATE_ORDER'],
    ['shipping_tracking', 'sf_environment', 'sandbox'], ['shipping_tracking', 'mock', true],
    ['shipping_tracking', 'source', 'production_api'], ['shipping_tracking', 'operator_observations_are_attested', false],
    ['shipping_tracking', 'app_endpoint', 'https://preview.example.invalid/api/shipping/tracking'],
    ['shipping_tracking', 'event_count', 0]
  ]) {
    const invalid = structuredClone(production); invalid[section].payload[key] = value;
    assert.ok(shippingWorkspaceEvidenceBlockers(invalid, 'production', 'f054-v2').length, `${section}.${key} must fail closed`);
  }
  const sandbox = structuredClone(production);
  sandbox.shipping_workspace.payload.origin = 'https://preview.example.invalid';
  Object.assign(sandbox.shipping_tracking.payload, {
    sf_environment: 'sandbox', app_endpoint: 'https://preview.example.invalid/api/shipping/tracking',
    source: 'sandbox_api', mock: true, events_persisted: false, order_state_unchanged: true
  });
  assert.deepStrictEqual(shippingWorkspaceEvidenceBlockers(sandbox, 'sandbox', 'f054-v2'), []);
  sandbox.shipping_tracking.payload.events_persisted = true;
  assert.ok(shippingWorkspaceEvidenceBlockers(sandbox, 'sandbox', 'f054-v2').length);

  const head = 'a'.repeat(40);
  const reproduction = evidenceEnvelope(repoRoot, 'shipping-verifier-reproduction', { candidate: head, actual: 'WP11-only rejection' });
  const replay = evidenceEnvelope(repoRoot, 'shipping-verifier-preview', { commit: head, actions: SHIPPING_COLLABORATION_ACTIONS });
  const proof = {
    verified: true, root_cause: 'The verifier used a retired work-package ID and retired authentication/data contracts.',
    reproduction, regression_artifact_sha256: replay.sha256, preview_commit: head,
    production_verified: false
  };
  const defects = { 'IN-20261008-001': proof };
  assert.deepStrictEqual(unresolvedBlockingDefects(state, defects, head, { defect_replay: replay }, {}, repoRoot, 'integration_ready'), []);
  assert.deepStrictEqual(unresolvedBlockingDefects(state, defects, head, { defect_replay: replay }, {}, repoRoot, 'production_released'), ['IN-20261008-001']);
  assert.deepStrictEqual(unresolvedBlockingDefects(state, defects, 'b'.repeat(40), { defect_replay: replay }, {}, repoRoot, 'integration_ready'), ['IN-20261008-001']);
  const acceptance = evidenceEnvelope(repoRoot, 'shipping-verifier-production', { commit: head, actions: SHIPPING_COLLABORATION_ACTIONS });
  Object.assign(proof, { production_verified: true, production_commit: head, production_regression_artifact_sha256: acceptance.sha256 });
  assert.deepStrictEqual(unresolvedBlockingDefects(state, defects, head, { defect_replay: replay }, { browser_acceptance: acceptance }, repoRoot, 'production_released'), []);
  fs.appendFileSync(path.join(deliveryRuntimeRoot(repoRoot), acceptance.artifact_path), 'tampered');
  assert.deepStrictEqual(unresolvedBlockingDefects(state, defects, head, { defect_replay: replay }, { browser_acceptance: acceptance }, repoRoot, 'production_released'), ['IN-20261008-001']);
}

function runSsoProductionFirstDefectSelftest(repoRoot) {
  runGit(repoRoot, ['init', '--quiet']);
  runGit(repoRoot, ['config', 'user.name', 'Harness Selftest']);
  runGit(repoRoot, ['config', 'user.email', 'harness-selftest@example.invalid']);
  runGit(repoRoot, ['config', 'core.hooksPath', '/dev/null']);
  makeSettings(repoRoot);
  makeSchedulerFixture(repoRoot);
  fs.writeFileSync(path.join(repoRoot, '.gitignore'), '.runtime/\n');
  fs.mkdirSync(path.join(repoRoot, 'product-truth/product-code'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'product-truth/product-code/fixture.txt'), 'fixed callback fixture\n');
  const schedulerPath = path.join(repoRoot, 'governance/runtime-state/active-task.json');
  const state = JSON.parse(fs.readFileSync(schedulerPath, 'utf8'));
  const ids = ['IN-SSO-FIRST-ONE', 'IN-SSO-FIRST-TWO'];
  Object.assign(state.active_task, { id: 'WP94', feature_id: 'F003' });
  Object.assign(state.active_task.delivery_contract, {
    runtime_profile: 'application', runtime_contract_version: FXIAOKE_SSO_CONTRACT,
    required_runtime_evidence: ['fxiaoke_sso'],
    required_production_runtime_evidence: ['fxiaoke_sso_login', 'fxiaoke_sso_denials'],
    blocking_acceptance_defects: ids, preview_order_exception_approval_id: 'IN-SSO-FIRST-APPROVAL'
  });
  state.execution_queue.active.id = 'WP94';
  writeJson(schedulerPath, state);
  runGit(repoRoot, ['add', '-A']);
  runGit(repoRoot, ['commit', '--quiet', '-m', 'SSO Production-first fixture']);
  const head = runGit(repoRoot, ['rev-parse', 'HEAD']);
  const approval = {
    id: 'IN-SSO-FIRST-APPROVAL', type: 'final_production_release_authorization', source: 'user_explicit', state: 'approved',
    code_release_authorized: true, production_database_write_authorized: false,
    carrier_calls_authorized: false, account_merge_execution_authorized: false,
    phone_history_migration_authorized: false, password_removal_authorized: false,
    preview_order_exception: true, preview_status: 'not_passed', approved_candidate: head,
    approved_product_tree: runGit(repoRoot, ['rev-parse', 'HEAD:product-truth/product-code']), rollback_commit: head,
    authorized_migrations: [{ path: 'supabase/migrations/fixture.sql', sha256: 'e'.repeat(64) }]
  };
  const inboxPath = path.join(repoRoot, 'governance/runtime-state/demand-inbox.jsonl');
  fs.appendFileSync(inboxPath, JSON.stringify(approval) + '\n');
  const actions = requiredReplayActions(state, 'production');
  const acceptance = evidenceEnvelope(repoRoot, 'sso-first-production', { commit: head, actions });
  const proof = {
    verified: true, root_cause: 'The fixed OAuth callback cannot replay the Provider authorization on a Preview hostname.',
    reproduction: evidenceEnvelope(repoRoot, 'sso-first-reproduction', { commit: head, actual: 'Provider callback failed' }),
    production_verified: true, production_commit: head, production_regression_artifact_sha256: acceptance.sha256
  };
  const defects = Object.fromEntries(ids.map(id => [id, structuredClone(proof)]));
  const approved = { approved: true, approval_id: approval.id, preview_status: 'not_passed' };
  const unresolved = (overrides = {}) => unresolvedBlockingDefects(
    overrides.state || state, overrides.defects || defects, overrides.head || head,
    {}, { browser_acceptance: overrides.acceptance || acceptance }, repoRoot,
    overrides.stage || 'production_released', overrides.exception || approved
  );
  assert.deepStrictEqual(unresolved(), [], 'Both exact Production replays can close defects without claiming Preview');
  assert.deepStrictEqual(unresolved({ stage: 'integration_ready' }), ids, 'Preview defects stay unresolved during integration');
  assert.deepStrictEqual(unresolved({ exception: { approved: false } }), ids);
  assert.deepStrictEqual(unresolved({ exception: { preview_status: 'not_passed' } }), ids);
  for (const patch of [
    { id: 'WP82' }, { feature_id: 'F054' },
    { delivery_contract: { ...state.active_task.delivery_contract, runtime_profile: 'ai' } },
    { delivery_contract: { ...state.active_task.delivery_contract, runtime_contract_version: 'other' } }
  ]) assert.deepStrictEqual(unresolved({ state: { ...state, active_task: { ...state.active_task, ...patch } } }), ids);
  assert.deepStrictEqual(unresolved({ defects: { [ids[0]]: proof } }), [ids[1]], 'Every configured defect needs its own proof');
  for (const patch of [
    { verified: false }, { root_cause: 'too short' }, { reproduction: null },
    { production_verified: false }, { production_commit: 'b'.repeat(40) },
    { production_regression_artifact_sha256: '0'.repeat(64) }
  ]) {
    const invalid = Object.fromEntries(ids.map(id => [id, { ...proof, ...patch }]));
    assert.deepStrictEqual(unresolved({ defects: invalid }), ids);
  }
  for (const payload of [{ commit: 'b'.repeat(40), actions }, { commit: head, actions: actions.slice(1) }]) {
    const invalidAcceptance = evidenceEnvelope(repoRoot, `sso-first-invalid-${payload.commit === head ? 'actions' : 'commit'}`, payload);
    const invalid = Object.fromEntries(ids.map(id => [id, { ...proof, production_regression_artifact_sha256: invalidAcceptance.sha256 }]));
    assert.deepStrictEqual(unresolved({ defects: invalid, acceptance: invalidAcceptance }), ids);
  }
  const missingAcceptance = { artifact_path: 'missing.json', sha256: 'f'.repeat(64), payload: acceptance.payload };
  assert.deepStrictEqual(unresolved({ acceptance: missingAcceptance }), ids);

  // Exercise the real status assembly: no Preview journey must not discard
  // valid Production defects, and must never turn Preview green.
  writeJson(path.join(deliveryRuntimeRoot(repoRoot), 'delivery-evidence.json'), {
    version: 1, activeId: 'WP94', commit: head, completionState: 'main_integrated', defects,
    evidence: { code: { commit: head }, production: { browser_acceptance: acceptance } }
  });
  const options = { repoRoot, remoteSnapshot: { main: head, production: head, defaultBranch: 'main', attestation: null } };
  const status = getDeliveryStatus(options);
  assert.strictEqual(status.previewOrderException.approved, true);
  assert.deepStrictEqual(status.previewBlockingDefects, ids);
  assert.deepStrictEqual(status.blockingDefects, []);
  const gateOptions = { ...options, status, skipStateCheck: true, skipSealCheck: true, testOnlyVercelApiResponses: makeTestVercelApiResponses(head) };
  for (const stage of ['integration_ready', 'main_integrated']) {
    assert.ok(!checkDeliveryStage(stage, gateOptions).blockers.some(item => item.startsWith('blocking defects unresolved in Preview:')));
  }
  assert.ok(checkDeliveryStage('clean_preview_green', gateOptions).blockers.some(item => item.includes('preserves Preview as not passed')));
  for (const patch of [{ activeId: 'WP82' }, { featureId: 'F054' }, { runtimeProfile: 'ai' }, { previewOrderException: { approved: false } }]) {
    const result = checkDeliveryStage('integration_ready', { ...gateOptions, status: { ...status, ...patch } });
    assert.ok(result.blockers.some(item => item.startsWith('blocking defects unresolved in Preview:')));
  }
  const terminal = checkDeliveryStage('production_released', { ...gateOptions, status: { ...status, blockingDefects: ids } });
  assert.ok(terminal.blockers.some(item => item.startsWith('blocking defects unresolved:')));
  fs.writeFileSync(inboxPath, JSON.stringify({ ...approval, state: 'pending' }) + '\n');
  const unapprovedStatus = getDeliveryStatus(options);
  assert.strictEqual(unapprovedStatus.previewOrderException.approved, false);
  assert.deepStrictEqual(unapprovedStatus.blockingDefects, ids);
  fs.appendFileSync(path.join(deliveryRuntimeRoot(repoRoot), acceptance.artifact_path), 'tampered');
  assert.deepStrictEqual(unresolved(), ids);
  console.log('SSO Production-first defect proof selftest ok');
}

function runServiceSelectionProductionFirstSelftest(repoRoot) {
  const verifier = require('./shipping-service-selection-verifier');
  runGit(repoRoot, ['init', '--quiet']);
  runGit(repoRoot, ['config', 'user.name', 'Harness Selftest']);
  runGit(repoRoot, ['config', 'user.email', 'harness-selftest@example.invalid']);
  runGit(repoRoot, ['config', 'core.hooksPath', '/dev/null']);
  makeSettings(repoRoot);
  makeSchedulerFixture(repoRoot);
  fs.writeFileSync(path.join(repoRoot, '.gitignore'), '.runtime/\n');
  fs.mkdirSync(path.join(repoRoot, 'product-truth/product-code'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'product-truth/product-code/fixture.txt'), 'approved shipping product fixture\n');
  const schedulerPath = path.join(repoRoot, 'governance/runtime-state/active-task.json');
  const state = JSON.parse(fs.readFileSync(schedulerPath, 'utf8'));
  const defectId = 'IN-20261102-032', approvalId = 'IN-SERVICE-FIRST-APPROVAL';
  Object.assign(state.active_task, { id: 'WP52', feature_id: 'F054' });
  state.execution_queue.active.id = 'WP52';
  Object.assign(state.active_task.delivery_contract, {
    runtime_profile: 'shipping_workspace', runtime_contract_version: verifier.CONTRACT,
    required_runtime_evidence: [...verifier.ITEMS], required_production_runtime_evidence: [...verifier.ITEMS],
    production_database_mode: 'read_only', blocking_acceptance_defects: [defectId], preview_order_exception_approval_id: approvalId,
    production_release_authorization: { status: 'approved_code_only', micro_fix_approval_id: 'IN-SELFTEST-MICROFIX-APPROVAL',
      clarification_id: 'IN-SELFTEST-CLARIFICATION', final_release_approval_id: approvalId, micro_fix_scope: 'per_order_service_selection',
      final_scope: 'selftest approved shipping UI Production-first release', database_write_authorized: false,
      production_database_write_authorized: false, carrier_calls_authorized: false },
    final_acceptance: { browser: 'trusted_operator_attestation_from_user_existing_chrome_only', production_database_mode: 'read_only' }
  });
  writeJson(schedulerPath, state);
  core.startGoal(repoRoot, 'Verify the approved service selection Production-first exception', { level: 'A1', workPackageId: 'WP52', scopes: 'app', success: 'exact code-only release accepted' });
  core.approveContract(repoRoot, { level: 'A1', by: 'selftest' }); core.setPhase(repoRoot, 'verify');
  runGit(repoRoot, ['add', '-A']); runGit(repoRoot, ['commit', '--quiet', '-m', 'Approved selection candidate fixture']);
  const candidate = runGit(repoRoot, ['rev-parse', 'HEAD']);
  const productTree = runGit(repoRoot, ['rev-parse', 'HEAD:product-truth/product-code']);
  const approval = { id: approvalId, type: 'final_production_release_authorization', source: 'user_explicit', state: 'approved',
    scope: state.active_task.delivery_contract.production_release_authorization.final_scope,
    code_release_authorized: true, production_database_write_authorized: false, carrier_calls_authorized: false,
    preview_order_exception: true, preview_status: 'not_passed', approved_candidate: candidate, approved_product_tree: productTree,
    rollback_commit: candidate, authorized_commit_binding: 'delivery_attestation_current_head' };
  const inboxPath = path.join(repoRoot, 'governance/runtime-state/demand-inbox.jsonl');
  fs.appendFileSync(inboxPath, JSON.stringify(approval) + '\n');
  runGit(repoRoot, ['add', '-A']); runGit(repoRoot, ['commit', '--quiet', '-m', 'Selection release authority fixture']);
  const head = runGit(repoRoot, ['rev-parse', 'HEAD']);
  runGit(repoRoot, ['update-ref', 'refs/remotes/origin/main', candidate]);
  const options = { repoRoot, remoteSnapshot: { main: candidate, production: candidate, defaultBranch: 'main', attestation: null },
    testOnlyVercelApiResponses: makeTestVercelApiResponses(candidate) };
  const behavior = writeBehaviorEvidence(repoRoot, makeBehaviorEntry(repoRoot, head));
  const checks = state.active_task.delivery_contract.required_code_checks;
  recordDeliveryEvidence('code', { commit: head, checks: Object.fromEntries(checks.map(name => [name, true])), behavior_log: behavior.behavior_log,
    commands: checks.map(name => ({ name, exit_code: 0, ...behavior.commandArtifact })) }, options);
  const proof = { verified: true, root_cause: 'A shared service selector made the visible product and each ticket confirmation payload disagree.',
    reproduction: evidenceEnvelope(repoRoot, 'selection-first-reproduction', { commit: candidate, actual: 'A changed B service' }) };
  recordDeliveryEvidence(`defect.${defectId}`, proof, options);
  recordDeliveryEvidence('release_control', { production_branch: 'production', vercel_project_id: VERCEL_PRODUCTION_CONTRACT.projectId,
    production_commit_before: candidate, production_deployment_id_before: SELFTEST_PRODUCTION_DEPLOYMENT_ID,
    production_branch_evidence: evidenceEnvelope(repoRoot, 'selection-first-branch', { branch: 'production', project_id: VERCEL_PRODUCTION_CONTRACT.projectId, observed_at: new Date().toISOString() }) }, options);
  assert.strictEqual(transitionDeliveryState('code_green', options).ok, true);
  const codeStatus = getDeliveryStatus(options);
  assert.deepStrictEqual(codeStatus.previewOrderException, { approved: true, approval_id: approvalId, preview_status: 'not_passed', blockers: [] });
  assert.deepStrictEqual(codeStatus.previewBlockingDefects, [defectId]);
  assert.deepStrictEqual(codeStatus.blockingDefects, [defectId]);
  const integration = transitionDeliveryState('integration_ready', options);
  assert.deepStrictEqual(integration.blockers || [], [], 'The approved narrow exception must permit the real code_green to integration_ready transition');
  assert.strictEqual(integration.ok, true);
  const status = getDeliveryStatus(options);
  assert.strictEqual(status.completionState, 'integration_ready');
  assert.strictEqual(status.evidence.preview, undefined, 'No Preview result may be manufactured by the exception');
  assert.deepStrictEqual(status.previewBlockingDefects, [defectId]);
  assert.deepStrictEqual(status.blockingDefects, [defectId]);
  const gateOptions = { ...options, status, skipStateCheck: true, skipSealCheck: true };
  assert.ok(checkDeliveryStage('clean_preview_green', gateOptions).blockers.some(message => message.includes('preserves Preview as not passed')));
  for (const patch of [
    { activeId: 'WP53' }, { featureId: 'F003' }, { runtimeProfile: 'application' },
    { runtimeContractVersion: 'f054-ui-v1' }, { previewOrderException: { approved: false } }
  ]) assert.ok(checkDeliveryStage('integration_ready', { ...gateOptions, status: { ...status, ...patch } }).blockers.some(message => message.startsWith('blocking defects unresolved in Preview:')));
  const terminal = checkDeliveryStage('production_released', gateOptions);
  assert.strictEqual(terminal.ok, false);
  assert.ok(terminal.blockers.some(message => message.startsWith('blocking defects unresolved:')));
  assert.ok(terminal.blockers.some(message => message.includes('controlled evidence missing or invalid')));
  const acceptance = evidenceEnvelope(repoRoot, 'selection-first-operator', { commit: head, actions: [...verifier.ACTIONS] });
  const verifiedProof = { ...proof, production_verified: true, production_commit: head, production_regression_artifact_sha256: acceptance.sha256 };
  const unresolved = (overrides = {}) => unresolvedBlockingDefects(state, { [defectId]: { ...verifiedProof, ...overrides.proof } }, overrides.head || head,
    {}, { browser_acceptance: overrides.acceptance || acceptance }, repoRoot, 'production_released', overrides.exception || status.previewOrderException);
  assert.deepStrictEqual(unresolved(), []);
  for (const invalid of [
    { proof: { verified: false } }, { proof: { reproduction: null } }, { proof: { root_cause: 'short' } },
    { proof: { production_verified: false } }, { proof: { production_commit: candidate } },
    { proof: { production_regression_artifact_sha256: '0'.repeat(64) } }, { exception: { approved: false } }
  ]) assert.deepStrictEqual(unresolved(invalid), [defectId]);
  for (const payload of [{ commit: candidate, actions: [...verifier.ACTIONS] }, { commit: head, actions: verifier.ACTIONS.slice(1) }]) {
    const invalid = evidenceEnvelope(repoRoot, `selection-first-invalid-${payload.commit === head ? 'actions' : 'sha'}`, payload);
    assert.deepStrictEqual(unresolved({ acceptance: invalid, proof: { production_regression_artifact_sha256: invalid.sha256 } }), [defectId]);
  }
  const spoofedTerminal = structuredClone(status);
  spoofedTerminal.blockingDefects = [];
  spoofedTerminal.evidence.production = { browser_acceptance: acceptance };
  assert.strictEqual(checkDeliveryStage('production_released', { ...gateOptions, status: spoofedTerminal }).ok, false, 'A linked defect declaration cannot replace the real Production operator/runtime/payload proof');
  const scope = { approval, activeId: 'WP52', featureId: 'F054', runtimeProfile: 'shipping_workspace', contractVersion: verifier.CONTRACT,
    productTree, changedPaths: ['governance/runtime-state/demand-inbox.jsonl'], candidateIsAncestor: true };
  assert.deepStrictEqual(verifier.productionFirstExceptionBlockers(scope), []);
  for (const patch of [
    { approval: { ...approval, state: 'pending' } }, { activeId: 'WP53' }, { featureId: 'F003' },
    { runtimeProfile: 'application' }, { contractVersion: 'f054-ui-v1' }, { productTree: 'f'.repeat(40) },
    { candidateIsAncestor: false }, { changedPaths: ['product-truth/product-code/supabase/migrations/mixed.sql'] }
  ]) assert.ok(verifier.productionFirstExceptionBlockers({ ...scope, ...patch }).length);
  const originalInbox = fs.readFileSync(inboxPath, 'utf8');
  fs.writeFileSync(inboxPath, originalInbox.replace(JSON.stringify(approval), JSON.stringify({ ...approval, preview_order_exception: false })));
  assert.strictEqual(getDeliveryStatus(options).previewOrderException.approved, false);
  fs.writeFileSync(inboxPath, originalInbox);
  const changedState = structuredClone(state); changedState.active_task.feature_id = 'F003'; writeJson(schedulerPath, changedState);
  assert.strictEqual(getDeliveryStatus(options).previewOrderException.approved, false, 'Real dispatch must pass the feature binding into the verifier');
  writeJson(schedulerPath, state);
  fs.appendFileSync(path.join(repoRoot, 'product-truth/product-code/fixture.txt'), 'unapproved product change\n');
  runGit(repoRoot, ['add', '-A']); runGit(repoRoot, ['commit', '--quiet', '-m', 'Unapproved product mutation fixture']);
  assert.strictEqual(getDeliveryStatus(options).previewOrderException.approved, false);
  console.log('service selection Production-first transition and final-proof boundary selftest ok');
}

function makeSchedulerFixture(repoRoot) {
  writeJson(path.join(repoRoot, 'governance/runtime-state/active-task.json'), {
    product_baseline: { status: 'active' },
    active_task: {
      id: 'WP99',
      kind: 'product',
      status: 'active',
      started_at: '2000-01-01T00:00:00.000Z',
      allowed_paths: ['governance/runtime-config-AI运行配置'],
      delivery_contract: {
        target_state: 'production_released',
        allowed_states: [
          'executing',
          'code_green',
          'clean_preview_green',
          'integration_ready',
          'main_integrated',
          'production_released'
        ],
        integration_branch: 'main',
        production_branch: 'production',
        production_release_separate: true,
        attestation_ref: DELIVERY_ATTESTATION_REF,
        same_release_commit_required: true,
        required_code_checks: ['target_tests', 'full_tests', 'lint', 'typecheck', 'build'],
        required_runtime_evidence: ['provider_probe', 'review_run', 'model_invocations', 'tokens'],
        required_production_runtime_evidence: ['provider_probe', 'review_run', 'model_invocations', 'tokens'],
        production_release_authorization: {
          status: 'approved_for_final_release',
          micro_fix_approval_id: 'IN-SELFTEST-MICROFIX-APPROVAL',
          clarification_id: 'IN-SELFTEST-CLARIFICATION',
          final_release_approval_id: 'IN-SELFTEST-FINAL-APPROVAL',
          micro_fix_scope: 'vetted_code_only_application_candidate',
          final_scope: 'selftest controlled Production runtime and release'
        },
        final_acceptance: {
          browser: 'trusted_operator_attestation_from_user_existing_chrome_only',
          production_database_mode: 'controlled_write_approved'
        },
        blocking_acceptance_defects: []
      }
    },
    execution_queue: {
      active: { id: 'WP99' },
      next: null,
      ready: [],
      parked: [],
      completed: []
    }
  });
  const inboxPath = path.join(repoRoot, 'governance/runtime-state/demand-inbox.jsonl');
  fs.mkdirSync(path.dirname(inboxPath), { recursive: true });
  fs.writeFileSync(inboxPath, [
    JSON.stringify({ id: 'IN-SELFTEST-MICROFIX-APPROVAL', type: 'release_authorization' }),
    JSON.stringify({
      id: 'IN-SELFTEST-FINAL-APPROVAL',
      type: 'final_production_release_authorization',
      state: 'approved',
      source: 'user_explicit',
      scope: 'selftest controlled Production runtime and release',
      production_write_authorized: true,
      authorized_commit_binding: 'delivery_attestation_current_head'
    }),
    JSON.stringify({ id: 'IN-SELFTEST-CLARIFICATION', type: 'release_clarification' })
  ].join('\n') + '\n');
}

function runApplicationPermissionSelftest(repoRoot) {
  runGit(repoRoot, ['init', '--quiet']);
  runGit(repoRoot, ['config', 'user.name', 'Harness Selftest']);
  runGit(repoRoot, ['config', 'user.email', 'harness-selftest@example.invalid']);
  makeSettings(repoRoot);
  makeSchedulerFixture(repoRoot);
  const schedulerPath = path.join(repoRoot, 'governance/runtime-state/active-task.json');
  const scheduler = JSON.parse(fs.readFileSync(schedulerPath, 'utf8'));
  scheduler.active_task.feature_id = 'F003';
  scheduler.active_task.delivery_contract = {
    target_state: 'code_green', allowed_states: ['executing', 'code_green'],
    integration_branch: 'main', production_branch: 'production', production_release_separate: true,
    same_release_commit_required: true, attestation_ref: DELIVERY_ATTESTATION_REF,
    required_code_checks: ['target_tests', 'full_tests', 'lint', 'typecheck', 'build'],
    required_runtime_evidence: [...APPLICATION_PERMISSION_ITEMS], runtime_profile: 'application',
    production_database_mode: 'read_only'
  };
  writeJson(schedulerPath, scheduler);
  // WP51 cannot borrow connection, cutover or permission evidence, expand writes,
  // or claim a later delivery phase from its local candidate contract.
  const directoryScope = structuredClone(scheduler);
  directoryScope.active_task.id = 'WP51';
  directoryScope.execution_queue.active.id = 'WP51';
  Object.assign(directoryScope.active_task.delivery_contract, {
    runtime_contract_version: 'f003-directory-scope-v1',
    required_runtime_evidence: ['organization_directory_snapshot', 'organization_directory_scope']
  });
  core.startGoal(repoRoot, 'Verify read-only directory scope', { level: 'A1', workPackageId: 'WP51', scopes: 'app', success: 'scope candidate code verified' });
  core.approveContract(repoRoot, { level: 'A1', by: 'selftest' });
  core.setPhase(repoRoot, 'verify');
  writeJson(schedulerPath, directoryScope);
  assert.deepStrictEqual(validateSchedulerState({ repoRoot }).errors, []);
  for (const change of [
    value => { value.active_task.id = 'WP92'; value.execution_queue.active.id = 'WP92'; },
    value => { value.active_task.feature_id = 'F054'; },
    value => { value.active_task.delivery_contract.target_state = 'clean_preview_green'; value.active_task.delivery_contract.allowed_states.push('clean_preview_green'); },
    value => { value.active_task.delivery_contract.production_database_mode = 'controlled_write_approved'; },
    value => { value.active_task.delivery_contract.required_runtime_evidence = [...ORGANIZATION_CONNECTIONS_ITEMS]; },
    value => { value.active_task.delivery_contract.required_runtime_evidence.push('manual_scope_approval'); },
    value => { value.active_task.delivery_contract.allowed_states.push('clean_preview_green'); },
  ]) {
    const invalid = structuredClone(directoryScope); change(invalid); writeJson(schedulerPath, invalid);
    assert.strictEqual(validateSchedulerState({ repoRoot }).ok, false);
  }
  writeJson(schedulerPath, scheduler);
  core.startGoal(repoRoot, 'Verify organization role permissions', { level: 'A1', workPackageId: 'WP99', scopes: 'app', success: 'permission code verified' });
  core.approveContract(repoRoot, { level: 'A1', by: 'selftest' });
  core.setPhase(repoRoot, 'verify');
  assert.deepStrictEqual(validateSchedulerState({ repoRoot }).errors, []);

  for (const change of [
    state => { state.active_task.delivery_contract.runtime_profile = 'unknown'; },
    state => { state.active_task.feature_id = 'F054'; },
    state => { state.active_task.delivery_contract.production_database_mode = 'controlled_write_approved'; },
    state => { state.active_task.delivery_contract.required_runtime_evidence = ['role_edit_save']; },
    state => { state.active_task.delivery_contract.target_state = 'clean_preview_green'; state.active_task.delivery_contract.allowed_states.push('clean_preview_green'); },
    state => { state.active_task.delivery_contract.runtime_profile = 'ai'; },
    state => { state.active_task.delivery_contract.runtime_profile = 'shipping'; state.active_task.feature_id = 'F054'; },
    state => { state.active_task.delivery_contract.runtime_profile = 'shipping_workspace'; state.active_task.feature_id = 'F054'; },
    state => { state.active_task.delivery_contract.required_code_checks = ['target_tests']; }
  ]) {
    const invalid = structuredClone(scheduler); change(invalid); writeJson(schedulerPath, invalid);
    assert.strictEqual(validateSchedulerState({ repoRoot }).ok, false);
  }
  // WP50 has a dedicated code-only contract; role-permission evidence and any
  // activation/sync action namespace cannot satisfy the connection lifecycle.
  const organizationConnections = structuredClone(scheduler);
  organizationConnections.active_task.id = 'WP50';
  organizationConnections.execution_queue.active.id = 'WP50';
  organizationConnections.active_task.feature_id = 'F003';
  Object.assign(organizationConnections.active_task.delivery_contract, {
    target_state: 'code_green',
    allowed_states: ['executing', 'code_green'],
    runtime_profile: 'application',
    runtime_contract_version: ORGANIZATION_CONNECTIONS_CONTRACT,
    required_runtime_evidence: [...ORGANIZATION_CONNECTIONS_ITEMS],
    production_database_mode: 'read_only'
  });
  core.startGoal(repoRoot, 'Verify unified organization connection configuration', { level: 'A1', workPackageId: 'WP50', scopes: 'app', success: 'connection lifecycle code verified' });
  core.approveContract(repoRoot, { level: 'A1', by: 'selftest' });
  core.setPhase(repoRoot, 'verify');
  writeJson(schedulerPath, organizationConnections);
  assert.deepStrictEqual(validateSchedulerState({ repoRoot }).errors, []);
  assert.deepStrictEqual(requiredReplayActions(organizationConnections), require('./organization-connections-verifier').CANDIDATE_ACTIONS);
  for (const change of [
    value => { value.active_task.id = 'WP92'; value.execution_queue.active.id = 'WP92'; },
    value => { value.active_task.feature_id = 'F054'; },
    value => { value.active_task.delivery_contract.target_state = 'clean_preview_green'; value.active_task.delivery_contract.allowed_states.push('clean_preview_green'); },
    value => { value.active_task.delivery_contract.production_database_mode = 'controlled_write_approved'; },
    value => { value.active_task.delivery_contract.runtime_contract_version = APPLICATION_PERMISSION_CONTRACT; },
    value => { value.active_task.delivery_contract.required_runtime_evidence = [...APPLICATION_PERMISSION_ITEMS]; },
    value => { value.active_task.delivery_contract.required_runtime_evidence.push('extra_item'); },
  ]) {
    const invalid = structuredClone(organizationConnections); change(invalid); writeJson(schedulerPath, invalid);
    assert.strictEqual(validateSchedulerState({ repoRoot }).ok, false);
  }
  core.startGoal(repoRoot, 'Verify organization role permissions', { level: 'A1', workPackageId: 'WP99', scopes: 'app', success: 'permission code verified' });
  core.approveContract(repoRoot, { level: 'A1', by: 'selftest' });
  core.setPhase(repoRoot, 'verify');
  writeJson(schedulerPath, scheduler);
  // WP91 has its own connection journey; role-permission evidence cannot satisfy it.
  const fx = structuredClone(scheduler);
  fx.active_task.delivery_contract.target_state = 'clean_preview_green';
  fx.active_task.delivery_contract.allowed_states = ['executing', 'code_green', 'clean_preview_green'];
  fx.active_task.delivery_contract.runtime_contract_version = 'f003-fxiaoke-connection-v1';
  fx.active_task.delivery_contract.required_runtime_evidence = ['fxiaoke_connection'];
  writeJson(schedulerPath, fx);
  assert.deepStrictEqual(validateSchedulerState({ repoRoot }).errors, []);
  assert.deepStrictEqual(requiredReplayActions(fx), require('./fxiaoke-connection-verifier').PREVIEW_ACTIONS);
  assert.deepStrictEqual(requiredReplayActions(fx, 'production'), require('./fxiaoke-connection-verifier').PRODUCTION_ACTIONS);
  const wrongFx = structuredClone(fx);
  wrongFx.active_task.delivery_contract.required_runtime_evidence = ['role_edit_save', 'role_access_enforcement'];
  writeJson(schedulerPath, wrongFx);
  assert.strictEqual(validateSchedulerState({ repoRoot }).ok, false);
  // Saving the Fxiaoke connection is a controlled write, unlike the read-only
  // permission-page release. The grant remains scoped to the connection table.
  const fxProduction = structuredClone(fx);
  const connectionScope = {
    production_write_scope: ['organization_fxiaoke_connections'],
    production_migrations_authorized: false,
    organization_sync_authorized: false,
    sales_permissions_authorized: false
  };
  Object.assign(fxProduction.active_task.delivery_contract, {
    target_state: 'production_released',
    allowed_states: ['executing', 'code_green', 'clean_preview_green', 'integration_ready', 'main_integrated', 'production_released'],
    production_database_mode: 'controlled_write_approved',
    required_production_runtime_evidence: ['connection_preview', 'verifier'],
    production_release_authorization: {
      status: 'approved_for_final_release', micro_fix_approval_id: 'IN-SELFTEST-MICROFIX-APPROVAL',
      clarification_id: 'IN-SELFTEST-CLARIFICATION', final_release_approval_id: 'IN-SELFTEST-FINAL-APPROVAL',
      micro_fix_scope: 'F003 connection only', final_scope: 'selftest controlled Production runtime and release',
      database_write_authorized: true, ...connectionScope
    },
    final_acceptance: {
      browser: 'trusted_operator_attestation_from_user_existing_chrome_only',
      production_database_mode: 'controlled_write_approved'
    }
  });
  const fxInboxPath = path.join(repoRoot, 'governance/runtime-state/demand-inbox.jsonl');
  const originalFxInbox = fs.readFileSync(fxInboxPath, 'utf8');
  const fxInbox = originalFxInbox.trim().split('\n').map(line => JSON.parse(line));
  const finalFxApproval = fxInbox.find(item => item.id === 'IN-SELFTEST-FINAL-APPROVAL');
  Object.assign(finalFxApproval, connectionScope);
  fs.writeFileSync(fxInboxPath, fxInbox.map(item => JSON.stringify(item)).join('\n') + '\n');
  writeJson(schedulerPath, fxProduction);
  assert.deepStrictEqual(validateSchedulerState({ repoRoot }).errors, [], 'Fxiaoke connection save must support an explicitly scoped write approval');
  for (const mutate of [
    value => { value.active_task.delivery_contract.production_release_authorization.status = 'approved_code_only'; },
    value => { value.active_task.delivery_contract.production_release_authorization.database_write_authorized = false; },
    value => { value.active_task.delivery_contract.production_release_authorization.production_write_scope.push('users'); },
    value => { value.active_task.delivery_contract.production_release_authorization.production_migrations_authorized = true; },
    value => { value.active_task.delivery_contract.production_release_authorization.organization_sync_authorized = true; },
    value => { value.active_task.delivery_contract.production_release_authorization.sales_permissions_authorized = true; },
    value => { value.active_task.delivery_contract.production_database_mode = 'read_only'; },
    value => { value.active_task.delivery_contract.final_acceptance.production_database_mode = 'read_only'; },
    value => { value.active_task.delivery_contract.required_production_runtime_evidence = ['role_edit_save', 'role_access_enforcement']; }
  ]) {
    const invalid = structuredClone(fxProduction); mutate(invalid); writeJson(schedulerPath, invalid);
    assert.strictEqual(validateSchedulerState({ repoRoot }).ok, false, 'Fxiaoke writes must not expand or masquerade as read-only');
  }
  writeJson(schedulerPath, fxProduction);
  delete finalFxApproval.production_write_scope;
  fs.writeFileSync(fxInboxPath, fxInbox.map(item => JSON.stringify(item)).join('\n') + '\n');
  assert.strictEqual(validateSchedulerState({ repoRoot }).ok, false, 'The user approval must include the same write boundary');
  fs.writeFileSync(fxInboxPath, originalFxInbox);
  // The new profile must not change the existing AI default or evidence gates.
  const ai = structuredClone(scheduler);
  delete ai.active_task.delivery_contract.runtime_profile;
  ai.active_task.delivery_contract.required_runtime_evidence = ['provider_probe', 'review_run', 'model_invocations', 'tokens'];
  writeJson(schedulerPath, ai);
  assert.deepStrictEqual(validateSchedulerState({ repoRoot }).errors, []);
  writeJson(schedulerPath, scheduler);

  fs.writeFileSync(path.join(repoRoot, '.gitignore'), '.runtime/\n');
  runGit(repoRoot, ['add', '.']); runGit(repoRoot, ['commit', '--quiet', '-m', 'Application permission fixture']);
  const head = runGit(repoRoot, ['rev-parse', 'HEAD']);
  const options = { repoRoot, remoteSnapshot: {} };
  const behavior = writeBehaviorEvidence(repoRoot, makeBehaviorEntry(repoRoot, head));
  const checks = scheduler.active_task.delivery_contract.required_code_checks;
  recordDeliveryEvidence('code', {
    commit: head, checks: Object.fromEntries(checks.map(name => [name, true])),
    behavior_log: behavior.behavior_log,
    commands: checks.filter(name => name !== 'build').map(name => ({ name, exit_code: 0, ...behavior.commandArtifact }))
  }, options);
  assert.strictEqual(transitionDeliveryState('code_green', options).ok, false, 'Application still requires build command evidence');
  recordDeliveryEvidence('code', {
    commands: checks.map(name => ({ name, exit_code: 0, ...behavior.commandArtifact }))
  }, options);
  assert.strictEqual(transitionDeliveryState('code_green', options).ok, true);
  assert.strictEqual(checkDeliveryStage('code_green', options).ok, true);
  assert.strictEqual(transitionDeliveryState('clean_preview_green', options).ok, false, 'Code-only application profile cannot authorize Preview');
  assert.strictEqual(checkDeliveryStage('production_released', options).ok, false, 'Code-only application profile cannot authorize Production');
  runApplicationPermissionReleaseSelftest(repoRoot, scheduler, options);
  console.log('application permission profile selftest ok');
}

function runApplicationPermissionReleaseSelftest(repoRoot, scheduler, options) {
  const verifier = require('./application-permissions-verifier');
  const schedulerPath = path.join(repoRoot, 'governance/runtime-state/active-task.json');
  const release = structuredClone(scheduler);
  Object.assign(release.active_task.delivery_contract, {
    runtime_contract_version: APPLICATION_PERMISSION_CONTRACT,
    target_state: 'production_released',
    allowed_states: ['executing', 'code_green', 'clean_preview_green', 'integration_ready', 'main_integrated', 'production_released'],
    required_production_runtime_evidence: [...APPLICATION_PERMISSION_PRODUCTION_ITEMS],
    production_release_authorization: {
      status: 'approved_code_only', micro_fix_approval_id: 'IN-SELFTEST-MICROFIX-APPROVAL', clarification_id: 'IN-SELFTEST-CLARIFICATION',
      final_release_approval_id: 'IN-SELFTEST-FINAL-APPROVAL', micro_fix_scope: 'F003 permissions',
      final_scope: 'selftest controlled Production runtime and release', database_write_authorized: false
    },
    final_acceptance: { browser: 'trusted_operator_attestation_from_user_existing_chrome_only', production_database_mode: 'read_only' }
  });
  const inboxPath = path.join(repoRoot, 'governance/runtime-state/demand-inbox.jsonl');
  const inbox = fs.readFileSync(inboxPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  Object.assign(inbox.find(row => row.id === 'IN-SELFTEST-FINAL-APPROVAL'), { code_release_authorized: true, production_database_write_authorized: false });
  fs.writeFileSync(inboxPath, inbox.map(row => JSON.stringify(row)).join('\n') + '\n');
  writeJson(schedulerPath, release);
  assert.deepStrictEqual(validateSchedulerState({ repoRoot }).errors, []);
  assert.deepStrictEqual(requiredReplayActions(release), APPLICATION_PERMISSION_ACTIONS);
  assert.deepStrictEqual(requiredReplayActions(release, 'production'), APPLICATION_PERMISSION_PRODUCTION_ACTIONS);
  for (const mutate of [
    value => { value.active_task.delivery_contract.runtime_contract_version = 'unknown'; },
    value => { value.active_task.delivery_contract.runtime_profile = 'ai'; },
    value => { value.active_task.feature_id = 'F054'; value.active_task.delivery_contract.runtime_profile = 'shipping_workspace'; },
    value => { value.active_task.delivery_contract.production_release_authorization.status = 'approved_for_final_release'; },
    value => { value.active_task.delivery_contract.final_acceptance.production_database_mode = 'controlled_write_approved'; },
    value => { value.active_task.delivery_contract.required_production_runtime_evidence = [...APPLICATION_PERMISSION_ITEMS]; }
  ]) {
    const invalid = structuredClone(release); mutate(invalid); writeJson(schedulerPath, invalid);
    assert.strictEqual(validateSchedulerState({ repoRoot }).ok, false);
  }
  writeJson(schedulerPath, release);
  runGit(repoRoot, ['add', '.']); runGit(repoRoot, ['commit', '--quiet', '-m', 'Application read-only release contract']);
  const head = runGit(repoRoot, ['rev-parse', 'HEAD']), deploymentId = 'dpl_ApplicationSelftest', origin = 'https://permission-preview.example.invalid';
  const behavior = writeBehaviorEvidence(repoRoot, makeBehaviorEntry(repoRoot, head));
  const checks = release.active_task.delivery_contract.required_code_checks;
  recordDeliveryEvidence('code', { commit: head, checks: Object.fromEntries(checks.map(name => [name, true])), behavior_log: behavior.behavior_log,
    commands: checks.map(name => ({ name, exit_code: 0, ...behavior.commandArtifact })) }, options);
  assert.strictEqual(transitionDeliveryState('code_green', options).ok, true);
  const common = { contract_version: APPLICATION_PERMISSION_CONTRACT, environment: 'preview', source: 'preview_api', isolated_project_ref: 'vsfropnfsmnonkotywsx', commit: head, deployment_id: deploymentId, origin, org_id: 'org-selftest', role_id: 'role-selftest', actor_id: 'actor-selftest' };
  const raw = [{ filename: 'http.json', contents: JSON.stringify({ fixture: true, status: 200 }) }];
  const runtime = {
    role_edit_save: evidenceEnvelope(repoRoot, 'application-save', { ...common, before_permissions: ['*'], saved_permissions: ['role:manage'], restored_permissions: ['*'],
      read_before_status: 200, read_after_status: 200, read_restored_status: 200, save_status: 200, restore_status: 200,
      persisted_readback: true, template_unchanged: true, other_settings_preserved: true, restored: true }, raw),
    role_access_enforcement: evidenceEnvelope(repoRoot, 'application-access', { ...common, role_id: 'ordinary-role', revoke_status: 200, revoked_permissions: [],
      revoked_readback: true, revoked_access_status: 403, non_root_patch_status: 403, cross_org_patch_status: 403, stale_snapshot_status: 409, restored: true }, raw)
  };
  assert.deepStrictEqual(verifier.previewBlockers(runtime), []);
  for (const [item, key, value] of [
    ['role_edit_save', 'persisted_readback', false], ['role_edit_save', 'template_unchanged', false],
    ['role_edit_save', 'saved_permissions', ['*']], ['role_edit_save', 'restored_permissions', []],
    ['role_access_enforcement', 'revoked_permissions', ['config:read']], ['role_access_enforcement', 'revoked_access_status', 200],
    ['role_access_enforcement', 'stale_snapshot_status', 200], ['role_access_enforcement', 'attachments', []],
    ['role_edit_save', 'environment', 'production'], ['role_edit_save', 'isolated_project_ref', 'production-project']
  ]) {
    const invalid = structuredClone(runtime); invalid[item].payload[key] = value;
    assert.ok(verifier.previewBlockers(invalid).length, `${item}.${key} must fail closed`);
  }
  recordDeliveryEvidence('runtime', runtime, options);
  recordDeliveryEvidence('preview', { commit: head, provider_source_commit: head, deployment_id: deploymentId, url: origin, ready: true, git_dirty: false,
    journeys: { desktop: true, blocking_defect_replay: true }, artifacts: {
      desktop: evidenceEnvelope(repoRoot, 'application-desktop', { viewport: { width: 1440, height: 1000 }, browser_context: 'existing_user_chrome', new_tabs: 0, new_browser_contexts: 0, result: 'pass' }, raw),
      defect_replay: evidenceEnvelope(repoRoot, 'application-replay', { commit: head, deployment_id: deploymentId, url: origin, actions: APPLICATION_PERMISSION_ACTIONS, result: 'pass' })
    } }, options);
  const transition = transitionDeliveryState('clean_preview_green', options);
  assert.deepStrictEqual(transition.blockers || [], []);
  assert.strictEqual(transition.ok, true);
  const status = getDeliveryStatus(options);
  for (const mutate of [
    value => { delete value.evidence.preview.artifacts.desktop; },
    value => { value.evidence.preview.journeys.blocking_defect_replay = false; },
    value => { value.evidence.preview.artifacts.desktop.payload.browser_context = 'new_chrome'; },
    value => { value.evidence.preview.artifacts.defect_replay.payload.actions = []; }
  ]) {
    const invalid = structuredClone(status); mutate(invalid);
    assert.strictEqual(checkDeliveryStage('clean_preview_green', { ...options, status: invalid }).ok, false);
  }
  for (const profile of ['ai', 'shipping', 'shipping_workspace']) {
    const legacy = structuredClone(status); legacy.runtimeProfile = profile; legacy.runtimeContractVersion = null;
    assert.strictEqual(checkDeliveryStage('clean_preview_green', { ...options, status: legacy }).ok, false, `application cannot substitute ${profile} evidence`);
  }
  const invalidHash = structuredClone(status); invalidHash.evidence.runtime.role_edit_save.sha256 = '0'.repeat(64);
  assert.strictEqual(checkDeliveryStage('clean_preview_green', { ...options, status: invalidHash }).ok, false);
  const expected = { commit: head, deploymentId, runtimeContractVersion: APPLICATION_PERMISSION_CONTRACT };
  const operator = { contract_version: APPLICATION_PERMISSION_CONTRACT, commit: head, deployment_id: deploymentId, origin: 'https://sales.cyanlog.icu', url: 'https://sales.cyanlog.icu/configs?tab=roles',
    environment: 'production', org_id: 'org-selftest', operator_id: 'operator-selftest', role_id: 'role-selftest', super_admin: true, role_list_read: true, effective_permissions_read: true,
    permission_checkbox_changed: true, changes_discarded: true, save_submitted: false, business_mutations: false, persistence_verified: false,
    actions: APPLICATION_PERMISSION_PRODUCTION_ACTIONS, attested_at: new Date().toISOString(), attested_by: 'selftest', attestation_type: 'trusted_operator_browser',
    trust_boundary: 'operator_attestation_not_machine_proof', attestation_method: 'codex_chrome_control_existing_session', browser_context: 'existing_user_chrome', existing_tab_id: 'selftest-tab', new_tabs: 0, new_browser_contexts: 0, result: 'pass', attachments: [{ path: 'fixture.json', sha256: 'a'.repeat(64) }] };
  assert.deepStrictEqual(verifier.productionOperatorBlockers(operator, expected), []);
  for (const [key, value] of [['save_submitted', true], ['business_mutations', true], ['persistence_verified', true], ['changes_discarded', false], ['new_tabs', 1], ['commit', '0'.repeat(40)], ['actions', APPLICATION_PERMISSION_ACTIONS]]) {
    assert.ok(verifier.productionOperatorBlockers({ ...operator, [key]: value }, expected).length, `Production ${key} must fail closed`);
  }
  const productionRoot = 'production-runtime-verifier/f003-selftest';
  const productionCommon = { contract_version: APPLICATION_PERMISSION_CONTRACT, commit: head, deployment_id: deploymentId, origin: 'https://sales.cyanlog.icu', environment: 'production', business_mutations: false, persistence_verified: false };
  const probes = ['GET', 'PATCH'].map(method => {
    const endpoint = method === 'GET' ? '/api/roles' : '/api/roles/role-selftest';
    const response = writeRuntimeArtifact(repoRoot, `${productionRoot}/${method}.json`, JSON.stringify({ method, path: endpoint, status: 401, credentials: 'omit', content_type: 'application/json', response_body: JSON.stringify({ error: { code: 'A001' } }) }));
    return { method, path: endpoint, status: 401, credentials: 'omit', content_type: 'application/json', application_error_code: 'A001', response_artifact: response };
  });
  const apiAttachments = probes.map(probe => probe.response_artifact);
  const production = {
    verifier: evidenceEnvelope(repoRoot, 'verifier', { ...productionCommon, source: 'live_production_application_verifier', read_only: true, request_count: 2, observed_at: new Date().toISOString(), source_operator_sha256: 'a'.repeat(64), attachments: apiAttachments }, [], productionRoot),
    role_read_edit: evidenceEnvelope(repoRoot, 'read', { ...operator, ...productionCommon, source: 'trusted_existing_chrome_operator', source_operator_sha256: 'a'.repeat(64), attachments: apiAttachments }, [], productionRoot),
    role_unauthorized_access: evidenceEnvelope(repoRoot, 'access', { ...productionCommon, source: 'production_api', probes, attachments: apiAttachments }, [], productionRoot)
  };
  assert.deepStrictEqual(productionRuntimeEvidenceBlockers({ production_runtime: production }, APPLICATION_PERMISSION_PRODUCTION_ITEMS, repoRoot, expected), []);
  for (const mutate of [
    value => { value.role_unauthorized_access.payload.probes[1].status = 200; },
    value => { value.role_unauthorized_access.payload.probes[0].credentials = 'include'; },
    value => { value.role_unauthorized_access.payload.probes[0].content_type = 'text/html'; },
    value => { value.role_unauthorized_access.payload.probes[0].application_error_code = 'DEPLOYMENT_PROTECTED'; },
    value => { value.role_read_edit.payload.persistence_verified = true; },
    value => { value.verifier.payload.source = 'manual_assertion'; },
    value => { value.verifier.payload.source_operator_sha256 = 'b'.repeat(64); },
    value => { value.role_unauthorized_access.payload.probes[0].response_artifact = { path: 'missing.json', sha256: 'a'.repeat(64) }; }
  ]) {
    const invalid = structuredClone(production); mutate(invalid);
    assert.ok(verifier.productionBlockers(invalid, expected).length, 'Invalid Production application evidence must fail closed');
  }
  assert.ok(productionRuntimeEvidenceBlockers({ production_runtime: runtime }, APPLICATION_PERMISSION_PRODUCTION_ITEMS, repoRoot, expected).length, 'Preview evidence must not substitute Production');
  assert.throws(() => recordDeliveryEvidence('production_runtime', {}, options), /controlled live Production verifier/);
  // Exercise the actual collector with an in-process HTTP double in a separate
  // selftest process. These temporary artifacts are never delivery receipts.
  const operatorEnvelope = evidenceEnvelope(repoRoot, 'application-operator', operator, raw);
  const collectorTest = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const verifier = require(${JSON.stringify(require.resolve('./application-permissions-verifier'))});
    const options = ${JSON.stringify({ runtime: deliveryRuntimeRoot(repoRoot), operator: operatorEnvelope, commit: head, deploymentId })};
    (async () => {
      const requests = [];
      global.fetch = async (url, init) => {
        requests.push({ url, init });
        assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'manual');
        assert.equal(init.headers.authorization, undefined); assert.equal(init.headers.cookie, undefined);
        if (init.method === 'PATCH') assert.equal(init.body, '{}');
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
      };
      const result = await verifier.verify(options);
      assert.deepEqual(requests.map(item => [item.init.method, item.url]), [['GET','https://sales.cyanlog.icu/api/roles'],['PATCH','https://sales.cyanlog.icu/api/roles/role-selftest']]);
      assert.equal(result.verifier.payload.persistence_verified, false);
      global.fetch = async () => new Response('<html>CDN protection</html>', { status: 401, headers: { 'content-type': 'text/html' } });
      await assert.rejects(verifier.verify(options));
      global.fetch = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      await assert.rejects(verifier.verify(options));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `], { encoding: 'utf8' });
  assert.strictEqual(collectorTest.status, 0, collectorTest.stderr || collectorTest.stdout);
}

function runCrmIntakeContractSelftest() {
  const verifier = require('./crm-intake-verifier');
  const commit = 'a'.repeat(40), deploymentId = 'dpl_CrmIntakeSelftest';
  const event = {
    enterpriseId: 'ea-cyanlog', workflowInstanceId: 'instance-1', objectApiName: 'ContractObj',
    recordId: 'record-1', shipmentDetailId: 'detail-1', taskId: 'task-1', stageId: 'stage-approved', revisionId: 'revision-1'
  };
  const eventKey = 'b'.repeat(64), orderId = '22222222-2222-4222-8222-222222222222';
  assert.strictEqual(verifier.CONTRACT, CRM_INTAKE_CONTRACT);
  assert.deepStrictEqual(verifier.ITEMS, ['crm_preflight', 'crm_unique_pending_workorder', 'crm_repeat_same_workorder', 'crm_waybill_null']);
  assert.deepStrictEqual(requiredReplayActions({
    active_task: { delivery_contract: { runtime_profile: 'shipping_workspace', runtime_contract_version: CRM_INTAKE_CONTRACT } }
  }), verifier.PREVIEW_ACTIONS);
  assert.deepStrictEqual(requiredReplayActions({
    active_task: { delivery_contract: { runtime_profile: 'shipping_workspace', runtime_contract_version: CRM_INTAKE_CONTRACT } }
  }, 'production'), verifier.PRODUCTION_ACTIONS);

  const scope = {
    activeId: 'WP97', featureId: 'F054', runtimeProfile: 'shipping_workspace', runtimeContractVersion: CRM_INTAKE_CONTRACT,
    targetState: 'production_released', productionDatabaseMode: 'controlled_write_approved',
    productionReleaseAuthorization: {
      status: 'approved_for_final_release', production_database_write_authorized: true,
      carrier_calls_authorized: false, organization_sync_authorized: false, identity_or_role_change_authorized: false
    },
    requiredRuntimeEvidence: [...verifier.ITEMS], requiredProductionRuntimeEvidence: [...verifier.ITEMS]
  };
  assert.deepStrictEqual(verifier.contractScopeBlockers(scope), []);
  for (const change of [
    value => { value.activeId = 'WP92' },
    value => { value.runtimeContractVersion = 'f054-v2' },
    value => { value.productionReleaseAuthorization.carrier_calls_authorized = true },
    value => { value.requiredRuntimeEvidence = ['shipping_workspace', ...verifier.ITEMS] },
    value => { value.requiredProductionRuntimeEvidence = verifier.ITEMS.slice(1) }
  ]) {
    const invalid = structuredClone(scope); change(invalid);
    assert.ok(verifier.contractScopeBlockers(invalid).length);
  }

  const previewCommon = {
    contract_version: CRM_INTAKE_CONTRACT, environment: 'preview', origin: 'https://crm-preview.example.invalid',
    commit, deployment_id: deploymentId, event, event_key: eventKey, production_claimed: false, business_mutations: 0
  };
  const preview = {
    crm_preflight: { payload: { ...previewCommon, source: 'live_preview_crm_intake_verifier', http_status: 200, ready: true, signature_verified: true, missing_count: 0 } },
    crm_unique_pending_workorder: { payload: { ...previewCommon, source: 'isolated_migration_test', migration_test_passed: true, event_count: 1, order_count: 1, status: 'awaiting_confirmation' } },
    crm_repeat_same_workorder: { payload: { ...previewCommon, source: 'isolated_migration_test', replay_test_passed: true, created: false, same_order: true, event_count: 1, order_count: 1, replay_count: 1 } },
    crm_waybill_null: { payload: { ...previewCommon, source: 'isolated_contract_assertion', waybill: null, waybill_rows: 0, tracking_events: 0, carrier_calls_executed: 0 } }
  };
  assert.deepStrictEqual(verifier.previewEvidenceBlockers(preview, 'preview', { commit, deploymentId }), []);
  const duplicatePreview = structuredClone(preview);
  duplicatePreview.crm_unique_pending_workorder.payload.event_count = 2;
  assert.ok(verifier.previewEvidenceBlockers(duplicatePreview, 'preview', { commit, deploymentId }).length);

  const productionCommon = {
    contract_version: CRM_INTAKE_CONTRACT, environment: 'production', origin: verifier.PRODUCTION_ORIGIN,
    commit, deployment_id: deploymentId, event, event_key: eventKey, order_id: orderId,
    source_observation_sha256: 'c'.repeat(64)
  };
  const production = {
    crm_preflight: { payload: { ...productionCommon, source: 'live_crm_intake_verifier', http_status: 200, ready: true, signature_verified: true, missing_count: 0 } },
    crm_unique_pending_workorder: { payload: { ...productionCommon, source: 'live_production_database_read', event_count: 1, order_count: 1, status: 'awaiting_confirmation', intake_source: 'crm', confirmation_policy: 'scheduled_review' } },
    crm_repeat_same_workorder: { payload: { ...productionCommon, source: 'live_crm_intake_verifier', http_status: 202, created: false, same_order: true, event_count: 1, order_count: 1, replay_count_before: 0, replay_count_after: 1 } },
    crm_waybill_null: { payload: { ...productionCommon, source: 'live_production_database_read', waybill: null, waybill_rows: 0, tracking_events: 0, carrier_calls_executed: 0, provider_order_id: null } },
    verifier: { payload: { ...productionCommon, source: 'live_crm_intake_verifier', result: 'pass', actions: [...verifier.PRODUCTION_ACTIONS], attachments: [{}] } }
  };
  assert.deepStrictEqual(verifier.productionEvidenceBlockers(production, { commit, deploymentId }), []);
  const leaked = structuredClone(production); leaked.crm_waybill_null.payload.carrier_calls_executed = 1;
  assert.ok(verifier.productionEvidenceBlockers(leaked, { commit, deploymentId }).length);
  assert.throws(
    () => recordDeliveryEvidence('production_runtime', {}, {}),
    /controlled live Production verifier/
  );
}

function runServiceSelectionContractSelftest(repoRoot) {
  const verifier = require('./shipping-service-selection-verifier');
  assert.strictEqual(verifier.CONTRACT, SHIPPING_SERVICE_SELECTION_CONTRACT);
  assert.deepStrictEqual(verifier.ITEMS, ['shipping_service_selection', 'shipping_access']);
  assert.deepStrictEqual(verifier.ACTIONS, ['open_shipping_workspace', 'select_two_existing_pending_orders',
    'change_service_for_order_a', 'verify_order_b_unchanged', 'choose_batch_service_without_apply',
    'verify_pending_batch_choice_no_change', 'apply_batch_service_to_selected_orders',
    'restore_original_services_explicitly', 'review_per_order_service_summary', 'leave_confirmation_unsubmitted']);
  runGit(repoRoot, ['init', '--quiet']);
  runGit(repoRoot, ['config', 'user.name', 'Harness Selftest']);
  runGit(repoRoot, ['config', 'user.email', 'harness-selftest@example.invalid']);
  makeSettings(repoRoot);
  makeSchedulerFixture(repoRoot);
  const schedulerPath = path.join(repoRoot, 'governance/runtime-state/active-task.json');
  const scheduler = JSON.parse(fs.readFileSync(schedulerPath, 'utf8'));
  scheduler.active_task.id = scheduler.execution_queue.active.id = 'WP52';
  scheduler.active_task.feature_id = 'F054';
  scheduler.active_task.delivery_contract = {
    target_state: 'clean_preview_green', allowed_states: ['executing', 'code_green', 'clean_preview_green'],
    integration_branch: 'main', production_branch: 'production', production_release_separate: true,
    same_release_commit_required: true, attestation_ref: DELIVERY_ATTESTATION_REF,
    required_code_checks: ['target_tests', 'full_tests', 'lint', 'typecheck', 'build'],
    required_runtime_evidence: [...verifier.ITEMS], runtime_profile: 'shipping_workspace',
    runtime_contract_version: verifier.CONTRACT, production_database_mode: 'read_only'
  };
  writeJson(schedulerPath, scheduler);
  core.startGoal(repoRoot, 'Verify per-order service choices without confirming shipments', { level: 'A1', workPackageId: 'WP52', scopes: 'app', success: 'selection accepted' });
  core.approveContract(repoRoot, { level: 'A1', by: 'selftest' });
  core.setPhase(repoRoot, 'verify');
  assert.deepStrictEqual(validateSchedulerState({ repoRoot }).errors, []);
  assert.deepStrictEqual(requiredReplayActions(scheduler), verifier.ACTIONS);
  assert.deepStrictEqual(requiredReplayActions(scheduler, 'production'), verifier.ACTIONS);
  for (const change of [
    state => { state.active_task.id = state.execution_queue.active.id = 'WP53'; },
    state => { state.active_task.feature_id = 'F003'; },
    state => { state.active_task.delivery_contract.runtime_profile = 'application'; },
    state => { state.active_task.delivery_contract.production_database_mode = 'controlled_write_approved'; },
    state => { state.active_task.delivery_contract.required_runtime_evidence = ['shipping_service_selection']; },
    state => { state.active_task.delivery_contract.required_runtime_evidence.push('shipping_tracking'); }
  ]) {
    const invalid = structuredClone(scheduler); change(invalid); writeJson(schedulerPath, invalid);
    assert.strictEqual(validateSchedulerState({ repoRoot }).ok, false);
  }
  const authorization = { status: 'approved_code_only', micro_fix_approval_id: 'IN-SELFTEST-MICROFIX-APPROVAL',
    clarification_id: 'IN-SELFTEST-CLARIFICATION', final_release_approval_id: 'IN-SELFTEST-FINAL-APPROVAL',
    micro_fix_scope: 'per_order_service_selection', final_scope: 'selftest selection UI without carrier operations',
    database_write_authorized: false, production_database_write_authorized: false, carrier_calls_authorized: false };
  const productionScheduler = structuredClone(scheduler);
  Object.assign(productionScheduler.active_task.delivery_contract, {
    target_state: 'production_released', allowed_states: ['executing', 'code_green', 'clean_preview_green', 'integration_ready', 'main_integrated', 'production_released'],
    required_production_runtime_evidence: [...verifier.ITEMS], production_release_authorization: authorization,
    final_acceptance: { browser: 'trusted_operator_attestation_from_user_existing_chrome_only', production_database_mode: 'read_only' }
  });
  const inboxPath = path.join(repoRoot, 'governance/runtime-state/demand-inbox.jsonl');
  const inbox = fs.readFileSync(inboxPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  Object.assign(inbox.find(record => record.id === authorization.final_release_approval_id), {
    scope: authorization.final_scope, code_release_authorized: true, production_write_authorized: false,
    production_database_write_authorized: false, carrier_calls_authorized: false
  });
  fs.writeFileSync(inboxPath, inbox.map(record => JSON.stringify(record)).join('\n') + '\n');
  writeJson(schedulerPath, productionScheduler);
  assert.deepStrictEqual(validateSchedulerState({ repoRoot }).errors, []);
  for (const change of [
    state => { delete state.active_task.delivery_contract.production_release_authorization.production_database_write_authorized; },
    state => { delete state.active_task.delivery_contract.production_release_authorization.carrier_calls_authorized; },
    state => { state.active_task.delivery_contract.production_release_authorization.database_write_authorized = true; },
    state => { state.active_task.delivery_contract.production_release_authorization.production_database_write_authorized = true; },
    state => { state.active_task.delivery_contract.production_release_authorization.carrier_calls_authorized = true; },
    state => { state.active_task.delivery_contract.production_release_authorization.status = 'approved_for_final_release'; },
    state => { state.active_task.delivery_contract.required_production_runtime_evidence.push('shipping_tracking'); }
  ]) {
    const invalid = structuredClone(productionScheduler); change(invalid); writeJson(schedulerPath, invalid);
    assert.strictEqual(validateSchedulerState({ repoRoot }).ok, false);
  }
  const scope = { activeId: 'WP52', featureId: 'F054', runtimeProfile: 'shipping_workspace', runtimeContractVersion: verifier.CONTRACT,
    targetState: 'production_released', productionDatabaseMode: 'read_only', productionReleaseAuthorization: authorization };
  assert.deepStrictEqual(shippingProductionVerifierScopeBlockers(scope), []);
  for (const change of [
    value => { value.activeId = 'WP53'; }, value => { value.featureId = 'F003'; }, value => { value.runtimeProfile = 'application'; },
    value => { value.targetState = 'code_green'; }, value => { value.productionDatabaseMode = 'controlled_write_approved'; },
    value => { value.productionReleaseAuthorization.status = 'pending_security_gate_and_final_write_approval'; },
    value => { delete value.productionReleaseAuthorization.carrier_calls_authorized; },
    value => { value.productionReleaseAuthorization.production_database_write_authorized = true; }
  ]) {
    const invalid = structuredClone(scope); change(invalid);
    assert.ok(shippingProductionVerifierScopeBlockers(invalid).length);
  }
  writeJson(schedulerPath, scheduler);
  fs.writeFileSync(path.join(repoRoot, '.gitignore'), '.runtime/\n');
  runGit(repoRoot, ['add', '.']); runGit(repoRoot, ['commit', '--quiet', '-m', 'Selection contract fixture']);
  fs.writeFileSync(path.join(repoRoot, 'candidate.txt'), 'selection candidate\n');
  runGit(repoRoot, ['add', '.']); runGit(repoRoot, ['commit', '--quiet', '-m', 'Selection candidate']);
  const head = runGit(repoRoot, ['rev-parse', 'HEAD']), deploymentId = 'dpl_ServiceSelectionSelftest', origin = 'https://selection-preview.example.invalid';
  const options = { repoRoot, remoteSnapshot: {} };
  const behavior = writeBehaviorEvidence(repoRoot, makeBehaviorEntry(repoRoot, head));
  const checks = scheduler.active_task.delivery_contract.required_code_checks;
  recordDeliveryEvidence('code', { commit: head, checks: Object.fromEntries(checks.map(name => [name, true])), behavior_log: behavior.behavior_log,
    commands: checks.map(name => ({ name, exit_code: 0, ...behavior.commandArtifact })) }, options);
  assert.strictEqual(transitionDeliveryState('code_green', options).ok, true);
  const common = { commit: head, deployment_id: deploymentId, origin, environment: 'preview', contract_version: verifier.CONTRACT,
    result: 'pass', production_requests_exercised: false, read_only: true };
  const runtime = {
    shipping_service_selection: evidenceEnvelope(repoRoot, 'selection-runtime', { ...common, per_order_isolation: true, payload_regression_passed: true }),
    shipping_access: evidenceEnvelope(repoRoot, 'selection-access', { ...common, anonymous_access_denied: true })
  };
  assert.deepStrictEqual(shippingWorkspaceEvidenceBlockers(runtime, 'sandbox', verifier.CONTRACT), []);
  assert.ok(shippingWorkspaceEvidenceBlockers({ ...runtime, shipping_workspace: { payload: { contract_version: 'f054-ui-v1' } } }, 'sandbox', 'f054-ui-v1').some(message => message.includes('six_sections_available')));
  assert.ok(productionRuntimeEvidenceBlockers({ production_runtime: runtime }, verifier.ITEMS, repoRoot, { commit: head, deploymentId, runtimeContractVersion: verifier.CONTRACT }).length, 'Preview declarations must never become controlled Production proof');
  assert.throws(() => recordDeliveryEvidence('production_runtime', runtime, options), /controlled live Production verifier/);
  recordDeliveryEvidence('runtime', runtime, options);
  const replay = { ...common, url: origin + '/shipping', actions: [...verifier.ACTIONS], result: 'pass', overlays_after: 0, body_scroll_lock_released: true, app_inert_after: false };
  recordDeliveryEvidence('preview', { commit: head, provider_source_commit: head, deployment_id: deploymentId, url: origin, ready: true, git_dirty: false,
    journeys: { desktop: true, ipad: true, blocking_defect_replay: true }, artifacts: {
      desktop: evidenceEnvelope(repoRoot, 'selection-desktop', { ...common, viewport: { width: 1440, height: 1000 }, result: 'pass' }),
      ipad: evidenceEnvelope(repoRoot, 'selection-ipad', { ...common, viewport: { width: 1024, height: 768 }, result: 'pass' }),
      defect_replay: evidenceEnvelope(repoRoot, 'selection-replay', replay)
    } }, options);
  const transition = transitionDeliveryState('clean_preview_green', options);
  assert.deepStrictEqual(transition.blockers || [], []);
  assert.strictEqual(transition.ok, true);
  const status = getDeliveryStatus(options);
  let sequence = 0;
  const envelope = payload => evidenceEnvelope(repoRoot, `selection-negative-${++sequence}`, payload);
  for (const mutate of [
    value => { value.evidence.preview.journeys.ipad = false; },
    value => { value.evidence.preview.artifacts.defect_replay = envelope({ ...replay, actions: [...verifier.ACTIONS].reverse() }); },
    value => { value.evidence.preview.artifacts.defect_replay = envelope({ ...replay, actions: verifier.ACTIONS.slice(0, -1) }); },
    value => { value.evidence.runtime.shipping_service_selection = envelope({ ...runtime.shipping_service_selection.payload, per_order_isolation: false }); },
    value => { value.evidence.runtime.shipping_service_selection = envelope({ ...runtime.shipping_service_selection.payload, commit: 'b'.repeat(40) }); },
    value => { value.evidence.runtime.shipping_access = envelope({ ...runtime.shipping_access.payload, deployment_id: 'dpl_Other' }); },
    value => { value.evidence.runtime.shipping_access = envelope({ ...runtime.shipping_access.payload, origin: 'https://other.example.invalid' }); },
    value => { value.evidence.runtime.shipping_access.sha256 = '0'.repeat(64); }
  ]) {
    const invalid = structuredClone(status); mutate(invalid);
    assert.strictEqual(checkDeliveryStage('clean_preview_green', { ...options, status: invalid }).ok, false);
  }
  // Isolate the final operator link: these checks must run even without a
  // configured blocking defect. Other terminal release prerequisites stay closed.
  const productionStatus = structuredClone(status);
  Object.assign(productionStatus, { targetState: 'production_released', productionDatabaseMode: 'read_only',
    productionReleaseAuthorization: authorization, requiredProductionRuntimeEvidence: [...verifier.ITEMS] });
  Object.assign(productionStatus.git, { remoteProduction: head, remoteMain: head, mainIntegrated: true, defaultBranch: 'main' });
  const browser = evidenceEnvelope(repoRoot, 'selection-production-browser', {
    commit: head, deployment_id: SELFTEST_PRODUCTION_DEPLOYMENT_ID, url: 'https://sales.cyanlog.icu/shipping',
    environment: 'production', attestation_type: 'trusted_operator_browser', trust_boundary: 'operator_attestation_not_machine_proof',
    attestation_method: 'codex_chrome_control_existing_session', attested_by: 'selftest', attested_at: new Date().toISOString(),
    existing_tab_id: 'existing-selftest-tab', browser_context: 'existing_user_chrome', new_tabs: 0, new_browser_contexts: 0,
    result: 'pass', actions: [...verifier.ACTIONS]
  }, [{ filename: 'observation.json', contents: '{"fixture":"operator-observation"}\n' }]);
  productionStatus.evidence.production = { commit: head, deployment_id: SELFTEST_PRODUCTION_DEPLOYMENT_ID,
    domain: VERCEL_PRODUCTION_CONTRACT.domain, browser_acceptance: browser };
  productionStatus.evidence.production_runtime = { shipping_service_selection: { payload: { source_operator_sha256: browser.sha256 } } };
  const terminalOptions = { ...options, testOnlyVercelApiResponses: makeTestVercelApiResponses(head) };
  const operatorLinkErrors = value => checkDeliveryStage('production_released', { ...terminalOptions, status: value }).blockers
    .filter(message => message.startsWith('Service selection Production operator actions') || message.startsWith('Service selection Production runtime is not bound'));
  assert.deepStrictEqual(operatorLinkErrors(productionStatus), []);
  for (const actions of [[], [...verifier.ACTIONS].reverse()]) {
    const invalid = structuredClone(productionStatus);
    invalid.evidence.production.browser_acceptance = envelope({ ...browser.payload, actions });
    invalid.evidence.production_runtime.shipping_service_selection.payload.source_operator_sha256 = invalid.evidence.production.browser_acceptance.sha256;
    assert.ok(operatorLinkErrors(invalid).some(message => message.includes('operator actions')));
  }
  const unbound = structuredClone(productionStatus);
  unbound.evidence.production_runtime.shipping_service_selection.payload.source_operator_sha256 = '0'.repeat(64);
  assert.ok(operatorLinkErrors(unbound).some(message => message.includes('not bound')));
  runShippingContractSelftest(repoRoot);
  console.log('service selection scoped contract and ordinary Preview gate selftest ok');
}

function runConfigurationUiSelftest(repoRoot) {
  runGit(repoRoot, ['init', '--quiet']);
  runGit(repoRoot, ['config', 'user.name', 'Harness Selftest']);
  runGit(repoRoot, ['config', 'user.email', 'harness-selftest@example.invalid']);
  makeSettings(repoRoot);
  makeSchedulerFixture(repoRoot);
  const schedulerPath = path.join(repoRoot, 'governance/runtime-state/active-task.json');
  const scheduler = JSON.parse(fs.readFileSync(schedulerPath, 'utf8'));
  scheduler.active_task.feature_id = 'F054';
  scheduler.active_task.delivery_contract = {
    target_state: 'clean_preview_green', allowed_states: ['executing', 'code_green', 'clean_preview_green'],
    integration_branch: 'main', production_branch: 'production', production_release_separate: true,
    same_release_commit_required: true, attestation_ref: DELIVERY_ATTESTATION_REF,
    required_code_checks: ['target_tests', 'full_tests', 'lint', 'typecheck', 'build'],
    required_runtime_evidence: [...SHIPPING_CONFIG_UI_ITEMS], runtime_profile: 'shipping_workspace',
    runtime_contract_version: 'f054-config-ui-v1', production_database_mode: 'read_only'
  };
  writeJson(schedulerPath, scheduler);
  core.startGoal(repoRoot, 'Verify the two shipping configuration entries', { level: 'A1', workPackageId: 'WP99', scopes: 'app', success: 'configuration accepted' });
  core.approveContract(repoRoot, { level: 'A1', by: 'selftest' });
  core.setPhase(repoRoot, 'verify');
  assert.deepStrictEqual(validateSchedulerState({ repoRoot }).errors, []);
  assert.deepStrictEqual(requiredReplayActions(scheduler), SHIPPING_CONFIG_UI_ACTIONS);
  for (const change of [
    state => { state.active_task.delivery_contract.target_state = 'integration_ready'; state.active_task.delivery_contract.allowed_states.push('integration_ready'); },
    state => { state.active_task.delivery_contract.production_database_mode = 'controlled_write_approved'; },
    state => { state.active_task.delivery_contract.required_runtime_evidence = ['shipping_workspace']; },
    state => { state.active_task.feature_id = 'F001'; }
  ]) {
    const invalid = structuredClone(scheduler); change(invalid); writeJson(schedulerPath, invalid);
    assert.strictEqual(validateSchedulerState({ repoRoot }).ok, false);
  }
  writeJson(schedulerPath, scheduler);
  assert.ok(shippingProductionVerifierScopeBlockers({ activeId: 'WP99', featureId: 'F054', runtimeProfile: 'shipping_workspace', runtimeContractVersion: 'f054-config-ui-v1', targetState: 'production_released', productionDatabaseMode: 'read_only', productionReleaseAuthorization: { status: 'approved_code_only' } }).length);
  const old = structuredClone(scheduler);
  old.active_task.delivery_contract.runtime_contract_version = 'f054-intake-v1';
  assert.strictEqual(requiredReplayActions(old).length, 14);
  assert.strictEqual(requiredReplayActions(old)[0], 'open_sales_intake');

  fs.writeFileSync(path.join(repoRoot, '.gitignore'), '.runtime/\n');
  runGit(repoRoot, ['add', '.']); runGit(repoRoot, ['commit', '--quiet', '-m', 'Configuration contract fixture']);
  fs.writeFileSync(path.join(repoRoot, 'candidate.txt'), 'configuration candidate\n');
  runGit(repoRoot, ['add', '.']); runGit(repoRoot, ['commit', '--quiet', '-m', 'Configuration candidate']);
  const head = runGit(repoRoot, ['rev-parse', 'HEAD']), deploymentId = 'dpl_ConfigUiSelftest', origin = 'https://config-preview.example.invalid';
  const options = { repoRoot, remoteSnapshot: {} };
  const behavior = writeBehaviorEvidence(repoRoot, makeBehaviorEntry(repoRoot, head));
  const checks = scheduler.active_task.delivery_contract.required_code_checks;
  recordDeliveryEvidence('code', { commit: head, checks: Object.fromEntries(checks.map(name => [name, true])), behavior_log: behavior.behavior_log,
    commands: checks.map(name => ({ name, exit_code: 0, ...behavior.commandArtifact })) }, options);
  assert.strictEqual(transitionDeliveryState('code_green', options).ok, true);
  const common = { commit: head, deployment_id: deploymentId, origin, environment: 'preview' };
  const permissionLog = writeRuntimeArtifact(repoRoot, 'checks/config-permissions.log', 'selftest fixture: role access and cross-organization permission regression passed\n');
  const workspacePayload = { ...common, contract_version: 'f054-config-ui-v1', integration_entries: ['carrier', 'enterprise'],
    observation_source: 'existing_chrome_operator', operator_observations_are_attested: true,
    ...Object.fromEntries(SHIPPING_CONFIG_UI_FLAGS.map(key => [key, true])) };
  const accessPayload = { ...common, authenticated_configuration_visible: true, authenticated_observation_source: 'existing_chrome_operator',
    operator_observations_are_attested: true, anonymous_settings_denied: true, anonymous_observation_source: 'http_response', anonymous_status: 401, application_response: true,
    anonymous_endpoint: origin + '/api/shipping/settings', cross_account_live_verified: false, no_business_mutations: true,
    permission_regression: { source: 'automated_tests', commit: head, result: 'pass', coverage: ['role_access', 'cross_organization'], artifact_path: permissionLog.path, log_sha256: permissionLog.sha256 }, attachments: [permissionLog] };
  const runtime = { shipping_workspace: evidenceEnvelope(repoRoot, 'config-workspace', workspacePayload), shipping_access: evidenceEnvelope(repoRoot, 'config-access', accessPayload) };
  assert.deepStrictEqual(shippingWorkspaceEvidenceBlockers(runtime, 'sandbox', 'f054-config-ui-v1'), []);
  for (const flag of SHIPPING_CONFIG_UI_FLAGS) {
    const invalid = structuredClone(runtime); invalid.shipping_workspace.payload[flag] = false;
    assert.ok(shippingWorkspaceEvidenceBlockers(invalid, 'sandbox', 'f054-config-ui-v1').some(message => message.includes(flag)));
  }
  for (const mutate of [
    value => { value.shipping_workspace.payload.integration_entries = ['carrier', 'enterprise', 'tracking']; },
    value => { value.shipping_workspace.payload.observation_source = 'machine_proof'; },
    value => { value.shipping_access.payload.anonymous_status = 403; },
    value => { value.shipping_access.payload.anonymous_observation_source = 'existing_chrome_operator'; },
    value => { value.shipping_access.payload.application_response = false; },
    value => { value.shipping_access.payload.authenticated_configuration_visible = false; },
    value => { value.shipping_access.payload.cross_account_live_verified = true; },
    value => { value.shipping_access.payload.anonymous_endpoint = 'https://other.example.invalid/api/shipping/settings'; },
    value => { value.shipping_access.payload.permission_regression.commit = 'b'.repeat(40); },
    value => { value.shipping_access.payload.permission_regression.coverage = ['role_access']; },
    value => { value.shipping_access.payload.attachments = []; },
    value => { value.shipping_workspace.payload.cancel_before_collection_verified = true; }
  ]) {
    const invalid = structuredClone(runtime); mutate(invalid);
    assert.ok(shippingWorkspaceEvidenceBlockers(invalid, 'sandbox', 'f054-config-ui-v1').length);
  }
  assert.ok(shippingWorkspaceEvidenceBlockers(runtime, 'production', 'f054-config-ui-v1').length);
  assert.ok(shippingWorkspaceEvidenceBlockers(runtime, 'sandbox', 'f054-ui-v1').some(message => message.includes('version')));
  const legacy = structuredClone(runtime); legacy.shipping_workspace.payload.contract_version = 'f054-ui-v1';
  assert.ok(shippingWorkspaceEvidenceBlockers(legacy, 'sandbox', 'f054-ui-v1').some(message => message.includes('six_sections_available')));
  recordDeliveryEvidence('runtime', runtime, options);
  const replay = { ...common, url: origin + '/configs?tab=shipping', actions: [...SHIPPING_CONFIG_UI_ACTIONS], result: 'pass', overlays_after: 0, body_scroll_lock_released: true, app_inert_after: false };
  recordDeliveryEvidence('preview', { commit: head, provider_source_commit: head, deployment_id: deploymentId, url: origin, ready: true, git_dirty: false,
    journeys: { desktop: true, ipad: true, blocking_defect_replay: true }, artifacts: {
      desktop: evidenceEnvelope(repoRoot, 'config-desktop', { ...common, viewport: { width: 1440, height: 1000 }, result: 'pass' }),
      ipad: evidenceEnvelope(repoRoot, 'config-ipad', { ...common, viewport: { width: 1024, height: 768 }, result: 'pass' }),
      defect_replay: evidenceEnvelope(repoRoot, 'config-replay', replay)
    } }, options);
  const transition = transitionDeliveryState('clean_preview_green', options);
  assert.deepStrictEqual(transition.blockers || [], []);
  assert.strictEqual(transition.ok, true);
  const status = getDeliveryStatus(options);
  let sequence = 0;
  const envelope = payload => evidenceEnvelope(repoRoot, `config-negative-${++sequence}`, payload);
  for (const mutate of [
    value => { value.evidence.preview.provider_source_commit = 'b'.repeat(40); },
    value => { value.evidence.runtime.shipping_workspace = envelope({ ...workspacePayload, commit: 'b'.repeat(40) }); },
    value => { value.evidence.runtime.shipping_access = envelope({ ...accessPayload, deployment_id: 'dpl_Other' }); },
    value => { value.evidence.runtime.shipping_access = envelope({ ...accessPayload, origin: 'https://other.example.invalid' }); },
    value => { value.evidence.preview.artifacts.defect_replay = envelope({ ...replay, actions: [...SHIPPING_CONFIG_UI_ACTIONS].reverse() }); },
    value => { value.evidence.preview.artifacts.desktop = envelope({ ...common, viewport: { width: 600, height: 900 } }); },
    value => { value.evidence.preview.artifacts.ipad = envelope({ ...common, viewport: { width: 1440, height: 900 } }); },
    value => { value.evidence.runtime.shipping_workspace.sha256 = '0'.repeat(64); }
  ]) {
    const invalid = structuredClone(status); mutate(invalid);
    assert.strictEqual(checkDeliveryStage('clean_preview_green', { ...options, status: invalid }).ok, false);
  }
  fs.appendFileSync(path.join(deliveryRuntimeRoot(repoRoot), permissionLog.path), 'tampered');
  assert.strictEqual(checkDeliveryStage('clean_preview_green', { ...options, status }).ok, false);
  console.log('configuration UI Preview contract selftest ok');
}

function runShippingSettingsContractSelftest(repoRoot) {
  const verifier = require('./shipping-settings-verifier');
  const state = { active_task: { id: 'WP40', feature_id: 'F054', delivery_contract: {
    runtime_profile: 'shipping_workspace', runtime_contract_version: SHIPPING_SETTINGS_CONTRACT
  } } };
  assert.deepStrictEqual(requiredReplayActions(state), verifier.ACTIONS);
  const approved = {
    activeId: 'WP40', featureId: 'F054', runtimeProfile: 'shipping_workspace',
    runtimeContractVersion: SHIPPING_SETTINGS_CONTRACT, targetState: 'production_released',
    productionDatabaseMode: 'read_only', productionReleaseAuthorization: {
      status: 'approved_code_only', database_write_authorized: false,
      production_database_write_authorized: false, carrier_calls_authorized: false,
      organization_sync_authorized: false, service_retirement_authorized: false,
    },
  };
  assert.deepStrictEqual(shippingProductionVerifierScopeBlockers(approved), []);
  for (const patch of [
    { activeId: 'WP52' },
    { productionDatabaseMode: 'controlled_write_approved' },
    { productionReleaseAuthorization: { ...approved.productionReleaseAuthorization, carrier_calls_authorized: true } },
    { productionReleaseAuthorization: { ...approved.productionReleaseAuthorization, organization_sync_authorized: true } },
    { productionReleaseAuthorization: { ...approved.productionReleaseAuthorization, service_retirement_authorized: true } },
  ]) {
    assert.ok(shippingProductionVerifierScopeBlockers({ ...approved, ...patch }).length);
  }
  const preview = {
    shipping_settings: { payload: { contract_version: SHIPPING_SETTINGS_CONTRACT, environment: 'preview', one_page_merged: true,
      carrier_controls_visible: true, billing_service_controls_visible: true, default_sender_visible: true,
      intake_rules_visible: true, organization_permission_entry_visible: true, legacy_enterprise_ui_absent: true,
      save_clicked: false, no_business_mutations: true, carrier_calls_observed: false,
      organization_sync_requests_observed: false, service_state_changes_observed: false } },
    shipping_access: { payload: { contract_version: SHIPPING_SETTINGS_CONTRACT, environment: 'preview',
      anonymous_access_denied: true, application_response: true, anonymous_status: 401, no_business_mutations: true } },
  };
  assert.deepStrictEqual(shippingWorkspaceEvidenceBlockers(preview, 'preview', SHIPPING_SETTINGS_CONTRACT), []);
  const missingProduction = productionRuntimeEvidenceBlockers({}, verifier.ITEMS, repoRoot, {
    commit: 'a'.repeat(40), deploymentId: 'dpl_settings', runtimeContractVersion: SHIPPING_SETTINGS_CONTRACT,
  });
  assert.ok(missingProduction.some(message => message.includes('Shipping settings controlled evidence')));
  console.log('shipping settings read-only contract selftest ok');
}

function makeTestVercelApiResponses(productionCommit) {
  return {
    __test_only: true,
    project: {
      id: VERCEL_PRODUCTION_CONTRACT.projectId,
      name: VERCEL_PRODUCTION_CONTRACT.projectName,
      accountId: VERCEL_PRODUCTION_CONTRACT.teamId,
      rootDirectory: VERCEL_PRODUCTION_CONTRACT.rootDirectory,
      link: { productionBranch: VERCEL_PRODUCTION_CONTRACT.productionBranch },
      targets: { production: { id: SELFTEST_PRODUCTION_DEPLOYMENT_ID } }
    },
    domain: {
      name: VERCEL_PRODUCTION_CONTRACT.domain,
      projectId: VERCEL_PRODUCTION_CONTRACT.projectId,
      verified: true
    },
    alias: {
      alias: VERCEL_PRODUCTION_CONTRACT.domain,
      projectId: VERCEL_PRODUCTION_CONTRACT.projectId,
      deploymentId: SELFTEST_PRODUCTION_DEPLOYMENT_ID,
      deployment: { id: SELFTEST_PRODUCTION_DEPLOYMENT_ID },
      redirect: null,
      deletedAt: null
    },
    deployment: {
      id: SELFTEST_PRODUCTION_DEPLOYMENT_ID,
      name: VERCEL_PRODUCTION_CONTRACT.projectName,
      project: {
        id: VERCEL_PRODUCTION_CONTRACT.projectId,
        name: VERCEL_PRODUCTION_CONTRACT.projectName
      },
      team: { id: VERCEL_PRODUCTION_CONTRACT.teamId },
      target: 'production',
      readyState: 'READY',
      readySubstate: 'PROMOTED',
      status: 'READY',
      gitSource: { type: 'github', ref: 'production', sha: productionCommit },
      meta: { githubCommitSha: productionCommit },
      // The real API omits the assigned custom domain from this list.
      alias: ['selftest-deployment.vercel.app']
    }
  };
}

function runDeliverySelftest(repoRoot) {
  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-selftest-remote-'));
  try {
    fs.writeFileSync(path.join(repoRoot, '.gitignore'), '.runtime/\n');
    runGit(repoRoot, ['config', 'user.name', 'Harness Selftest']);
    runGit(repoRoot, ['config', 'user.email', 'harness-selftest@example.invalid']);
    runGit(repoRoot, ['config', 'core.hooksPath', '/dev/null']);
    runGit(repoRoot, ['add', '-A']);
    runGit(repoRoot, ['commit', '--quiet', '-m', 'selftest fixture']);
    runGit(repoRoot, ['branch', '-M', 'main']);
    runGit(remoteRoot, ['init', '--bare', '--quiet']);
    runGit(repoRoot, ['remote', 'add', 'origin', remoteRoot]);
    runGit(repoRoot, ['push', '--quiet', '-u', 'origin', 'main']);
    runGit(repoRoot, ['push', '--quiet', 'origin', 'HEAD:production']);
    runGit(repoRoot, [`--git-dir=${remoteRoot}`, 'symbolic-ref', 'HEAD', 'refs/heads/main']);

    const productionHead = runGit(repoRoot, ['rev-parse', 'HEAD']);
    const candidatePath = path.join(
      repoRoot,
      'governance/runtime-config-AI运行配置/selftest-candidate.txt'
    );
    fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
    fs.writeFileSync(candidatePath, 'delivery candidate\n');
    runGit(repoRoot, ['add', candidatePath]);
    runGit(repoRoot, ['commit', '--quiet', '-m', 'selftest delivery candidate']);
    const head = runGit(repoRoot, ['rev-parse', 'HEAD']);
    const requiredChecks = ['target_tests', 'full_tests', 'lint', 'typecheck', 'build'];

    const wrongHeadBehavior = writeBehaviorEvidence(repoRoot, makeBehaviorEntry(repoRoot, productionHead));
    recordDeliveryEvidence('code', {
      commit: head,
      checks: Object.fromEntries(requiredChecks.map((name) => [name, true])),
      behavior_log: wrongHeadBehavior.behavior_log,
      commands: requiredChecks.map((name) => ({
        name,
        exit_code: 0,
        ...wrongHeadBehavior.commandArtifact
      }))
    }, { repoRoot });
    const wrongHeadTransition = transitionDeliveryState('code_green', { repoRoot });
    assert.strictEqual(wrongHeadTransition.ok, false);
    assert.ok(wrongHeadTransition.blockers.some((blocker) => blocker.includes('current HEAD')));

    const tamperedBehaviorEntry = makeBehaviorEntry(repoRoot, head);
    const tamperedBehavior = writeBehaviorEvidence(repoRoot, tamperedBehaviorEntry);
    fs.appendFileSync(
      path.join(deliveryRuntimeRoot(repoRoot), tamperedBehaviorEntry.aiBehavior.evidenceBinding.checkArtifacts[0].artifact_path),
      'tampered after post-commit\n'
    );
    recordDeliveryEvidence('code', {
      behavior_log: tamperedBehavior.behavior_log,
      commands: requiredChecks.map((name) => ({
        name,
        exit_code: 0,
        ...tamperedBehavior.commandArtifact
      }))
    }, { repoRoot });
    const tamperedCommandTransition = transitionDeliveryState('code_green', { repoRoot });
    assert.strictEqual(tamperedCommandTransition.ok, false);
    assert.ok(tamperedCommandTransition.blockers.some((blocker) => blocker.includes('behavior log')));

    const currentHeadBehavior = writeBehaviorEvidence(repoRoot, makeBehaviorEntry(repoRoot, head));
    const fakeHash = 'a'.repeat(64);
    recordDeliveryEvidence('code', {
      behavior_log: { ...currentHeadBehavior.behavior_log, sha256: fakeHash },
      commands: requiredChecks.map((name) => ({
        name,
        exit_code: 0,
        artifact_path: currentHeadBehavior.commandArtifact.artifact_path,
        log_sha256: fakeHash
      }))
    }, { repoRoot });
    const fakeArtifactTransition = transitionDeliveryState('code_green', { repoRoot });
    assert.strictEqual(fakeArtifactTransition.ok, false);
    assert.ok(fakeArtifactTransition.blockers.some((blocker) => blocker.includes('behavior log')));

    recordDeliveryEvidence('code', {
      behavior_log: currentHeadBehavior.behavior_log,
      commands: requiredChecks.map((name) => ({
        name,
        exit_code: 0,
        ...currentHeadBehavior.commandArtifact
      }))
    }, { repoRoot });
    assert.strictEqual(transitionDeliveryState('code_green', { repoRoot }).ok, true);

    const deploymentId = 'dpl_Selftest123';
    const reviewId = '00000000-0000-4000-8000-000000000099';
    const desktop = evidenceEnvelope(repoRoot, 'desktop', {
      commit: head,
      deployment_id: deploymentId,
      viewport: { width: 1440, height: 1000 },
      result: 'pass'
    }, [{ filename: 'desktop.png', contents: Buffer.from('selftest desktop screenshot') }]);
    const ipad = evidenceEnvelope(repoRoot, 'ipad', {
      commit: head,
      deployment_id: deploymentId,
      viewport: { width: 1180, height: 820 },
      result: 'pass'
    }, [{ filename: 'ipad.png', contents: Buffer.from('selftest ipad screenshot') }]);
    const defectReplay = evidenceEnvelope(repoRoot, 'defect-replay', {
      commit: head,
      deployment_id: deploymentId,
      url: 'https://preview.example.invalid/configs?tab=ai',
      actions: [...REQUIRED_DEFECT_REPLAY_ACTIONS],
      result: 'pass',
      overlays_after: 0,
      body_scroll_lock_released: true,
      app_inert_after: false
    }, [{ filename: 'replay.txt', contents: 'selftest replay trace\n' }]);
    recordDeliveryEvidence('preview', {
      commit: head,
      provider_source_commit: head,
      deployment_id: deploymentId,
      url: 'https://preview.example.invalid',
      ready: true,
      git_dirty: false,
      journeys: { desktop: true, ipad: true, blocking_defect_replay: true },
      artifacts: { desktop, ipad, defect_replay: defectReplay }
    }, { repoRoot });
    const runtimeBase = { commit: head, deployment_id: deploymentId };
    recordDeliveryEvidence('runtime', {
      provider_probe: evidenceEnvelope(repoRoot, 'provider-probe', { ...runtimeBase, success: true, provider: 'selftest', model: 'selftest-model' }),
      review_run: evidenceEnvelope(repoRoot, 'review-run', { ...runtimeBase, review_id: reviewId, status: 'COMPLETED' }),
      model_invocations: evidenceEnvelope(repoRoot, 'model-invocations', {
        ...runtimeBase,
        review_id: reviewId,
        invocation_ids: ['invocation-selftest'],
        invocations: [{
          id: 'invocation-selftest',
          review_id: reviewId,
          provider: 'selftest',
          model: 'selftest-model',
          status: 'completed',
          total_tokens: 42
        }]
      }),
      tokens: evidenceEnvelope(repoRoot, 'tokens', { ...runtimeBase, review_id: reviewId, total_tokens: 42 })
    }, { repoRoot });
    assert.strictEqual(transitionDeliveryState('clean_preview_green', { repoRoot }).ok, true);

    const branchEvidence = evidenceEnvelope(repoRoot, 'production-branch', {
      project_id: VERCEL_PRODUCTION_CONTRACT.projectId,
      branch: 'production',
      observed_at: new Date().toISOString(),
      source: 'selftest'
    });
    recordDeliveryEvidence('release_control', {
      production_branch: 'production',
      vercel_project_id: VERCEL_PRODUCTION_CONTRACT.projectId,
      production_branch_evidence: branchEvidence,
      production_commit_before: productionHead,
      production_deployment_id_before: SELFTEST_PRODUCTION_DEPLOYMENT_ID
    }, { repoRoot });
    const wrongBranchResponses = makeTestVercelApiResponses(productionHead);
    wrongBranchResponses.project.link.productionBranch = 'main';
    const wrongBranchGate = transitionDeliveryState('integration_ready', {
      repoRoot,
      testOnlyVercelApiResponses: wrongBranchResponses
    });
    assert.strictEqual(wrongBranchGate.ok, false);
    assert.ok(wrongBranchGate.blockers.some((blocker) => blocker.includes('productionBranch')));

    const wrongShaResponses = makeTestVercelApiResponses(productionHead);
    wrongShaResponses.deployment.gitSource.sha = 'f'.repeat(40);
    wrongShaResponses.deployment.meta.githubCommitSha = 'f'.repeat(40);
    const wrongShaGate = transitionDeliveryState('integration_ready', {
      repoRoot,
      testOnlyVercelApiResponses: wrongShaResponses
    });
    assert.strictEqual(wrongShaGate.ok, false);
    assert.ok(wrongShaGate.blockers.some((blocker) => blocker.includes('source SHA')));

    const conflictingShaResponses = makeTestVercelApiResponses(productionHead);
    conflictingShaResponses.deployment.meta.gitCommitSha = 'e'.repeat(40);
    const conflictingShaGate = transitionDeliveryState('integration_ready', {
      repoRoot,
      testOnlyVercelApiResponses: conflictingShaResponses
    });
    assert.strictEqual(conflictingShaGate.ok, false);
    assert.ok(conflictingShaGate.blockers.some((blocker) => blocker.includes('conflicting source SHAs')));

    // Domain ownership and deployment metadata alone are insufficient: the
    // product hostname must currently point at this exact production build.
    for (const patch of [
      { alias: 'other.example.invalid' },
      { projectId: 'prj_other' },
      { deploymentId: 'dpl_OldProduction' },
      { deployment: { id: 'dpl_ConflictingProduction' } },
      { redirect: 'https://other.example.invalid' },
      { deletedAt: Date.now() }
    ]) {
      const responses = makeTestVercelApiResponses(productionHead);
      Object.assign(responses.alias, patch);
      // Even a stale deployment list claiming the hostname must not pass.
      responses.deployment.alias = [VERCEL_PRODUCTION_CONTRACT.domain];
      const gate = transitionDeliveryState('integration_ready', { repoRoot, testOnlyVercelApiResponses: responses });
      assert.strictEqual(gate.ok, false);
      assert.ok(gate.blockers.some((blocker) => blocker.includes('alias')));
    }
    const missingAliasResponses = makeTestVercelApiResponses(productionHead);
    delete missingAliasResponses.alias;
    const missingAliasGate = transitionDeliveryState('integration_ready', { repoRoot, testOnlyVercelApiResponses: missingAliasResponses });
    assert.strictEqual(missingAliasGate.ok, false);
    assert.ok(missingAliasGate.blockers.some((blocker) => blocker.includes('alias')));

    const vercelGateOptions = {
      repoRoot,
      testOnlyVercelApiResponses: makeTestVercelApiResponses(productionHead)
    };
    assert.strictEqual(transitionDeliveryState('integration_ready', vercelGateOptions).ok, true);
    assert.strictEqual(sealDeliveryAttestation(vercelGateOptions).unchanged, false);
    runGit(repoRoot, ['push', '--quiet', 'origin', DELIVERY_ATTESTATION_REF]);
    assert.strictEqual(checkDeliveryStage('integration_ready', vercelGateOptions).ok, true);

    recordDeliveryEvidence('release_control', {
      production_commit_after: productionHead,
      production_deployment_id_after: SELFTEST_PRODUCTION_DEPLOYMENT_ID
    }, { repoRoot });
    const beforeMainPush = transitionDeliveryState('main_integrated', vercelGateOptions);
    assert.strictEqual(beforeMainPush.ok, false);
    assert.ok(beforeMainPush.blockers.some((blocker) => blocker.includes('origin/main')));
    runGit(repoRoot, ['push', '--quiet', 'origin', 'HEAD:main']);
    runGit(repoRoot, ['fetch', '--quiet', 'origin', 'main:refs/remotes/origin/main']);
    assert.strictEqual(transitionDeliveryState('main_integrated', vercelGateOptions).ok, true);
    assert.strictEqual(sealDeliveryAttestation(vercelGateOptions).unchanged, false);
    runGit(repoRoot, ['push', '--quiet', 'origin', DELIVERY_ATTESTATION_REF]);
    assert.strictEqual(checkDeliveryStage('main_integrated', vercelGateOptions).ok, true);
    const beforeProductionPush = transitionDeliveryState('production_released', vercelGateOptions);
    assert.strictEqual(beforeProductionPush.ok, false);
    assert.ok(beforeProductionPush.blockers.some((blocker) => blocker.includes('origin/production')));

    const runtimePath = getDeliveryStatus({ repoRoot }).evidenceStore;
    fs.unlinkSync(runtimePath);
    assert.strictEqual(checkDeliveryStage('main_integrated', vercelGateOptions).ok, true);
    const sameState = transitionDeliveryState('main_integrated', vercelGateOptions);
    assert.strictEqual(sameState.ok, true);
    assert.strictEqual(sameState.unchanged, true);
    assert.strictEqual(fs.existsSync(runtimePath), false);

    recordDeliveryEvidence('release_control', { post_note_observation: 'selftest' }, { repoRoot });
    const recovered = getDeliveryStatus({ repoRoot });
    assert.strictEqual(recovered.completionState, 'main_integrated');
    assert.strictEqual(recovered.evidence.code.commit, head);
    assert.strictEqual(recovered.attestationSealed, false);
    assert.strictEqual(sealDeliveryAttestation(vercelGateOptions).unchanged, false);
    runGit(repoRoot, ['push', '--quiet', 'origin', DELIVERY_ATTESTATION_REF]);
    assert.strictEqual(checkDeliveryStage('main_integrated', vercelGateOptions).ok, true);

    runGit(repoRoot, ['push', '--quiet', 'origin', 'HEAD:production']);
    recordDeliveryEvidence('release_control', {
      production_commit_released: head,
      production_deployment_id_released: SELFTEST_PRODUCTION_DEPLOYMENT_ID,
      production_domain_released: VERCEL_PRODUCTION_CONTRACT.domain,
      production_release_approval_id: 'IN-SELFTEST-FINAL-APPROVAL',
      production_release_clarification_id: 'IN-SELFTEST-CLARIFICATION',
      production_release_scope: 'selftest controlled Production runtime and release',
      production_release_commit_authorized: head,
      production_release_method: 'vercel_git_production_branch',
      production_released_at: new Date().toISOString()
    }, { repoRoot });
    const productionGateOptions = {
      repoRoot,
      testOnlyVercelApiResponses: makeTestVercelApiResponses(head)
    };
    const previewRuntimeCannotCloseProduction = transitionDeliveryState('production_released', productionGateOptions);
    assert.strictEqual(previewRuntimeCannotCloseProduction.ok, false);
    assert.ok(previewRuntimeCannotCloseProduction.blockers.some((blocker) => blocker.includes('Production runtime evidence')));

    const productionOrigin = `https://${VERCEL_PRODUCTION_CONTRACT.domain}`;
    const productionRuntimeBase = {
      commit: head,
      deployment_id: SELFTEST_PRODUCTION_DEPLOYMENT_ID,
      environment: 'production',
      origin: productionOrigin
    };
    const verifierRoot = 'production-runtime-verifier';
    const rawAttachment = (filename) => ({ filename, contents: Buffer.from(`selftest raw ${filename}\n`) });
    assert.throws(
      () => recordDeliveryEvidence('production_runtime', {}, { repoRoot }),
      /controlled live Production verifier/
    );
    recordDeliveryEvidence('production_runtime', {
      security_gate: evidenceEnvelope(repoRoot, 'production-security-gate', {
        ...productionRuntimeBase,
        source: 'live_production_database_verifier',
        gate_id: 'SECURITY-P0-RLS-PRODUCTION',
        status: 'passed',
        production_project_ref: 'selftest-production-project',
        checks: {
          catalog: 'pass',
          rls: 'pass',
          acl: 'pass',
          rpc: 'pass',
          advisor: 'pass',
          anon: 'pass',
          service_role: 'pass'
        }
      }, ['catalog', 'rls', 'acl', 'rpc', 'advisor', 'anon', 'service-role'].map((name) => rawAttachment(`${name}.json`)), verifierRoot),
      verifier: evidenceEnvelope(repoRoot, 'production-runtime-verifier', {
        ...productionRuntimeBase,
        source: 'live_production_runtime_verifier',
        review_id: reviewId,
        invocation_ids: ['production-invocation-selftest'],
        total_tokens: 42
      }, ['provider', 'review-run', 'model-invocations', 'tokens'].map((name) => rawAttachment(`${name}.json`)), verifierRoot),
      provider_probe: evidenceEnvelope(repoRoot, 'production-provider-probe', { ...productionRuntimeBase, source: 'production_api', success: true, provider: 'selftest', model: 'selftest-model' }, [rawAttachment('provider-response.json')], verifierRoot),
      review_run: evidenceEnvelope(repoRoot, 'production-review-run', { ...productionRuntimeBase, source: 'production_database', review_id: reviewId, status: 'COMPLETED' }, [rawAttachment('review-run-row.json')], verifierRoot),
      model_invocations: evidenceEnvelope(repoRoot, 'production-model-invocations', {
        ...productionRuntimeBase,
        source: 'production_database',
        review_id: reviewId,
        invocation_ids: ['production-invocation-selftest'],
        invocations: [{
          id: 'production-invocation-selftest',
          review_id: reviewId,
          provider: 'selftest',
          model: 'selftest-model',
          status: 'completed',
          total_tokens: 42
        }]
      }, [rawAttachment('model-invocation-rows.json')], verifierRoot),
      tokens: evidenceEnvelope(repoRoot, 'production-tokens', { ...productionRuntimeBase, source: 'production_database', review_id: reviewId, total_tokens: 42 }, [rawAttachment('token-aggregate.json')], verifierRoot)
    }, { repoRoot, testOnlyControlledProductionRuntime: true });
    const browserBase = {
      environment: 'production',
      attestation_type: 'trusted_operator_browser',
      trust_boundary: 'operator_attestation_not_machine_proof',
      attestation_method: 'codex_chrome_control_existing_session',
      attested_by: 'harness-selftest-operator',
      attested_at: new Date().toISOString(),
      existing_tab_id: 'selftest-existing-tab',
      browser_context: 'existing_user_chrome',
      new_browser_contexts: 0,
      new_tabs: 0,
      result: 'pass',
      commit: head,
      deployment_id: SELFTEST_PRODUCTION_DEPLOYMENT_ID
    };
    const forbiddenProductionBrowserCases = [
      { url: 'http://127.0.0.1:3000/configs?tab=ai', blocker: 'sales.cyanlog.icu' },
      { url: 'https://preview.example.invalid/configs?tab=ai', blocker: 'sales.cyanlog.icu' },
      { url: 'https://cyanlog-sales-v3-git-main.example.vercel.app/configs?tab=ai', blocker: 'sales.cyanlog.icu' },
      {
        url: `https://${VERCEL_PRODUCTION_CONTRACT.domain}/configs?tab=ai`,
        source_artifact: 'product-truth/product-code/output/playwright/wp09/acceptance.json',
        blocker: 'output/playwright'
      },
      { url: `https://${VERCEL_PRODUCTION_CONTRACT.domain}/configs?tab=ai`, new_tabs: 1, blocker: 'new browser tab' }
    ];
    for (const [index, testCase] of forbiddenProductionBrowserCases.entries()) {
      const { blocker, ...payload } = testCase;
      recordDeliveryEvidence('production', {
        commit: head,
        deployment_id: SELFTEST_PRODUCTION_DEPLOYMENT_ID,
        domain: VERCEL_PRODUCTION_CONTRACT.domain,
        browser_acceptance: evidenceEnvelope(repoRoot, `production-browser-forbidden-${index}`, {
          ...browserBase,
          ...payload
        })
      }, { repoRoot });
      const rejected = transitionDeliveryState('production_released', productionGateOptions);
      assert.strictEqual(rejected.ok, false);
      assert.ok(rejected.blockers.some((message) => message.includes(blocker)));
    }

    const productionBrowserAcceptance = evidenceEnvelope(repoRoot, 'production-browser', {
      ...browserBase,
      url: `https://${VERCEL_PRODUCTION_CONTRACT.domain}/configs?tab=ai`
    }, [{ filename: 'production-acceptance.png', contents: Buffer.from('selftest existing Chrome screenshot') }]);
    recordDeliveryEvidence('production', {
      commit: head,
      deployment_id: SELFTEST_PRODUCTION_DEPLOYMENT_ID,
      domain: VERCEL_PRODUCTION_CONTRACT.domain,
      browser_acceptance: productionBrowserAcceptance
    }, { repoRoot });
    assert.strictEqual(transitionDeliveryState('production_released', productionGateOptions).ok, true);
    assert.strictEqual(sealDeliveryAttestation(productionGateOptions).unchanged, false);
    runGit(repoRoot, ['push', '--quiet', 'origin', DELIVERY_ATTESTATION_REF]);
    assert.strictEqual(checkDeliveryStage('production_released', productionGateOptions).ok, true);

    const note = JSON.parse(runGit(repoRoot, ['notes', '--ref=price-v3-delivery', 'show', 'HEAD']));
    note.previousAttestationDigest = '0'.repeat(64);
    const tamperedPath = path.join(remoteRoot, 'tampered-note.json');
    writeJson(tamperedPath, note);
    runGit(repoRoot, ['notes', '--ref=price-v3-delivery', 'add', '-f', '-F', tamperedPath, 'HEAD']);
    assert.throws(() => getDeliveryStatus({ repoRoot }), /attestation digest mismatch|pointer mismatch/);
  } finally {
    fs.rmSync(remoteRoot, { recursive: true, force: true });
  }
}

function runSelftest(repoRoot) {
  runGit(repoRoot, ['init', '--quiet']);
  makeSettings(repoRoot);
  makeSchedulerFixture(repoRoot);

  const deploymentSha = 'a'.repeat(40);
  assert.deepStrictEqual(
    resolveVercelDeploymentCommit({ gitSource: { sha: deploymentSha } }).sha,
    deploymentSha
  );
  assert.deepStrictEqual(
    resolveVercelDeploymentCommit({ meta: { githubCommitSha: deploymentSha } }).sha,
    deploymentSha
  );
  assert.deepStrictEqual(
    resolveVercelDeploymentCommit({ meta: { gitCommitSha: deploymentSha } }).sha,
    deploymentSha
  );
  assert.strictEqual(
    resolveVercelDeploymentCommit({
      gitSource: { sha: deploymentSha },
      meta: { githubCommitSha: 'b'.repeat(40) }
    }).conflict,
    true
  );

  const started = core.startGoal(repoRoot, 'Build a safe long-task harness', {
    level: 'A0',
    workPackageId: 'WP99'
  });
  assert.strictEqual(started.state.mode, 'enforcing');
  assert.deepStrictEqual(started.state.activeGates, ['HG0']);
  assert.strictEqual(started.contract.status, 'draft');
  assert.ok(started.contract.successCriteria.length > 0);

  assert.strictEqual(core.evaluateToolUse(repoRoot, { tool_name: 'Read' }).ok, true);
  const blockedBash = core.evaluateToolUse(repoRoot, {
    tool_name: 'Bash',
    tool_input: { cmd: 'echo ok' }
  });
  assert.strictEqual(blockedBash.ok, false);
  assert.match(blockedBash.reason, /not allowed/);

  assert.throws(() => core.setPhase(repoRoot, 'execute'), /does not allow edits|approved/);

  const approved = core.approveContract(repoRoot, { level: 'A1', by: 'selftest' });
  assert.strictEqual(approved.status, 'approved');
  assert.strictEqual(approved.autonomyBudget.level, 'A1');
  assert.ok(approved.autonomyBudget.allowed.includes('run local verification commands'));
  assert.ok(approved.autonomyBudget.allowed.includes('edit scoped workspace files after contract approval'));

  const revised = core.reviseContract(repoRoot, 'Build a safe long-task harness with revised delivery truth', {
    reason: 'selftest user corrected the terminal state',
    authority: 'IN-SELFTEST-CLARIFICATION',
    by: 'selftest',
    success: 'revised goal is explicit,previous evidence remains auditable'
  });
  assert.strictEqual(revised.status, 'draft');
  assert.strictEqual(revised.revisions.length, 1);
  assert.strictEqual(core.loadState(repoRoot).activeGates[0], 'HG2');
  const reapproved = core.approveContract(repoRoot, { level: 'A1', by: 'selftest' });
  assert.strictEqual(reapproved.status, 'approved');
  assert.strictEqual(reapproved.objective, revised.objective);

  assert.throws(() => core.setPhase(repoRoot, 'execute'), /allowedScopes/);

  const scopedContract = core.loadContract(repoRoot);
  scopedContract.boundaries.allowedScopes = ['governance/runtime-config-AI运行配置'];
  core.saveContract(repoRoot, scopedContract);
  assert.throws(() => core.setPhase(repoRoot, 'execute'), /research-check/);

  const researchContract = core.loadContract(repoRoot);
  core.recordEvidence(repoRoot, {
    type: 'research',
    status: 'pass',
    summary: 'selftest research checks',
    detail: 'Repository pattern scan, reuse scan, best-practice check, and user-intent boundary check were satisfied for selftest.',
    satisfies: researchContract.researchPlan.requiredChecks.map((item) => `research-check:${item.id || item}`)
  });

  const execution = core.setPhase(repoRoot, 'execute');
  assert.deepStrictEqual(execution.state.activeGates, ['HG3']);
  assert.deepStrictEqual(execution.state.activeHooks, ['UserPromptSubmit', 'PreToolUse', 'Stop']);

  const schedulerValid = validateSchedulerState({ repoRoot });
  assert.deepStrictEqual(schedulerValid.errors, []);

  const redirectedWorktreePath = path.join(repoRoot, 'redirected-worktree');
  fs.mkdirSync(redirectedWorktreePath, { recursive: true });
  runGit(repoRoot, ['config', '--local', 'core.worktree', redirectedWorktreePath]);
  const redirectedWorktree = validateSchedulerState({ repoRoot });
  assert.strictEqual(redirectedWorktree.ok, false);
  assert.ok(redirectedWorktree.errors.some((error) => error.includes('core.worktree must be unset')));
  runGit(repoRoot, ['config', '--local', '--unset-all', 'core.worktree']);
  assert.deepStrictEqual(validateSchedulerState({ repoRoot }).errors, []);

  runGit(repoRoot, ['config', 'extensions.worktreeConfig', 'true']);
  runGit(repoRoot, ['config', '--worktree', 'core.worktree', redirectedWorktreePath]);
  const scopedWorktreeRedirect = validateSchedulerState({ repoRoot });
  assert.strictEqual(scopedWorktreeRedirect.ok, false);
  assert.ok(scopedWorktreeRedirect.errors.some((error) => error.includes('core.worktree must be unset')));
  runGit(repoRoot, ['config', '--worktree', '--unset-all', 'core.worktree']);
  assert.deepStrictEqual(validateSchedulerState({ repoRoot }).errors, []);

  const previousGitWorkTree = process.env.GIT_WORK_TREE;
  process.env.GIT_WORK_TREE = redirectedWorktreePath;
  try {
    const environmentWorktreeRedirect = validateSchedulerState({ repoRoot });
    assert.strictEqual(environmentWorktreeRedirect.ok, false);
    assert.ok(environmentWorktreeRedirect.errors.some((error) => error.includes('GIT_WORK_TREE must be unset')));
    // The override remains prohibited, but isolated Git reads must no longer
    // follow it into the other repository while checking the violation.
    assert.ok(!environmentWorktreeRedirect.errors.some((error) => error.includes('Git top-level mismatch')));
  } finally {
    if (previousGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = previousGitWorkTree;
  }
  assert.deepStrictEqual(validateSchedulerState({ repoRoot }).errors, []);

  const schedulerPath = path.join(repoRoot, 'governance/runtime-state/active-task.json');
  const dynamicInjection = JSON.parse(fs.readFileSync(schedulerPath, 'utf8'));
  dynamicInjection.active_task.delivery_contract.evidence = { code: { checks: { build: true } } };
  writeJson(schedulerPath, dynamicInjection);
  const dynamicInjectionResult = validateSchedulerState({ repoRoot });
  assert.strictEqual(dynamicInjectionResult.ok, false);
  assert.ok(dynamicInjectionResult.errors.some((error) => error.includes('dynamic runtime key: evidence')));
  delete dynamicInjection.active_task.delivery_contract.evidence;
  writeJson(schedulerPath, dynamicInjection);

  const matchingState = core.loadState(repoRoot);
  matchingState.currentGoal.id = 'goal-mismatch';
  core.saveState(repoRoot, matchingState);
  const goalMismatch = validateSchedulerState({ repoRoot });
  assert.strictEqual(goalMismatch.ok, false);
  assert.ok(goalMismatch.errors.some((error) => error.includes('Harness goal mismatch')));

  matchingState.currentGoal.id = core.loadContract(repoRoot).id;
  matchingState.phase = 'verify';
  matchingState.activeGates = ['HG4'];
  core.saveState(repoRoot, matchingState);
  const phaseGateMismatch = validateSchedulerState({ repoRoot });
  assert.strictEqual(phaseGateMismatch.ok, false);
  assert.ok(phaseGateMismatch.errors.some((error) => error.includes('Harness phase mismatch')));
  assert.ok(phaseGateMismatch.errors.some((error) => error.includes('Harness gate mismatch')));
  core.saveState(repoRoot, execution.state);

  assert.strictEqual(core.evaluateToolUse(repoRoot, {
    tool_name: 'Bash',
    tool_input: { cmd: 'echo ok' }
  }).ok, true);

  const destructive = core.evaluateToolUse(repoRoot, {
    tool_name: 'Bash',
    tool_input: { cmd: 'git reset --hard HEAD' }
  });
  assert.strictEqual(destructive.ok, false);
  assert.strictEqual(destructive.risk, 'destructive git reset');
  assert.ok(destructive.matrix.rows.some((row) => row.id === 'external_side_effect'));

  const driftDeploy = core.evaluateToolUse(repoRoot, {
    tool_name: 'Bash',
    tool_input: { cmd: 'vercel deploy -y' }
  });
  assert.strictEqual(driftDeploy.ok, false);
  assert.match(driftDeploy.reason, /target drift/);
  assert.strictEqual(driftDeploy.matrix.targetObject, 'business-deploy');

  const runtimeStateEdit = core.evaluateToolUse(repoRoot, {
    tool_name: 'Write',
    tool_input: { file_path: core.paths(repoRoot).statePath }
  });
  assert.strictEqual(runtimeStateEdit.ok, false);
  assert.match(runtimeStateEdit.reason, /runtime state is forbidden/);

  const controlPlaneEdit = core.evaluateToolUse(repoRoot, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(repoRoot, '.codex/hooks.json') }
  });
  assert.strictEqual(controlPlaneEdit.ok, false);
  assert.match(controlPlaneEdit.reason, /control-plane edit requires explicit allowed scope/);

  const harnessScopedContract = core.loadContract(repoRoot);
  harnessScopedContract.boundaries.allowedScopes = ['harness-control-plane'];
  core.saveContract(repoRoot, harnessScopedContract);

  const scopedControlPlaneEdit = core.evaluateToolUse(repoRoot, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(repoRoot, '.codex/hooks.json') }
  });
  assert.strictEqual(scopedControlPlaneEdit.ok, true);
  assert.strictEqual(scopedControlPlaneEdit.matrix.highImpact, true);

  const businessAppDrift = core.evaluateToolUse(repoRoot, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(repoRoot, 'product-truth/product-code/app/page.tsx') }
  });
  assert.strictEqual(businessAppDrift.ok, false);
  assert.match(businessAppDrift.reason, /target drift/);
  assert.strictEqual(businessAppDrift.matrix.targetObject, 'business-app');

  const docContract = core.loadContract(repoRoot);
  docContract.boundaries.allowedScopes = ['harness-control-plane', 'product-truth/feature-packets'];
  core.saveContract(repoRoot, docContract);

  const randomDoc = core.evaluateToolUse(repoRoot, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(repoRoot, 'docs-governance/random-new-doc.md') }
  });
  assert.strictEqual(randomDoc.ok, false);
  assert.match(randomDoc.reason, /document-governance registration/);
  assert.ok(randomDoc.matrix.rows.some((row) => row.id === 'document_governance' && row.status === 'block'));

  const allowedFeaturePacket = core.evaluateToolUse(repoRoot, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(repoRoot, 'product-truth/feature-packets/F999-selftest.md') }
  });
  assert.strictEqual(allowedFeaturePacket.ok, true);
  assert.ok(allowedFeaturePacket.matrix.rows.some((row) => row.id === 'document_governance' && row.status === 'pass'));

  const runtimeStateStillBlocked = core.evaluateToolUse(repoRoot, {
    tool_name: 'Write',
    tool_input: { file_path: core.paths(repoRoot).statePath }
  });
  assert.strictEqual(runtimeStateStillBlocked.ok, false);
  assert.match(runtimeStateStillBlocked.reason, /runtime state is forbidden/);

  const evidence = core.recordEvidence(repoRoot, {
    type: 'command',
    status: 'pass',
    summary: 'selftest command evidence'
  });
  assert.strictEqual(evidence.status, 'pass');
  assert.strictEqual(fs.existsSync(core.paths(repoRoot).evidenceLedgerPath), true);

  const blockedCompletion = core.completionAudit(repoRoot);
  assert.strictEqual(blockedCompletion.ok, false);
  assert.ok(blockedCompletion.rows.some((row) => row.id === 'checkpoints' && row.status === 'block'));
  assert.throws(() => core.setPhase(repoRoot, 'complete'), /completion audit failed/);

  const completionContract = core.loadContract(repoRoot);
  for (const checkpoint of completionContract.checkpoints) {
    core.updateCheckpoint(repoRoot, { name: checkpoint.name, status: 'pass', detail: 'selftest checkpoint satisfied' });
  }
  const criteriaContract = core.loadContract(repoRoot);
  core.recordEvidence(repoRoot, {
    type: 'completion',
    status: 'pass',
    summary: 'selftest completion evidence',
    detail: 'Satisfies every success criterion and required evidence class for the selftest goal.',
    satisfies: [
      ...criteriaContract.successCriteria,
      ...criteriaContract.evidence.required
    ]
  });
  core.setPhase(repoRoot, 'verify');
  const passingCompletion = core.completionAudit(repoRoot);
  assert.strictEqual(passingCompletion.ok, true);
  runShippingContractSelftest(repoRoot);
  runDeliverySelftest(repoRoot);
  const completed = core.completeGoal(repoRoot, { by: 'selftest' });
  assert.strictEqual(completed.contract.status, 'complete');
  assert.strictEqual(completed.state.mode, 'permissive');

  const checks = core.runtimeValidation(repoRoot);
  assert.deepStrictEqual(checks, []);

  const cleared = core.clearGoal(repoRoot);
  assert.strictEqual(cleared.mode, 'permissive');
  assert.strictEqual(fs.existsSync(core.paths(repoRoot).contractPath), false);

  console.log('harness selftest ok');
}

function runActionApprovalSelftest(repoRoot) {
  runGit(repoRoot, ['init', '--quiet']);
  runGit(repoRoot, ['config', 'user.email', 'test@example.invalid']);
  runGit(repoRoot, ['config', 'user.name', 'Harness test']);
  makeSettings(repoRoot);
  makeSchedulerFixture(repoRoot);
  fs.writeFileSync(path.join(repoRoot, '.gitignore'), '.runtime/\n');
  writeJson(path.join(repoRoot, '.vercel/project.json'), { projectId: 'prj_test', orgId: 'team_test' });
  core.startGoal(repoRoot, 'Validate shipping preview', { level: 'A3', workPackageId: 'WP99', scopes: 'product-truth/product-code' });
  core.approveContract(repoRoot, { level: 'A3', by: 'selftest' });
  core.recordEvidence(repoRoot, { status: 'pass', summary: 'fixture research', satisfies: core.loadContract(repoRoot).researchPlan.requiredChecks.map((item) => `research-check:${item.id}`) });
  core.setPhase(repoRoot, 'execute');
  const command = 'vercel deploy --target preview --scope team_test';
  const authority = 'IN-SELFTEST-ACTION';
  const inboxPath = path.join(repoRoot, 'governance/runtime-state/demand-inbox.jsonl');
  fs.writeFileSync(inboxPath, JSON.stringify({ id: authority, state: 'user_authorized', action_approval: {
    by: 'user', target: 'team_test/prj_test', environment: 'preview', cwd: fs.realpathSync(repoRoot),
    commandHash: crypto.createHash('sha256').update(command).digest('hex')
  } }) + '\n');
  runGit(repoRoot, ['add', '.']);
  runGit(repoRoot, ['commit', '--quiet', '-m', 'approval fixture']);
  const request = { command, cwd: repoRoot, authority, expiresAt: new Date(Date.now() + 600000).toISOString() };
  const evaluate = (cmd = command, workdir = repoRoot) => core.evaluateToolUse(repoRoot, { tool_name: 'Bash', tool_input: { cmd, workdir } });
  assert.strictEqual(evaluate().ok, false);
  assert.throws(() => core.approveAction(repoRoot, { ...request, authority: 'missing' }), /authority/);
  assert.throws(() => core.approveAction(repoRoot, { ...request, expiresAt: 'invalid' }), /expiry/);
  assert.throws(() => core.approveAction(repoRoot, { ...request, command: command + ' --prod' }), /unsupported/);
  assert.throws(() => core.approveAction(repoRoot, { ...request, command: command + '; echo extra' }), /literal/);
  core.approveAction(repoRoot, request);
  const previousProject = process.env.VERCEL_PROJECT_ID;
  try {
    process.env.VERCEL_PROJECT_ID = 'prj_other';
    assert.strictEqual(evaluate().ok, false);
  } finally {
    if (previousProject === undefined) delete process.env.VERCEL_PROJECT_ID;
    else process.env.VERCEL_PROJECT_ID = previousProject;
  }
  assert.throws(() => core.approveAction(repoRoot, request), /EEXIST/);
  const retryReason = 'Transport failed after allowance; remote state checked unchanged.';
  const initialGrant = core.readJson(core.actionApprovalPath(repoRoot, core.actionBinding(repoRoot, command, repoRoot)));
  assert.throws(() => core.approveAction(repoRoot, { ...request, retryOf: initialGrant.id, retryReason }), /latest consumed/);
  assert.strictEqual(evaluate(command + ' --yes').ok, false);
  assert.strictEqual(evaluate(command, os.tmpdir()).ok, false);
  const approvalFile = core.actionApprovalPath(repoRoot, core.actionBinding(repoRoot, command, repoRoot));
  const original = core.readJson(approvalFile);
  for (const replacement of [{ expiresAt: '2000-01-01' }, { head: 'wrong' }, { goalHash: 'wrong' }, { target: 'wrong' }, { environment: 'production' }]) {
    writeJson(approvalFile, { ...original, ...replacement });
    assert.strictEqual(evaluate().ok, false);
  }
  writeJson(approvalFile, original);
  fs.writeFileSync(path.join(repoRoot, 'dirty.txt'), 'changed');
  assert.strictEqual(evaluate().ok, false);
  fs.unlinkSync(path.join(repoRoot, 'dirty.txt'));
  const state = core.loadState(repoRoot);
  core.saveState(repoRoot, { ...state, activeGates: ['HG2'] });
  assert.strictEqual(evaluate().ok, false);
  core.saveState(repoRoot, state);
  assert.strictEqual(evaluate().ok, true);
  assert.strictEqual(evaluate().ok, false);
  assert.throws(() => core.approveAction(repoRoot, { ...request, retryOf: 'wrong-id', retryReason }), /latest consumed/);
  assert.throws(() => core.approveAction(repoRoot, { ...request, retryOf: original.id, retryReason: '' }), /latest consumed/);
  const retried = core.approveAction(repoRoot, { ...request, retryOf: original.id, retryReason });
  assert.notStrictEqual(retried.id, original.id);
  assert.strictEqual(core.readJson(approvalFile).id, original.id);
  assert.ok(fs.existsSync(`${approvalFile}.consumed`));
  assert.throws(() => core.approveAction(repoRoot, { ...request, retryOf: original.id, retryReason }), /latest consumed/);
  assert.strictEqual(evaluate().ok, true);
  assert.strictEqual(evaluate().ok, false);
  const read = 'cat /tmp/vercel/skills/vercel-cli/references/deployment.md';
  assert.strictEqual(evaluate(read).ok, true);
  assert.strictEqual(evaluate(read + '; vercel deploy --prod').ok, false);
  const patch = (target) => `*** Begin Patch\n*** Update File: ${target}\n@@\n+vercel deploy --prod\n*** End Patch`;
  assert.strictEqual(core.evaluateToolUse(repoRoot, { tool_name: 'apply_patch', command: patch('product-truth/product-code/test.js') }).ok, true);
  assert.strictEqual(core.evaluateToolUse(repoRoot, { tool_name: 'apply_patch', command: patch('.codex/hooks.json') }).ok, false);
  assert.strictEqual(core.evaluateToolUse(repoRoot, { tool_name: 'apply_patch', command: patch(core.paths(repoRoot).statePath) }).ok, false);
  const mixedPatch = patch('product-truth/product-code/test.js').replace('*** End Patch', '*** Add File: outside.js\n+example\n*** End Patch');
  assert.strictEqual(core.evaluateToolUse(repoRoot, { tool_name: 'apply_patch', command: mixedPatch }).ok, false);
  for (const tool of ['mcp__codex_apps__vercel__get_deployment', 'mcp__codex_apps__vercel__get_project', 'mcp__codex_app__list_artifacts']) assert.strictEqual(core.normalizeToolName(tool), 'Read');
  for (const tool of ['mcp__other__get_deployment', 'mcp__codex_apps__vercel__create_deployment', 'mcp__codex_app__archive_worktree']) assert.notStrictEqual(core.normalizeToolName(tool), 'Read');

  const productionCommand = 'vercel deploy --prod --skip-domain --scope team_test --yes';
  const releaseId = 'IN-SELFTEST-PRODUCTION', actionId = 'IN-SELFTEST-PRODUCTION-ACTION';
  const schedulerPath = path.join(repoRoot, 'governance/runtime-state/active-task.json');
  const scheduler = core.readJson(schedulerPath);
  scheduler.active_task.delivery_contract = { final_acceptance: { production_database_mode: 'read_only' }, production_release_authorization: { status: 'approved_code_only', final_release_approval_id: releaseId, final_scope: 'UI only', vercel_team_id: 'team_test', vercel_project_id: 'prj_test' } };
  writeJson(schedulerPath, scheduler);
  fs.appendFileSync(inboxPath, JSON.stringify({ id: releaseId, type: 'final_production_release_authorization', state: 'approved', source: 'user_explicit', scope: 'UI only', code_release_authorized: true, production_database_write_authorized: false, authorized_commit_binding: 'delivery_attestation_current_head' })+'\n');
  fs.appendFileSync(inboxPath, JSON.stringify({ id: actionId, state: 'user_authorized', action_approval: { by: 'user', target: 'team_test/prj_test', environment: 'production', cwd: fs.realpathSync(repoRoot), commandHash: crypto.createHash('sha256').update(productionCommand).digest('hex'), commandKind: 'staged_production_deploy', releaseAuthority: releaseId } })+'\n');
  runGit(repoRoot, ['add', '.']); runGit(repoRoot, ['commit', '--quiet', '-m', 'code-only release authority fixture']);
  const productionRequest = { command: productionCommand, cwd: repoRoot, authority: actionId, expiresAt: new Date(Date.now()+600000).toISOString() };
  assert.strictEqual(evaluate(productionCommand).ok, false);
  assert.throws(() => core.approveAction(repoRoot, { ...productionRequest, command: productionCommand.replace(' --skip-domain', '') }), /unsupported/);
  core.approveAction(repoRoot, productionRequest);
  const productionApproval = core.actionApprovalPath(repoRoot, core.actionBinding(repoRoot, productionCommand, repoRoot));
  const productionOriginal = core.readJson(productionApproval);
  for (const replacement of [{ head: 'wrong' }, { target: 'team_other/prj_other' }, { expiresAt: '2000-01-01' }, { environment: 'preview' }]) {
    writeJson(productionApproval, { ...productionOriginal, ...replacement });
    assert.strictEqual(evaluate(productionCommand).ok, false);
  }
  writeJson(productionApproval, productionOriginal);
  assert.strictEqual(evaluate('vercel promote dpl_other --scope team_test --yes').ok, false);
  assert.strictEqual(evaluate(productionCommand).ok, true);
  assert.strictEqual(evaluate(productionCommand).ok, false);
  runGit(repoRoot, ['remote', 'add', 'origin', 'https://github.com/ChenYuan-Eoin/cyanlog-sales-v3.git']);
  const push = 'git push origin HEAD:refs/heads/codex/test';
  const boundPush = core.actionBinding(repoRoot, push, repoRoot);
  assert.strictEqual(boundPush.head, runGit(repoRoot, ['rev-parse', 'HEAD']).trim());
  assert.strictEqual(boundPush.action, 'release_git_push');
  assert.strictEqual(evaluate(push).ok, false);
  const productionContract = require('./project-registry').VERCEL_PRODUCTION_CONTRACT;
  Object.assign(scheduler.active_task.delivery_contract.production_release_authorization, { vercel_team_id: productionContract.teamId, vercel_project_id: productionContract.projectId });
  writeJson(schedulerPath, scheduler);
  fs.appendFileSync(inboxPath, JSON.stringify({ id: 'IN-PUSH-ACTION', state: 'user_authorized', action_approval: { by: 'user', target: boundPush.target, environment: 'production', cwd: fs.realpathSync(repoRoot), commandHash: boundPush.commandHash, commandKind: 'release_git_push', releaseAuthority: releaseId } })+'\n');
  runGit(repoRoot, ['add', '.']); runGit(repoRoot, ['commit', '--quiet', '-m', 'git release action authority fixture']);
  core.approveAction(repoRoot, { command: push, cwd: repoRoot, authority: 'IN-PUSH-ACTION', expiresAt: new Date(Date.now()+600000).toISOString() });
  assert.strictEqual(evaluate(push).ok, true);
  assert.strictEqual(evaluate(push).ok, false);
  assert.throws(() => core.actionBinding(repoRoot, 'git push --force origin HEAD:refs/heads/production', repoRoot), /unsupported/);
  const explicitPush = `git -C ${repoRoot} push origin HEAD:refs/heads/codex/test`;
  const explicitBinding = core.actionBinding(repoRoot, explicitPush, repoRoot);
  assert.strictEqual(explicitBinding.workspace, fs.realpathSync(repoRoot));
  fs.appendFileSync(inboxPath, JSON.stringify({ id: 'IN-EXPLICIT-PUSH', state: 'user_authorized', action_approval: { by: 'user', target: explicitBinding.target, environment: 'production', cwd: fs.realpathSync(repoRoot), commandHash: explicitBinding.commandHash, commandKind: 'release_git_push', releaseAuthority: releaseId } })+'\n');
  runGit(repoRoot, ['add', '.']); runGit(repoRoot, ['commit', '--quiet', '-m', 'explicit worktree action authority fixture']);
  assert.strictEqual(core.evaluateToolUse(repoRoot, { tool_name: 'Bash', tool_input: { command: explicitPush } }).ok, false);
  core.approveAction(repoRoot, { command: explicitPush, cwd: repoRoot, authority: 'IN-EXPLICIT-PUSH', expiresAt: new Date(Date.now()+600000).toISOString() });
  assert.strictEqual(core.evaluateToolUse(repoRoot, { tool_name: 'Bash', tool_input: { command: explicitPush } }).ok, true);
  assert.strictEqual(core.evaluateToolUse(repoRoot, { tool_name: 'Bash', tool_input: { command: explicitPush } }).ok, false);
  assert.throws(() => core.actionBinding(repoRoot, 'git push origin HEAD:refs/heads/unapproved', repoRoot), /unsupported/);
  runGit(repoRoot, ['notes', '--ref=price-v3-delivery', 'add', '-m', 'first evidence']);
  const notePush = 'git push origin refs/notes/price-v3-delivery';
  const noteBinding = core.actionBinding(repoRoot, notePush, repoRoot);
  runGit(repoRoot, ['notes', '--ref=price-v3-delivery', 'append', '-m', 'second evidence']);
  assert.notStrictEqual(core.actionBinding(repoRoot, notePush, repoRoot).refObject, noteBinding.refObject);
  assert.notStrictEqual(core.actionApprovalPath(repoRoot, core.actionBinding(repoRoot, notePush, repoRoot)), core.actionApprovalPath(repoRoot, noteBinding));
  runGit(repoRoot, ['remote', 'set-url', 'origin', 'https://github.com/other/repo.git']);
  assert.throws(() => core.actionBinding(repoRoot, push, repoRoot), /remote/);
  console.log('action approval and classification selftest ok');
}

function runVercelHttpsTransportSelftest(repoRoot) {
  const vm = require('vm');
  // Test stubs exist only in this isolated, selftest-registry VM. No production
  // export, response override or environment switch is added.
  writeJson(path.join(repoRoot, 'governance/runtime-config-AI运行配置/config-配置文件/project-governance-项目治理注册表.json'), { version: 'selftest' });
  const registrySource = fs.readFileSync(path.join(__dirname, 'project-registry.js'), 'utf8');
  const fixtureToken = 'example_existing_vercel_fixture_credential';
  const query = `teamId=${VERCEL_PRODUCTION_CONTRACT.teamId}`;
  const endpoints = [
    `/v9/projects/${VERCEL_PRODUCTION_CONTRACT.projectId}?${query}`,
    `/v9/projects/${VERCEL_PRODUCTION_CONTRACT.projectId}/domains/${VERCEL_PRODUCTION_CONTRACT.domain}?${query}`,
    `/v4/aliases/${VERCEL_PRODUCTION_CONTRACT.domain}?${query}`,
    `/v13/deployments/${SELFTEST_PRODUCTION_DEPLOYMENT_ID}?${query}`
  ];
  const endpoint = endpoints[2];
  const fixtureSha = 'a'.repeat(40);
  const bodies = [
    { id: VERCEL_PRODUCTION_CONTRACT.projectId, name: VERCEL_PRODUCTION_CONTRACT.projectName,
      accountId: VERCEL_PRODUCTION_CONTRACT.teamId, rootDirectory: VERCEL_PRODUCTION_CONTRACT.rootDirectory,
      link: { productionBranch: 'production' }, targets: { production: { id: SELFTEST_PRODUCTION_DEPLOYMENT_ID } } },
    { name: VERCEL_PRODUCTION_CONTRACT.domain, projectId: VERCEL_PRODUCTION_CONTRACT.projectId, verified: true },
    { alias: VERCEL_PRODUCTION_CONTRACT.domain, projectId: VERCEL_PRODUCTION_CONTRACT.projectId,
      deploymentId: SELFTEST_PRODUCTION_DEPLOYMENT_ID, deployment: { id: SELFTEST_PRODUCTION_DEPLOYMENT_ID } },
    { id: SELFTEST_PRODUCTION_DEPLOYMENT_ID, name: VERCEL_PRODUCTION_CONTRACT.projectName,
      project: { id: VERCEL_PRODUCTION_CONTRACT.projectId, name: VERCEL_PRODUCTION_CONTRACT.projectName },
      team: { id: VERCEL_PRODUCTION_CONTRACT.teamId }, target: 'production', readyState: 'READY',
      status: 'READY', readySubstate: 'PROMOTED', gitSource: { sha: fixtureSha } }
  ];
  const envelope = indices => ({ responses: indices.map(index => ({ endpoint: endpoints[index], status: 200, raw: JSON.stringify(bodies[index]) })) });
  const success = indices => ({ status: 0, stdout: JSON.stringify(envelope(indices)) });
  function fixture(options = {}) {
    const calls = [];
    const realRequire = require;
    const fakeFs = {
      ...fs,
      realpathSync: value => value === '/vendor/vercel/dist/vc.js' ? value : fs.realpathSync(value),
      readFileSync: (file, encoding) => {
        if (file === '/vendor/vercel/package.json') return JSON.stringify({ name: options.packageName || 'vercel' });
        if (file === '/vendor/vercel/dist/index.js') return 'import { getAuthConfigFilePath } from "./chunks/chunk-selftest.js";';
        if (file === '/private/existing-vercel-auth.json') return options.authText ?? JSON.stringify({ token: options.token ?? fixtureToken });
        return fs.readFileSync(file, encoding);
      }
    };
    const fakeRequire = name => {
      if (name === 'fs') return fakeFs;
      if (name === 'child_process') return { ...require('child_process'), spawnSync: (command, args, opts) => {
        calls.push({ command, args, opts });
        if (command === 'which') return { status: 0, stdout: '/vendor/vercel/dist/vc.js\n' };
        if (command === 'git') {
          assert.deepStrictEqual(Array.from(args), ['rev-parse', '--path-format=absolute', '--git-path', 'codex-runtime']);
          return { status: 0, stdout: path.join(repoRoot, '.runtime', 'delivery') + '\n' };
        }
        assert.strictEqual(command, process.execPath);
        return options.result || success(JSON.parse(opts.input).mode === 'production' ? [0, 1, 2, 3] : [endpoints.indexOf(JSON.parse(opts.input).endpoint)]);
      } };
      if (name === '/vendor/vercel/dist/chunks/chunk-selftest.js') return { getAuthConfigFilePath: () => '/private/existing-vercel-auth.json' };
      return realRequire(name);
    };
    fakeRequire.main = require.main;
    const moduleCopy = { exports: {} };
    vm.runInNewContext(registrySource + '\nmodule.exports.__selftestLiveRead = runVercelApi; module.exports.__selftestBatch = runVercelProductionBatch; module.exports.__selftestVerify = verifyVercelProductionState; module.exports.__selftestConnectorPayload = verifyVercelConnectorPayload;', {
      require: fakeRequire, module: moduleCopy, exports: moduleCopy.exports,
      process, __dirname, __filename: path.join(__dirname, 'project-registry.js'), console, Buffer, URL
    }, { filename: 'selftest-live-vercel-transport.js' });
    return { read: moduleCopy.exports.__selftestLiveRead, batch: moduleCopy.exports.__selftestBatch, verify: moduleCopy.exports.__selftestVerify, connectorPayload: moduleCopy.exports.__selftestConnectorPayload, calls };
  }
  const valid = fixture();
  const response = valid.read(repoRoot, endpoint);
  assert.strictEqual(response.parsed.alias, 'sales.cyanlog.icu');
  const call = valid.calls.find(item => item.command === process.execPath);
  assert.strictEqual(call.args[0], '--input-type=commonjs');
  assert.strictEqual(call.args[1], '-e');
  assert.strictEqual(call.opts.timeout, 35000);
  assert.strictEqual(call.opts.maxBuffer, 25 * 1024 * 1024);
  assert.deepStrictEqual(JSON.parse(call.opts.input), { endpoint, token: fixtureToken });
  assert.deepStrictEqual(Object.keys(call.opts.env), [], 'child must inherit no TLS/debug/preload/proxy/secret environment');
  assert(!JSON.stringify(call.args).includes(fixtureToken));
  assert.strictEqual(call.args.length, 3);
  assert.deepStrictEqual(Array.from(call.opts.stdio), ['pipe', 'pipe', 'pipe']);
  const batchFixture = fixture();
  const batchResponse = batchFixture.batch(repoRoot);
  assert.deepStrictEqual(Object.keys(batchResponse), ['project', 'domain', 'alias', 'deployment']);
  assert.strictEqual(batchResponse.deployment.parsed.id, SELFTEST_PRODUCTION_DEPLOYMENT_ID);
  assert.strictEqual(batchFixture.calls.filter(item => item.command === process.execPath).length, 1);
  assert.deepStrictEqual(JSON.parse(batchFixture.calls.find(item => item.command === process.execPath).opts.input), { token: fixtureToken, mode: 'production' });
  const verifierFixture = fixture();
  assert.strictEqual(verifierFixture.verify(repoRoot, fixtureSha).ok, true);
  assert.strictEqual(verifierFixture.calls.filter(item => item.command === process.execPath).length, 1, 'formal verifier must collect all four reads in one child');
  const observedAt = new Date().toISOString();
  const connectorReceipt = {
    source: 'vercel_mcp_connector', approval_id: 'IN-20261112-002', observed_at: observedAt, commit: fixtureSha,
    project: { id: VERCEL_PRODUCTION_CONTRACT.projectId, name: VERCEL_PRODUCTION_CONTRACT.projectName,
      accountId: VERCEL_PRODUCTION_CONTRACT.teamId,
      latestDeployment: { id: SELFTEST_PRODUCTION_DEPLOYMENT_ID, target: 'production', readyState: 'READY' } },
    domain: { name: VERCEL_PRODUCTION_CONTRACT.domain, projectId: VERCEL_PRODUCTION_CONTRACT.projectId, verified: true },
    alias: { alias: VERCEL_PRODUCTION_CONTRACT.domain, projectId: VERCEL_PRODUCTION_CONTRACT.projectId,
      deploymentId: SELFTEST_PRODUCTION_DEPLOYMENT_ID, deployment: { id: SELFTEST_PRODUCTION_DEPLOYMENT_ID },
      redirect: null, deletedAt: null },
    deployment: { id: SELFTEST_PRODUCTION_DEPLOYMENT_ID, name: VERCEL_PRODUCTION_CONTRACT.projectName,
      project: { id: VERCEL_PRODUCTION_CONTRACT.projectId, name: VERCEL_PRODUCTION_CONTRACT.projectName },
      target: 'production', readyState: 'READY', state: 'READY',
      meta: { githubCommitRef: 'production', githubCommitSha: fixtureSha },
      alias: [VERCEL_PRODUCTION_CONTRACT.domain] }
  };
  const connector = verifierFixture.connectorPayload;
  assert.strictEqual(connector(connectorReceipt, fixtureSha, observedAt, { artifact_path: 'receipt.json', sha256: 'a'.repeat(64) }).ok, true);
  const previewLatestReceipt = JSON.parse(JSON.stringify(connectorReceipt));
  previewLatestReceipt.project.latestDeployment = { id: 'dpl_Preview', target: null, readyState: 'BUILDING' };
  assert.strictEqual(connector(previewLatestReceipt, fixtureSha, observedAt).ok, true, 'current production is determined by the domain alias, not the newest preview');
  for (const change of [
    value => { value.observed_at = '2000-01-01T00:00:00Z'; },
    value => { value.project.accountId = 'other'; },
    value => { value.domain.verified = false; },
    value => { value.alias.deploymentId = 'dpl_Other'; },
    value => { value.deployment.meta.githubCommitRef = 'main'; },
    value => { value.deployment.meta.githubCommitSha = 'b'.repeat(40); }
  ]) {
    const value = JSON.parse(JSON.stringify(connectorReceipt)); change(value);
    assert.strictEqual(connector(value, fixtureSha, observedAt).ok, false, 'connector proof must fail closed on stale or mismatched facts');
  }

  for (const bad of ['https://elsewhere.test/', '//elsewhere.test/', endpoint + '&teamId=other', endpoint.replace('teamId=', 'wrong='), endpoint + '\nheader="injected"', '/v13/deployments/../auth?teamId=' + VERCEL_PRODUCTION_CONTRACT.teamId]) {
    const sample = fixture();
    assert.throws(() => sample.read(repoRoot, bad), /outside the fixed Production contract/);
    assert.strictEqual(sample.calls.length, 0);
  }
  for (const token of ['', 'short', fixtureToken + '\nheader="injected"', fixtureToken + '"', fixtureToken + '\\']) {
    const sample = fixture({ token });
    assert.throws(() => sample.read(repoRoot, endpoint), /authentication is unavailable/);
    assert(!sample.calls.some(item => item.command === process.execPath));
  }
  assert.throws(() => fixture({ authText: '{invalid' }).read(repoRoot, endpoint), /authentication is unavailable/);
  assert.throws(() => fixture({ packageName: 'other' }).read(repoRoot, endpoint), /authentication is unavailable/);
  for (const result of [
    { status: 1, stderr: fixtureToken, stdout: fixtureToken },
    { status: null, error: new Error(fixtureToken), stderr: fixtureToken },
    { status: 0, stdout: JSON.stringify({ error: fixtureToken }) + '\n__VERCEL_HTTP_STATUS__200' },
    { status: 0, stdout: fixtureToken },
    { status: 0, stdout: '[]' },
    { status: 0, stdout: '' },
    { status: 0, stdout: '{}' }
  ]) {
    const sample = fixture({ result });
    let thrown;
    try { sample.read(repoRoot, endpoint); } catch (error) { thrown = error; }
    assert(thrown, 'transport/HTTP/JSON failure must fail closed');
    assert(!String(thrown.message).includes(fixtureToken), 'credential/response text must not leak through errors');
  }
  for (const safe of ['VERCEL_LIVE_READ_NETWORK_PROJECT\n', 'VERCEL_LIVE_READ_HTTP_401_ALIAS\n', 'VERCEL_LIVE_READ_INPUT\n']) {
    assert.throws(() => fixture({ result: { status: 1, stderr: safe } }).batch(repoRoot), error => {
      assert(String(error.message).includes(safe.trim().replace('VERCEL_LIVE_READ_', '').replace(/_(PROJECT|DOMAIN|ALIAS|DEPLOYMENT)$/, ':$1')));
      return true;
    });
  }
  for (const stderr of [
    `VERCEL_LIVE_READ_NETWORK_PROJECT\n${fixtureToken}`,
    `before VERCEL_LIVE_READ_NETWORK_PROJECT\n`,
    `VERCEL_LIVE_READ_NETWORK_${fixtureToken}\n`,
    'VERCEL_LIVE_READ_HTTP_401_ALIAS\nVERCEL_LIVE_READ_NETWORK_PROJECT\n',
    'VERCEL_LIVE_READ_NETWORK_PROJECT'
  ]) {
    assert.throws(() => fixture({ result: { status: 1, stderr } }).batch(repoRoot), error => {
      assert(!String(error.message).includes(fixtureToken));
      assert(!/NETWORK[:_]PROJECT|HTTP_401[:_]ALIAS/.test(error.message), 'only the exact complete allowlisted stderr line may be forwarded');
      return true;
    });
  }
  for (const change of [
    value => { value.responses.pop(); },
    value => { value.responses.push(value.responses[0]); },
    value => { [value.responses[0], value.responses[1]] = [value.responses[1], value.responses[0]]; },
    value => { value.responses[3].endpoint = endpoints[3].replace(SELFTEST_PRODUCTION_DEPLOYMENT_ID, 'dpl_OtherDeployment'); },
    value => { value.responses[0].raw = JSON.stringify({ targets: { production: { id: '../auth' } } }); },
    value => { value.responses[1].raw = '[]'; },
    value => { value.responses[2].raw = fixtureToken; },
    value => { value.responses[3].raw = ''; },
    ...[0, 1, 2, 3].flatMap(index => [302, 401, 500].map(status => value => { value.responses[index].status = status; }))
  ]) {
    const value = envelope([0, 1, 2, 3]); change(value);
    const sample = fixture({ result: { status: 0, stdout: JSON.stringify(value) } });
    assert.throws(() => sample.batch(repoRoot), error => !String(error.message).includes(fixtureToken), 'tampered, partial or non-success batch envelope must fail closed');
  }

  // Execute the exact serialized child with built-in transport doubles. This
  // exercises request options, response streaming, deadlines and failure paths;
  // no real credential, endpoint override or network request is involved.
  function childProbe(plan = [{}], inputOverrides = {}) {
    const { EventEmitter } = require('node:events');
    const requests = [], checks = [], timers = [], agents = [], events = [];
    let stdout = '', stderr = '', now = 0;
    const drain = () => { while (events.length) events.shift()(); };
    const childProcess = { exitCode: 0, stdout: { write: text => { stdout += text; } }, stderr: { write: text => { stderr += text; } } };
    const tls = { checkServerIdentity: (host, certificate) => {
      checks.push(host);
      return certificate.reject ? Object.assign(new Error(fixtureToken), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }) : undefined;
    } };
    const https = { Agent: class {
      constructor(options) { this.options = options; this.destroyed = false; agents.push(this); }
      destroy() { this.destroyed = true; }
    }, request: (options, callback) => {
      const scenario = plan[requests.length] || {};
      const current = new EventEmitter();
      const entry = { options, current, endArgs: null, response: null, socket: null, secureConnectEmitted: false, destroyError: null };
      requests.push(entry);
      current.destroy = error => {
        current.destroyed = true;
        if (error && !entry.destroyError) {
          entry.destroyError = error;
          events.push(() => current.emit('error', error));
        }
        return current;
      };
      current.end = (...args) => {
        entry.endArgs = args;
        events.push(() => {
          if (scenario.noSocket) return;
          const socket = new EventEmitter();
          entry.socket = socket;
          socket.encrypted = true;
          socket.authorized = !(scenario.freshSocket || scenario.connectWait || scenario.certificate);
          current.emit('socket', socket);
          if (current.destroyed) return;
          if (scenario.connectWait || scenario.wait) return;
          const identityError = options.agent.options.checkServerIdentity(options.servername, scenario.certificate || {});
          if (identityError) { current.emit('error', identityError); return; }
          if (!socket.authorized) {
            socket.authorized = true;
            entry.secureConnectEmitted = true;
            socket.emit('secureConnect');
            if (current.destroyed) return;
          }
          // Existing delayed-response scenarios start after a valid connection.
          // Pending DNS/TCP/TLS time is advanced only through the fake timers.
          if (scenario.now !== undefined) now = scenario.now;
          if (scenario.error) {
            current.emit('error', Object.assign(new Error(fixtureToken), { code: scenario.error }));
            return;
          }
          const incoming = new EventEmitter();
          entry.response = incoming;
          incoming.socket = socket;
          socket.authorized = scenario.authorized !== false;
          incoming.statusCode = scenario.status ?? 200;
          incoming.headers = scenario.headers || {};
          incoming.complete = scenario.complete !== false;
          incoming.destroy = () => { incoming.destroyed = true; return incoming; };
          callback(incoming);
          entry.finishBody = () => {
            if (incoming.destroyed) return;
            const body = scenario.body ?? bodies[endpoints.indexOf(options.path)] ?? { ok: true };
            for (const chunk of scenario.chunks || [Buffer.from(JSON.stringify(body))]) {
              incoming.emit('data', chunk);
              if (incoming.destroyed) return;
            }
            if (scenario.responseError) incoming.emit('error', new Error(fixtureToken));
            else if (scenario.aborted) incoming.emit('aborted');
            else incoming.emit('end');
          };
          if (!scenario.bodyWait) entry.finishBody();
        });
      };
      return current;
    } };
    const input = JSON.stringify({ ...(inputOverrides.mode === 'production' ? {} : { endpoint }), token: fixtureToken, ...inputOverrides });
    const childRequire = name => {
      if (name === 'node:https') return https;
      if (name === 'node:tls') return tls;
      if (name === 'node:fs') return { readFileSync: (fd, encoding) => {
        assert.strictEqual(fd, 0); assert.strictEqual(encoding, 'utf8'); return input;
      } };
      throw new Error(`Unexpected child dependency: ${name}`);
    };
    vm.runInNewContext(call.args[2], {
      require: childRequire, process: childProcess, Buffer, Date: { now: () => now },
      setTimeout: (callback, delay) => { const timer = { callback, delay, due: now + delay, cleared: false, fired: false }; timers.push(timer); return timer; },
      clearTimeout: timer => { if (timer) timer.cleared = true; }
    }, { filename: 'selftest-vercel-https-child.js', timeout: 2000 });
    drain();
    return { requests, checks, timers, agents, process: childProcess,
      get stdout() { return stdout; }, get stderr() { return stderr; },
      finish: index => { requests[index].finishBody(); drain(); },
      fire: timer => { timer.callback(); drain(); },
      tick: time => {
        while (true) {
          const next = timers.filter(timer => !timer.cleared && !timer.fired && timer.due <= time).sort((left, right) => left.due - right.due)[0];
          if (!next) break;
          now = next.due;
          next.fired = true;
          next.callback();
          drain();
        }
        now = time;
        drain();
      }
    };
  }
  const child = childProbe();
  assert.deepStrictEqual(JSON.parse(child.stdout), envelope([2]));
  assert.strictEqual(child.stderr, '');
  assert.strictEqual(child.requests.length, 1);
  const options = child.requests[0].options;
  assert.strictEqual(options.protocol, 'https:');
  assert.strictEqual(options.hostname, 'api.vercel.com');
  assert.strictEqual(options.port, 443);
  assert.strictEqual(options.servername, 'api.vercel.com');
  assert.strictEqual(options.path, endpoint);
  assert.strictEqual(options.method, 'GET');
  assert.strictEqual(options.rejectUnauthorized, true);
  assert.strictEqual(options.agent, child.agents[0]);
  assert.strictEqual(child.agents[0].options.keepAlive, true);
  assert.strictEqual(child.agents[0].options.maxSockets, 1);
  assert.strictEqual(child.agents[0].options.maxFreeSockets, 1);
  assert.strictEqual(child.agents[0].options.servername, 'api.vercel.com');
  assert.strictEqual(child.agents[0].options.rejectUnauthorized, true);
  assert.strictEqual(options.headers.Authorization, `Bearer ${fixtureToken}`);
  assert.deepStrictEqual(Array.from(child.requests[0].endArgs), [], 'GET must never send a body');
  assert.deepStrictEqual(child.checks, ['api.vercel.com']);
  assert(options.agent.options.checkServerIdentity('attacker.test', {}), 'unexpected TLS hostname must be rejected');
  assert.strictEqual(child.agents[0].destroyed, true, 'the shared Agent closes only after the complete result');
  assert(!child.requests[0].current.destroyed && !child.requests[0].response.destroyed, 'successful end must release the socket naturally for Agent reuse');
  assert.strictEqual(child.timers.length, 2);
  assert.strictEqual(child.timers[0].delay, 30000);
  assert.strictEqual(child.timers[0].cleared, true);
  assert.strictEqual(child.timers[1].delay, 10000);
  assert.strictEqual(child.timers[1].cleared, true, 'an already-authorized reused socket clears the connection timer immediately');
  assert.strictEqual(child.requests[0].secureConnectEmitted, false, 'a reused authorized socket need not emit secureConnect again');
  const connectionRetry = childProbe([{ connectWait: true }, {}]);
  assert.strictEqual(connectionRetry.requests.length, 1);
  connectionRetry.tick(9999);
  assert.strictEqual(connectionRetry.requests.length, 1);
  connectionRetry.tick(10000);
  assert.strictEqual(connectionRetry.requests.length, 2, 'a 10-second unfinished connection triggers the existing single pre-header retry');
  assert.strictEqual(connectionRetry.requests[0].destroyError.code, 'ETIMEDOUT');
  assert.strictEqual(connectionRetry.timers[1].cleared, true, 'the retired attempt timer is cleared before retry');
  assert.deepStrictEqual(JSON.parse(connectionRetry.stdout), envelope([2]));
  assert.strictEqual(connectionRetry.timers[0].due, 30000, 'connection retry must not extend the batch deadline');
  const noSocketRetry = childProbe([{ noSocket: true }, {}]);
  noSocketRetry.tick(10000);
  assert.strictEqual(noSocketRetry.requests.length, 2, 'the same 10-second deadline also bounds DNS/TCP before socket assignment');
  assert.deepStrictEqual(JSON.parse(noSocketRetry.stdout), envelope([2]));
  const connectionExhausted = childProbe([{ connectWait: true }, { connectWait: true }]);
  connectionExhausted.tick(10000);
  assert.strictEqual(connectionExhausted.requests.length, 2);
  connectionExhausted.fire(connectionExhausted.timers[1]);
  assert.strictEqual(connectionExhausted.requests.length, 2, 'a retired attempt timer must not act on the next generation');
  assert.strictEqual(connectionExhausted.requests[1].current.destroyed, undefined);
  connectionExhausted.tick(20000);
  assert.strictEqual(connectionExhausted.requests.length, 2, 'connection timeouts share the entire batch retry allowance');
  assert.strictEqual(connectionExhausted.process.exitCode, 1);
  assert.strictEqual(connectionExhausted.stdout, '');
  assert.strictEqual(connectionExhausted.stderr, 'VERCEL_LIVE_READ_NETWORK_ALIAS\n');
  const reusedWaiting = childProbe([{ wait: true }]);
  assert.strictEqual(reusedWaiting.timers[1].cleared, true, 'socket authorization clears the connection timer before headers');
  reusedWaiting.tick(11000);
  assert.strictEqual(reusedWaiting.process.exitCode, 0);
  assert.strictEqual(reusedWaiting.requests[0].current.destroyed, undefined);
  reusedWaiting.tick(30000);
  assert.strictEqual(reusedWaiting.stderr, 'VERCEL_LIVE_READ_TIMEOUT_ALIAS\n');
  const slowBody = childProbe([{ freshSocket: true, bodyWait: true }]);
  assert.strictEqual(slowBody.requests[0].secureConnectEmitted, true);
  assert.strictEqual(slowBody.timers[1].cleared, true, 'fresh TLS secureConnect clears the handshake timer');
  slowBody.tick(11000);
  assert.strictEqual(slowBody.process.exitCode, 0, 'body streaming after a completed handshake retains the 30-second batch budget');
  assert.strictEqual(slowBody.requests[0].current.destroyed, undefined);
  slowBody.finish(0);
  assert.deepStrictEqual(JSON.parse(slowBody.stdout), envelope([2]));
  const batchChild = childProbe([{}, {}, {}, {}], { mode: 'production' });
  assert.deepStrictEqual(JSON.parse(batchChild.stdout), envelope([0, 1, 2, 3]));
  assert.deepStrictEqual(batchChild.requests.map(item => item.options.path), endpoints, 'project/domain/alias must precede the project-derived deployment read');
  assert.strictEqual(batchChild.agents.length, 1);
  assert(batchChild.requests.every(item => item.options.agent === batchChild.agents[0]));
  assert(batchChild.requests.every(item => !item.current.destroyed && !item.response.destroyed));
  assert.strictEqual(batchChild.agents[0].destroyed, true);
  assert.strictEqual(batchChild.timers.filter(timer => timer.delay === 30000).length, 1, 'all four requests share one total network deadline');
  assert.strictEqual(batchChild.timers.length, 5);
  assert(batchChild.timers.slice(1).every(timer => timer.delay === 10000 && timer.cleared));
  assert(!batchChild.stdout.includes(fixtureToken) && !batchChild.stderr.includes(fixtureToken));
  const derivedId = 'dpl_ProjectDerived';
  const derived = childProbe([{ body: { targets: { production: { id: derivedId } } } }, {}, {}, { body: {} }], { mode: 'production' });
  assert.strictEqual(derived.requests[3].options.path, `/v13/deployments/${derivedId}?${query}`);
  const lateLastResponse = childProbe([{}, {}, {}, { now: 30000 }], { mode: 'production' });
  assert.strictEqual(lateLastResponse.process.exitCode, 1);
  assert.strictEqual(lateLastResponse.stdout, '', 'a final 200 at the expired batch deadline must not release earlier responses');
  assert.strictEqual(lateLastResponse.stderr, 'VERCEL_LIVE_READ_TIMEOUT_DEPLOYMENT\n');
  assert.strictEqual(childProbe([{}], { mode: 'production', endpoint }).requests.length, 0, 'batch input may not smuggle a single endpoint');
  assert.strictEqual(childProbe([{}], { stage: 'PROJECT' }).requests.length, 0, 'diagnostic stage must be derived from fixed endpoints, never supplied by the caller');
  for (const fixedEndpoint of [
    `/v9/projects/${VERCEL_PRODUCTION_CONTRACT.projectId}?teamId=${VERCEL_PRODUCTION_CONTRACT.teamId}`,
    `/v9/projects/${VERCEL_PRODUCTION_CONTRACT.projectId}/domains/${VERCEL_PRODUCTION_CONTRACT.domain}?teamId=${VERCEL_PRODUCTION_CONTRACT.teamId}`,
    `/v13/deployments/${SELFTEST_PRODUCTION_DEPLOYMENT_ID}?teamId=${VERCEL_PRODUCTION_CONTRACT.teamId}`
  ]) assert.strictEqual(childProbe([{}], { endpoint: fixedEndpoint }).process.exitCode, 0);
  for (const bad of ['https://attacker.test/', '//api.vercel.com/', endpoint + '&extra=1', endpoint.replace('/v4/', '/v5/'), endpoint.replace('teamId=', 'other='), `/v13/deployments/../auth?teamId=${VERCEL_PRODUCTION_CONTRACT.teamId}`]) {
    const probe = childProbe([{}], { endpoint: bad });
    assert.strictEqual(probe.requests.length, 0);
    assert.strictEqual(probe.process.exitCode, 1);
    assert(!probe.stderr.includes(fixtureToken));
  }
  assert.strictEqual(childProbe([{}], { token: fixtureToken + '\n' }).requests.length, 0);
  for (const status of [302, 401, 500]) {
    const probe = childProbe([{ status, headers: { location: 'https://attacker.test/' } }]);
    assert.strictEqual(probe.requests.length, 1, 'HTTP errors and redirects must never retry or follow Location');
    assert.strictEqual(probe.stdout, '');
    assert.strictEqual(probe.process.exitCode, 1);
    assert.strictEqual(probe.stderr, `VERCEL_LIVE_READ_HTTP_${status}_ALIAS\n`);
  }
  for (const scenario of [
    { certificate: { reject: true } }, { error: 'CERT_HAS_EXPIRED' }, { error: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' },
    { authorized: false }, { complete: false }, { responseError: true }, { aborted: true },
    { body: [] }, { chunks: [Buffer.from(fixtureToken)] },
    { headers: { 'content-length': String(25 * 1024 * 1024 + 1) } },
    { chunks: [Buffer.alloc(25 * 1024 * 1024), Buffer.from('x')] }
  ]) {
    const probe = childProbe([scenario]);
    assert.strictEqual(probe.process.exitCode, 1);
    assert.strictEqual(probe.requests.length, 1);
    assert.strictEqual(probe.stdout, '');
    assert(!probe.stderr.includes(fixtureToken), 'child failures must not emit raw error or response contents');
    assert(/^VERCEL_LIVE_READ_(?:INPUT|TIMEOUT|NETWORK|TLS|SIZE|JSON|DEPLOYMENT|HTTP_[0-9]{3})_ALIAS\n$/.test(probe.stderr), 'only one fixed error category and endpoint-derived stage may be emitted');
    assert.strictEqual(probe.requests[0].current.destroyed, true);
  }
  for (const failureIndex of [0, 1, 2, 3]) {
    const plan = [{}, {}, {}, {}]; plan[failureIndex] = { status: 401 };
    const partial = childProbe(plan, { mode: 'production' });
    assert.strictEqual(partial.requests.length, failureIndex + 1);
    assert.strictEqual(partial.stdout, '', 'earlier 200 responses must not produce a partial receipt');
    assert.strictEqual(partial.process.exitCode, 1);
    assert.strictEqual(partial.stderr, `VERCEL_LIVE_READ_HTTP_401_${['PROJECT', 'DOMAIN', 'ALIAS', 'DEPLOYMENT'][failureIndex]}\n`);
  }
  const oversizedBatch = childProbe(bodies.map(body => ({ body: { ...body, padding: 'x'.repeat(7 * 1024 * 1024) } })), { mode: 'production' });
  assert.strictEqual(oversizedBatch.process.exitCode, 1, '25 MiB limit applies to the whole batch, not separately to each response');
  assert.strictEqual(oversizedBatch.stdout, '');
  assert.strictEqual(oversizedBatch.stderr, 'VERCEL_LIVE_READ_SIZE_DEPLOYMENT\n');
  const invalidProject = childProbe([{ body: { targets: { production: { id: '../auth' } } } }, {}, {}], { mode: 'production' });
  assert.strictEqual(invalidProject.process.exitCode, 1);
  assert.strictEqual(invalidProject.stdout, '');
  assert(invalidProject.requests.length <= 3, 'invalid project deployment must never become a request path');
  const retried = childProbe([{ error: 'ECONNRESET' }, {}]);
  assert.strictEqual(retried.requests.length, 2);
  assert.strictEqual(retried.process.exitCode, 0);
  assert.strictEqual(retried.timers.filter(timer => timer.delay === 30000).length, 1, 'retry must not create another total network deadline');
  assert.strictEqual(retried.timers.length, 3);
  assert(retried.timers.slice(1).every(timer => timer.cleared));
  const batchRetry = childProbe([{}, { error: 'ECONNRESET', now: 29000 }, {}, {}, {}], { mode: 'production' });
  assert.strictEqual(batchRetry.requests.length, 5);
  assert.strictEqual(batchRetry.process.exitCode, 0);
  assert.strictEqual(batchRetry.timers.filter(timer => timer.delay === 30000).length, 1);
  assert.deepStrictEqual(batchRetry.requests.map(item => item.options.path), [endpoints[0], endpoints[1], endpoints[1], endpoints[2], endpoints[3]]);
  const batchRetryExhausted = childProbe([{ error: 'ECONNRESET' }, {}, { error: 'ECONNRESET' }, {}], { mode: 'production' });
  assert.strictEqual(batchRetryExhausted.requests.length, 3, 'the batch has at most one retry across all endpoints');
  assert.strictEqual(batchRetryExhausted.stdout, '');
  assert.strictEqual(batchRetryExhausted.process.exitCode, 1);
  const exhausted = childProbe([{ error: 'ECONNRESET' }, { error: 'ECONNRESET' }]);
  assert.strictEqual(exhausted.requests.length, 2);
  assert.strictEqual(exhausted.process.exitCode, 1);
  const timeout = childProbe([{ error: 'ECONNRESET', now: 29000 }, { wait: true }]);
  assert.strictEqual(timeout.requests.length, 2);
  assert.strictEqual(timeout.timers.filter(timer => timer.delay === 30000).length, 1);
  timeout.tick(30000);
  assert.strictEqual(timeout.process.exitCode, 1);
  assert.strictEqual(timeout.stdout, '');
  assert.strictEqual(timeout.stderr, 'VERCEL_LIVE_READ_TIMEOUT_ALIAS\n');
  assert(timeout.requests.every(entry => entry.current.destroyed));
  console.log('Vercel official HTTPS live-read transport selftest ok');
}

function runRemoteSnapshotTransportSelftest(repoRoot) {
  const vm = require('vm');
  const registrySource = fs.readFileSync(path.join(__dirname, 'project-registry.js'), 'utf8');
  const privateText = 'example_git_stderr_must_never_be_reported';
  const main = 'a'.repeat(40), production = 'b'.repeat(40), attestation = 'c'.repeat(40);
  const raw = `ref: refs/heads/main\tHEAD\n${main}\tHEAD\n${main}\trefs/heads/main\n${production}\trefs/heads/production\n${attestation}\t${DELIVERY_ATTESTATION_REF}\n`;
  function fixture(plan) {
    const calls = [];
    let now = 0;
    const fakeProcess = Object.create(process);
    fakeProcess.env = { ...process.env, GIT_DIR: privateText, GIT_TRACE: privateText, GIT_CONFIG_COUNT: '1' };
    const fakeRequire = name => {
      if (name === 'child_process') return { ...require('child_process'), spawnSync: (command, args, opts) => {
        const scenario = plan[calls.length] || {};
        calls.push({ command, args, opts });
        assert.strictEqual(command, 'git');
        assert.deepStrictEqual(Array.from(args), ['ls-remote', '--symref', 'origin', 'HEAD', 'refs/heads/main', 'refs/heads/production', DELIVERY_ATTESTATION_REF]);
        assert.strictEqual(opts.cwd, repoRoot);
        assert(opts.timeout > 0 && opts.timeout <= 15000, 'each read is bounded by 15 seconds and remaining total time');
        assert.strictEqual(opts.killSignal, 'SIGTERM');
        assert(!Object.keys(opts.env).some(key => key.startsWith('GIT_')), 'hook-local and debug Git variables must not redirect the read or expose credentials');
        now = scenario.now ?? now;
        return { status: 0, stdout: raw, stderr: '', ...scenario.result };
      } };
      return require(name);
    };
    fakeRequire.main = require.main;
    const moduleCopy = { exports: {} };
    class ClockDate extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    }
    vm.runInNewContext(registrySource + '\nmodule.exports.__selftestRemote = readRemoteSnapshot;', {
      require: fakeRequire, module: moduleCopy, exports: moduleCopy.exports, process: fakeProcess,
      __dirname, __filename: path.join(__dirname, 'project-registry.js'), console, Buffer, URL, Date: ClockDate
    }, { filename: 'selftest-remote-snapshot-transport.js' });
    return { snapshot: moduleCopy.exports.__selftestRemote(repoRoot), calls };
  }
  const good = fixture([{}]);
  assert.strictEqual(good.snapshot.available, true);
  assert.strictEqual(good.snapshot.defaultBranch, 'main');
  assert.strictEqual(good.snapshot.main, main);
  assert.strictEqual(good.snapshot.production, production);
  assert.strictEqual(good.snapshot.attestation, attestation);
  assert.strictEqual(good.snapshot.diagnostics.category, 'success');
  assert.strictEqual(good.calls.length, 1);
  const timeoutResult = { status: null, signal: 'SIGTERM', error: Object.assign(new Error(privateText), { code: 'ETIMEDOUT' }), stderr: privateText };
  const recovered = fixture([{ now: 15000, result: timeoutResult }, { now: 20000 }]);
  assert.strictEqual(recovered.snapshot.available, true);
  assert.strictEqual(recovered.calls.length, 2);
  assert.strictEqual(recovered.snapshot.diagnostics.attempts[0].category, 'timeout');
  assert.strictEqual(recovered.snapshot.diagnostics.category, 'success');
  const networkResult = { status: 128, stderr: `fatal: unable to access '${privateText}': Failed to connect to github.com port 443: Couldn't connect to server` };
  const networkRecovered = fixture([{ now: 29000, result: networkResult }, { now: 30000 }]);
  assert.strictEqual(networkRecovered.calls.length, 2);
  assert.strictEqual(networkRecovered.calls[1].opts.timeout, 1000, 'retry must consume the remaining original 30-second deadline');
  assert.strictEqual(networkRecovered.snapshot.available, true);
  const exhausted = fixture([{ now: 15000, result: timeoutResult }, { now: 30000, result: timeoutResult }]);
  assert.strictEqual(exhausted.calls.length, 2);
  assert.strictEqual(exhausted.snapshot.available, false);
  assert.strictEqual(exhausted.snapshot.diagnostics.category, 'timeout');
  for (const [category, result] of [
    ['authentication', { status: 128, stdout: raw, stderr: `fatal: Authentication failed for '${privateText}'` }],
    ['tls', { status: 128, stderr: `SSL certificate problem: ${privateText}` }],
    ['unavailable', { status: null, error: Object.assign(new Error(privateText), { code: 'ENOENT' }), stderr: privateText }],
    ['unavailable', { status: 128, stderr: privateText }],
    ['invalid_response', { status: 0, stdout: '', stderr: privateText }]
  ]) {
    const sample = fixture([{ result }]);
    assert.strictEqual(sample.calls.length, 1, 'non-transient failures must never retry');
    assert.strictEqual(sample.snapshot.available, false);
    assert.strictEqual(sample.snapshot.diagnostics.category, category);
    assert.strictEqual(sample.snapshot.defaultBranch, null);
    assert.strictEqual(sample.snapshot.main, null);
    assert.strictEqual(sample.snapshot.production, null);
    assert.strictEqual(sample.snapshot.attestation, null);
    assert(!JSON.stringify(sample.snapshot).includes(privateText), 'diagnostics may contain only fixed categories and normalized process metadata');
  }
  for (const sample of [good, recovered, networkRecovered, exhausted]) {
    assert(!JSON.stringify(sample.snapshot).includes(privateText));
    assert.deepStrictEqual(Object.keys(sample.snapshot.diagnostics).sort(), ['attempts', 'category']);
    for (const attempt of sample.snapshot.diagnostics.attempts) {
      assert.deepStrictEqual(Object.keys(attempt).sort(), ['attempt', 'category', 'elapsedMs', 'errorCode', 'signal', 'status']);
      assert(['success', 'timeout', 'network', 'authentication', 'tls', 'invalid_response', 'unavailable'].includes(attempt.category));
      assert([null, 'ETIMEDOUT', 'ENOENT', 'EACCES', 'ENOBUFS', 'OTHER'].includes(attempt.errorCode));
      assert([null, 'SIGTERM', 'SIGKILL', 'SIGABRT', 'OTHER'].includes(attempt.signal));
      assert(Number.isFinite(attempt.elapsedMs) && attempt.elapsedMs >= 0);
      assert(attempt.attempt >= 1 && attempt.attempt <= 2);
    }
  }
  const missing = fixture([{ result: { status: 0, stdout: `ref: refs/heads/other\tHEAD\n${main}\trefs/heads/main\n` } }]);
  assert.strictEqual(missing.snapshot.available, true, 'a completed read must retain missing refs as null for the ordinary gates');
  assert.strictEqual(missing.snapshot.defaultBranch, 'other');
  assert.strictEqual(missing.snapshot.main, main);
  assert.strictEqual(missing.snapshot.production, null);
  assert.strictEqual(missing.snapshot.attestation, null);
  console.log('Git read-only remote snapshot transport selftest ok');
}

function main() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-selftest-'));
  const previousRuntimeDir = process.env.PRICE_V3_HARNESS_RUNTIME_DIR;
  const previousGitEnvironment = new Map(
    GIT_LOCAL_ENV_NAMES.map((name) => [name, process.env[name]])
  );
  for (const name of GIT_LOCAL_ENV_NAMES) delete process.env[name];
  process.env.PRICE_V3_HARNESS_RUNTIME_DIR = path.join(repoRoot, '.runtime', 'harness');

  try {
    if (process.argv.includes('--service-selection-production-first-only')) {
      runServiceSelectionProductionFirstSelftest(repoRoot);
      const legacyRoot = path.join(repoRoot, 'legacy-sso-fixture'); fs.mkdirSync(legacyRoot);
      process.env.PRICE_V3_HARNESS_RUNTIME_DIR = path.join(legacyRoot, '.runtime', 'harness');
      runSsoProductionFirstDefectSelftest(legacyRoot);
      return;
    }
    if (process.argv.includes('--crm-intake-only')) {
      runCrmIntakeContractSelftest();
      return;
    }
    if (process.argv.includes('--service-selection-only')) {
      runServiceSelectionContractSelftest(repoRoot);
      return;
    }
    if (process.argv.includes('--remote-snapshot-only')) {
      runRemoteSnapshotTransportSelftest(repoRoot);
      return;
    }
    if (process.argv.includes('--vercel-transport-only')) {
      runRemoteSnapshotTransportSelftest(repoRoot);
      runVercelHttpsTransportSelftest(repoRoot);
      return;
    }
    runRemoteSnapshotTransportSelftest(repoRoot);
    runVercelHttpsTransportSelftest(repoRoot);
    runCrmIntakeContractSelftest();
    if (process.argv.includes('--production-first-only')) {
      runSsoProductionFirstDefectSelftest(repoRoot);
      runShippingContractSelftest(repoRoot);
      return;
    }
    if (process.argv.includes('--application-only')) {
      runApplicationPermissionSelftest(repoRoot);
      return;
    }
    if (process.argv.includes('--config-ui-only')) {
      runConfigurationUiSelftest(repoRoot);
      return;
    }
    const verifierTests = spawnSync(process.execPath, ['--test', path.join(__dirname, 'shipping-workspace-verifier.test.js'), path.join(__dirname, 'shipping-parser-verifier.test.js'), path.join(__dirname, 'shipping-service-selection-verifier.test.js'), path.join(__dirname, 'shipping-settings-verifier.test.js'), path.join(__dirname, 'crm-intake-verifier.test.js')], {
      encoding: 'utf8', timeout: 60000
    });
    assert.strictEqual(verifierTests.status, 0, verifierTests.stderr || verifierTests.stdout || 'Shipping verifier offline tests failed');
    runSelftest(repoRoot);
    const applicationRoot = path.join(repoRoot, 'application-fixture');
    fs.mkdirSync(applicationRoot);
    process.env.PRICE_V3_HARNESS_RUNTIME_DIR = path.join(applicationRoot, '.runtime', 'harness');
    runApplicationPermissionSelftest(applicationRoot);
    const configurationRoot = path.join(repoRoot, 'configuration-fixture');
    fs.mkdirSync(configurationRoot);
    process.env.PRICE_V3_HARNESS_RUNTIME_DIR = path.join(configurationRoot, '.runtime', 'harness');
    runConfigurationUiSelftest(configurationRoot);
    const settingsRoot = path.join(repoRoot, 'settings-fixture');
    fs.mkdirSync(settingsRoot);
    process.env.PRICE_V3_HARNESS_RUNTIME_DIR = path.join(settingsRoot, '.runtime', 'harness');
    runShippingSettingsContractSelftest(settingsRoot);
    const selectionRoot = path.join(repoRoot, 'selection-fixture');
    fs.mkdirSync(selectionRoot);
    process.env.PRICE_V3_HARNESS_RUNTIME_DIR = path.join(selectionRoot, '.runtime', 'harness');
    runServiceSelectionContractSelftest(selectionRoot);
    const selectionFirstRoot = path.join(repoRoot, 'selection-first-fixture');
    fs.mkdirSync(selectionFirstRoot);
    process.env.PRICE_V3_HARNESS_RUNTIME_DIR = path.join(selectionFirstRoot, '.runtime', 'harness');
    runServiceSelectionProductionFirstSelftest(selectionFirstRoot);
    const approvalRoot = path.join(repoRoot, 'approval-fixture');
    fs.mkdirSync(approvalRoot);
    process.env.PRICE_V3_HARNESS_RUNTIME_DIR = path.join(approvalRoot, '.runtime', 'harness');
    runActionApprovalSelftest(approvalRoot);
    const productionFirstRoot = path.join(repoRoot, 'production-first-fixture');
    fs.mkdirSync(productionFirstRoot);
    process.env.PRICE_V3_HARNESS_RUNTIME_DIR = path.join(productionFirstRoot, '.runtime', 'harness');
    runSsoProductionFirstDefectSelftest(productionFirstRoot);
  } finally {
    if (previousRuntimeDir === undefined) {
      delete process.env.PRICE_V3_HARNESS_RUNTIME_DIR;
    } else {
      process.env.PRICE_V3_HARNESS_RUNTIME_DIR = previousRuntimeDir;
    }
    for (const [name, value] of previousGitEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

main();
