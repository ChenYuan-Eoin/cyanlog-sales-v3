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
  SHIPPING_COLLABORATION_ACTIONS,
  VERCEL_PRODUCTION_CONTRACT,
  checkDeliveryStage,
  getDeliveryStatus,
  recordDeliveryEvidence,
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
      alias: [VERCEL_PRODUCTION_CONTRACT.domain]
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
    assert.ok(environmentWorktreeRedirect.errors.some((error) => error.includes('Git top-level mismatch')));
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

function main() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-selftest-'));
  const previousRuntimeDir = process.env.PRICE_V3_HARNESS_RUNTIME_DIR;
  const previousGitEnvironment = new Map(
    GIT_LOCAL_ENV_NAMES.map((name) => [name, process.env[name]])
  );
  for (const name of GIT_LOCAL_ENV_NAMES) delete process.env[name];
  process.env.PRICE_V3_HARNESS_RUNTIME_DIR = path.join(repoRoot, '.runtime', 'harness');

  try {
    const verifierTests = spawnSync(process.execPath, ['--test', path.join(__dirname, 'shipping-workspace-verifier.test.js')], {
      encoding: 'utf8', timeout: 60000
    });
    assert.strictEqual(verifierTests.status, 0, verifierTests.stderr || verifierTests.stdout || 'Shipping verifier offline tests failed');
    runSelftest(repoRoot);
    const approvalRoot = path.join(repoRoot, 'approval-fixture');
    fs.mkdirSync(approvalRoot);
    process.env.PRICE_V3_HARNESS_RUNTIME_DIR = path.join(approvalRoot, '.runtime', 'harness');
    runActionApprovalSelftest(approvalRoot);
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
