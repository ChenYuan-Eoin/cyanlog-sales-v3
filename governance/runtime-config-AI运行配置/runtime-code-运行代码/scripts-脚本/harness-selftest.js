#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('./harness-core');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeSettings(repoRoot) {
  writeJson(core.paths(repoRoot).settingsPath, {
    version: 'selftest',
    gates: {
      G0: { phase: 'intake', tools: ['Read', 'Grep', 'Glob', 'AskUserQuestion'] },
      G1: { phase: 'research', tools: ['Read', 'Grep', 'Glob', 'Bash'] },
      G2: { phase: 'contract_review', tools: ['Read', 'Grep', 'Glob', 'AskUserQuestion'] },
      G3: { phase: 'execute', tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'MultiEdit', 'Bash'] },
      G4: { phase: 'verify', tools: ['Read', 'Grep', 'Glob', 'Bash'] },
      G5: { phase: 'approval', tools: ['Read', 'Grep', 'Glob', 'AskUserQuestion'] }
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

function main() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-selftest-'));
  makeSettings(repoRoot);

  const started = core.startGoal(repoRoot, 'Build a safe long-task harness', { level: 'A0' });
  assert.strictEqual(started.state.mode, 'enforcing');
  assert.deepStrictEqual(started.state.activeGates, ['G0']);
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
  assert.deepStrictEqual(execution.state.activeGates, ['G3']);
  assert.deepStrictEqual(execution.state.activeHooks, ['UserPromptSubmit', 'PreToolUse', 'Stop']);

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
    tool_input: { file_path: path.join(repoRoot, 'governance/runtime-state/harness-state.json') }
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
    tool_input: { file_path: path.join(repoRoot, 'governance/runtime-state/harness-state.json') }
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
  const completed = core.completeGoal(repoRoot, { by: 'selftest' });
  assert.strictEqual(completed.contract.status, 'complete');
  assert.strictEqual(completed.state.mode, 'permissive');

  const checks = core.runtimeValidation(repoRoot);
  assert.deepStrictEqual(checks, []);

  const cleared = core.clearGoal(repoRoot);
  assert.strictEqual(cleared.mode, 'permissive');
  assert.strictEqual(fs.existsSync(core.paths(repoRoot).contractPath), false);

  fs.rmSync(repoRoot, { recursive: true, force: true });
  console.log('harness selftest ok');
}

main();
