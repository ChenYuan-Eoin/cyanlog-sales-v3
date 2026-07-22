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
  VERCEL_PRODUCTION_CONTRACT,
  checkDeliveryStage,
  getDeliveryStatus,
  recordDeliveryEvidence,
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

function evidenceEnvelope(repoRoot, name, payload, attachments = []) {
  const materializedAttachments = attachments.map((attachment, index) => (
    writeRuntimeArtifact(
      repoRoot,
      `artifacts/${name}-${index + 1}-${attachment.filename}`,
      attachment.contents
    )
  ));
  const materializedPayload = materializedAttachments.length
    ? { ...payload, attachments: materializedAttachments }
    : payload;
  const artifactPath = `artifacts/${name}.json`;
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
        target_state: 'main_integrated',
        allowed_states: [
          'executing',
          'code_green',
          'clean_preview_green',
          'integration_ready',
          'main_integrated'
        ],
        integration_branch: 'main',
        production_branch: 'production',
        production_release_separate: true,
        attestation_ref: DELIVERY_ATTESTATION_REF,
        same_release_commit_required: true,
        required_code_checks: ['target_tests', 'full_tests', 'lint', 'typecheck', 'build'],
        required_runtime_evidence: ['provider_probe', 'review_run', 'model_invocations', 'tokens'],
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
  fs.writeFileSync(inboxPath, '');
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
      meta: { gitCommitSha: productionCommit },
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
    wrongShaResponses.deployment.meta.gitCommitSha = 'f'.repeat(40);
    const wrongShaGate = transitionDeliveryState('integration_ready', {
      repoRoot,
      testOnlyVercelApiResponses: wrongShaResponses
    });
    assert.strictEqual(wrongShaGate.ok, false);
    assert.ok(wrongShaGate.blockers.some((blocker) => blocker.includes('source SHA')));

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
    assert.strictEqual(transitionDeliveryState('production_released', vercelGateOptions).ok, false);

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

function main() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-selftest-'));
  const previousRuntimeDir = process.env.PRICE_V3_HARNESS_RUNTIME_DIR;
  const previousGitEnvironment = new Map(
    GIT_LOCAL_ENV_NAMES.map((name) => [name, process.env[name]])
  );
  for (const name of GIT_LOCAL_ENV_NAMES) delete process.env[name];
  process.env.PRICE_V3_HARNESS_RUNTIME_DIR = path.join(repoRoot, '.runtime', 'harness');

  try {
    runSelftest(repoRoot);
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
