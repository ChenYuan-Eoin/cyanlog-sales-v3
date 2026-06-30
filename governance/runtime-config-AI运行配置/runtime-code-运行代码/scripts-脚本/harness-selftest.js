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
}

function main() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-selftest-'));
  makeSettings(repoRoot);

  const started = core.startGoal(repoRoot, 'Build a safe long-task harness', { level: 'A0' });
  assert.strictEqual(started.state.mode, 'enforcing');
  assert.deepStrictEqual(started.state.activeGates, ['G0']);
  assert.strictEqual(started.contract.status, 'draft');

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

  const contract = core.loadContract(repoRoot);
  contract.boundaries.allowedScopes = ['harness-control-plane'];
  core.saveContract(repoRoot, contract);

  const scopedControlPlaneEdit = core.evaluateToolUse(repoRoot, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(repoRoot, '.codex/hooks.json') }
  });
  assert.strictEqual(scopedControlPlaneEdit.ok, true);

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

  const checks = core.runtimeValidation(repoRoot);
  assert.deepStrictEqual(checks, []);

  const cleared = core.clearGoal(repoRoot);
  assert.strictEqual(cleared.mode, 'permissive');
  assert.strictEqual(fs.existsSync(core.paths(repoRoot).contractPath), false);

  fs.rmSync(repoRoot, { recursive: true, force: true });
  console.log('harness selftest ok');
}

main();
