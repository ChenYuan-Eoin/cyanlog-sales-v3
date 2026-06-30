#!/usr/bin/env node

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

const ROOT = repoRoot();
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
      'phase=verify gate=G4 autonomy=A0',
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
    'phase=intake gate=G0 autonomy=A0',
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

const payload = readStdinJson();
if (EVENT === 'UserPromptSubmit') {
  userPromptSubmit(payload);
} else if (EVENT === 'PreToolUse') {
  preToolUse(payload);
} else if (EVENT === 'Stop') {
  stop(payload);
}
