#!/usr/bin/env node
// Honor project hook removal even when a running client has cached registration.
{
  const hookFs = require('fs');
  const hookPath = require('path').join(__dirname, '..', 'hooks.json');
  const hookConfig = JSON.parse(hookFs.readFileSync(hookPath, 'utf8'));
  const registered = Object.values(hookConfig.hooks || {}).some(groups =>
    groups.some(group => (group.hooks || []).some(hook => (hook.command || '').includes('harness-adapter.js'))));
  if (!registered) process.exit(0);
}

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const EVENT = process.argv[2] || 'Unknown';

function repoRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  return result.status === 0 ? result.stdout.trim() : process.cwd();
}

const payload = readStdinJson();
const HOST_ROOT = repoRoot();
let ROOT;
try {
  const workspace = require(path.join(HOST_ROOT, 'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/harness-workspace.js'));
  ROOT = workspace.resolveExecutionWorkspace(HOST_ROOT);
} catch (error) {
  const workspace = require(path.join(HOST_ROOT, 'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/harness-workspace.js'));
  if (EVENT === 'PreToolUse' && workspace.isBindingRecovery(HOST_ROOT, payload)) {
    console.log('[Harness] bounded workspace recovery command allowed; new binding still requires full authority validation');
    process.exit(0);
  }
  console.error(`[Harness workspace blocked] ${error.message}`);
  process.exit(2);
}
const core = require(path.join(
  ROOT,
  'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/harness-core.js'
));
const GOAL_SCRIPT = path.join(
  ROOT,
  'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/harness-goal.js'
);

function readStdinJson() {
  let input = '';
  try {
    input = fs.readFileSync(0, 'utf8').trim();
  } catch {
    return {};
  }
  if (!input) {
    return {};
  }
  try {
    return JSON.parse(input);
  } catch {
    return { rawInput: input };
  }
}

function valueAt(obj, keys) {
  for (const key of keys) {
    const value = key.split('.').reduce((cursor, part) => cursor?.[part], obj);
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return '';
}

function shouldAdviseIntake(prompt) {
  if (!prompt) {
    return false;
  }
  return /目标|开始|实现|开发|修复|增强|重构|上线|部署|review|audit|build|implement|fix|ship/i.test(prompt);
}

function shouldStartReadOnlyVerification(prompt) {
  if (!prompt) {
    return false;
  }
  const text = String(prompt);
  const asksVerification = /只读验证|最终复验|复验|read-only verification|verify/i.test(text);
  const forbidsMutation = /不要修改|不修改|不要提交|不提交|不要推送|不推送|不要部署|不部署|read-only|do not modify|no modify|no commit|no push|no deploy/i.test(text);
  return asksVerification && forbidsMutation;
}

function userPromptSubmit(payload) {
  const state = core.loadState(ROOT);
  if (state.longTask?.enabled || state.mode === 'enforcing') {
    console.log(
      `[Harness] active phase=${state.phase || '-'} gates=${(state.activeGates || []).join(',') || '-'}`
    );
    return;
  }

  const prompt = String(valueAt(payload, [
    'prompt',
    'user_prompt',
    'message',
    'text',
    'input'
  ]) || payload.rawInput || '');
  if (shouldStartReadOnlyVerification(prompt)) {
    const { contract } = core.startGoal(ROOT, prompt, {
      level: 'A0',
      success: 'read-only verification completed',
      scopes: 'harness-control-plane'
    });
    core.setPhase(ROOT, 'verify', 'read-only verification prompt');
    console.log([
      '[Harness read-only verification started]',
      `goal=${contract.id}`,
      'phase=verify gate=HG4 autonomy=A0',
      'Only read and local verification commands are allowed. Edits, deployment, remote mutation, and destructive commands remain blocked.'
    ].join('\n'));
    return;
  }
  if (!shouldAdviseIntake(prompt)) {
    return;
  }

  const { contract } = core.startGoal(ROOT, prompt, {
    level: 'A0',
    success: [
      'goal contract reviewed',
      'unknowns classified as researchable, user-intent, safe assumptions, or blocked',
      'autonomy budget and forbidden scopes selected',
      'verification evidence collected before completion'
    ].join(','),
    scopes: 'goal-intake'
  });

  console.log([
    '[Harness intake started]',
    `goal=${contract.id}`,
    'phase=intake gate=HG0 autonomy=A0',
    'Before autonomous long-task work, classify the goal into: objective, non-goals, researchable unknowns, user-intent questions, autonomy budget, forbidden scopes, checkpoints, evidence, and stop conditions.',
    `To approve bounded execution after the contract is reviewed, run: node ${GOAL_SCRIPT} approve --level A1 --by <name> && node ${GOAL_SCRIPT} phase execute`
  ].join('\n'));
}

function deny(result) {
  console.error(`\n🚫 CODEX HARNESS INTERCEPTED: ${result.reason}`);
  printMatrix(result.matrix, 'Action evaluation matrix');
  const details = {
    gate: result.gate,
    phase: result.phase,
    tool: result.tool,
    risk: result.risk,
    command: result.command,
    allowed: result.allowedTools?.join(', ')
  };
  for (const [key, value] of Object.entries(details)) {
    if (value) {
      console.error(`   ${key}: ${value}`);
    }
  }
  process.exit(result.exitCode || 2);
}

function printMatrix(matrix, title = 'Action evaluation matrix') {
  if (!matrix?.rows?.length) {
    return;
  }
  const lines = matrix.rows.map((row) => {
    const action = row.action ? ` | action=${row.action}` : '';
    return `   - ${row.id}: ${row.status} | ${row.detail}${action}`;
  });
  const header = `[Harness ${title}] target=${matrix.targetObject} impact=${matrix.impact}`;
  console.error([header, ...lines].join('\n'));
}

function preToolUse(payload) {
  const tool = core.normalizeToolName(payload.tool_name || payload.toolName || payload.tool?.name || payload.tool || payload.name);
  if (['Edit', 'Write', 'MultiEdit', 'Browser', 'Delegate'].includes(tool)) {
    const registry = require(path.join(ROOT, 'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/project-registry.js'));
    const check = registry.validateSchedulerState({ repoRoot: ROOT });
    if (!check.ok) deny({ reason: `workspace preflight failed: ${check.errors.join('; ')}`, exitCode: 2 });
    if (['Edit', 'Write', 'MultiEdit'].includes(tool)) {
      const input = payload.tool_input || payload.input || payload.arguments || {};
      const targets = [input.file_path || input.path || payload.file_path || payload.path, ...(input.edits || []).map(edit => edit.file_path || edit.path)].filter(Boolean);
      const patch = typeof input === 'string' ? input : core.commandTextFromPayload(payload);
      if (patch.startsWith('*** Begin Patch')) targets.push(...[...patch.matchAll(/^\*\*\* (?:Update File|Add File|Delete File|Move to): (.+)$/gm)].map(match => match[1]));
      if (ROOT !== HOST_ROOT && targets.some(file => !path.isAbsolute(file))) deny({ reason: 'bound workspace writes require absolute paths; relative paths belong to the caller checkout', exitCode: 2 });
      if (!targets.length && ROOT !== HOST_ROOT) deny({ reason: 'bound workspace write has no inspectable target', exitCode: 2 });
      if (targets.length && targets.some(file => !registry.isSchedulerPathAllowed(file, { repoRoot: ROOT }).allowed)) deny({ reason: 'write target is outside Active scope or protected runtime state', exitCode: 2 });
    }
  }
  const result = core.evaluateToolUse(ROOT, payload);
  if (!result.ok) {
    deny(result);
  }
  if (result.matrix?.highImpact) {
    printMatrix(result.matrix, 'high-impact preflight');
  }
}

function stop() {
  const state = core.loadState(ROOT);
  if (!state.longTask?.enabled) {
    return;
  }
  const contract = core.loadContract(ROOT);
  const audit = core.completionAudit(ROOT);
  const auditLines = (audit.rows || []).map((row) => `   - ${row.id}: ${row.status} | ${row.detail}`);
  console.log([
    '[Harness evidence checkpoint]',
    `phase=${state.phase || '-'} gates=${(state.activeGates || []).join(',') || '-'}`,
    'Before ending the turn, report changed files, validation evidence, unverified items, risk, and rollback notes.',
    `[Harness completion audit] status=${audit.status}`,
    ...auditLines
  ].join('\n'));
  if (!audit.ok && (state.phase === 'complete' || contract?.status === 'complete')) {
    console.error('🚫 CODEX HARNESS INTERCEPTED: completion was claimed but completion audit failed');
    process.exit(2);
  }
}

if (EVENT === 'UserPromptSubmit') {
  userPromptSubmit(payload);
} else if (EVENT === 'PreToolUse') {
  preToolUse(payload);
} else if (EVENT === 'Stop') {
  stop(payload);
}
