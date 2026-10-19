#!/usr/bin/env node

const { bindWorkspace } = require('./harness-workspace');
const registry = require('./project-registry');
const core = require('./harness-core');

const {
  AUTONOMY_LEVELS,
  approveAction,
  readJson,
  approveContract,
  clearGoal,
  completeGoal,
  completionAudit,
  loadContract,
  loadState,
  paths,
  recordEvidence,
  repoRootFromRegistry,
  reviseContract,
  setPhase,
  startGoal,
  updateCheckpoint,
  validateContract
} = require('./harness-core');

function parseOptions(args) {
  const options = {};
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        options[key] = true;
      } else {
        options[key] = next;
        i += 1;
      }
    } else {
      rest.push(arg);
    }
  }
  return { options, rest };
}

function printStatus(repoRoot, asJson = false) {
  const p = paths(repoRoot);
  const state = loadState(repoRoot);
  const contract = loadContract(repoRoot);
  if (asJson) {
    console.log(JSON.stringify({ statePath: p.statePath, contractPath: contract ? p.contractPath : null, state, contract }, null, 2));
    return;
  }

  console.log('Harness goal status');
  console.log(`state=${p.statePath}`);
  console.log(`contract=${contract ? p.contractPath : '-'}`);
  console.log(`mode=${state.mode || '-'}`);
  console.log(`phase=${state.phase || '-'}`);
  console.log(`activeGates=${(state.activeGates || []).join(',') || '-'}`);
  if (contract) {
    console.log(`id=${contract.id || '-'}`);
    console.log(`objective=${contract.objective || '-'}`);
    console.log(`status=${contract.status || '-'}`);
    console.log(`autonomy=${contract.autonomyBudget?.level || '-'}`);
    console.log(`evidence=${contract.evidence?.collected?.length || 0}`);
    const errors = validateContract(contract);
    console.log(`contractValid=${errors.length ? 'no' : 'yes'}`);
    if (errors.length) {
      console.log(`contractErrors=${errors.join('; ')}`);
    }
  }
}

function printTemplate() {
  console.log(JSON.stringify({
    objective: 'Concrete outcome to achieve',
    successCriteria: ['Measurable condition that proves completion'],
    nonGoals: ['Explicitly out of scope'],
    researchable: ['Facts the agent may investigate independently'],
    askUser: ['Intent or authority questions that require the user'],
    autonomyLevel: Object.keys(AUTONOMY_LEVELS),
    allowedScopes: ['Paths or product areas the task may touch'],
    forbiddenScopes: ['Paths or areas the task must not touch'],
    stopConditions: [
      'high-risk action required',
      'user intent unclear',
      'verification unavailable'
    ]
  }, null, 2));
}

function printAudit(audit, asJson = false) {
  if (asJson) {
    console.log(JSON.stringify(audit, null, 2));
    return;
  }
  console.log(`Harness completion audit: ${audit.status}`);
  console.log(`goal=${audit.goalId || '-'}`);
  console.log(`phase=${audit.phase || '-'}`);
  for (const row of audit.rows || []) {
    console.log(`- ${row.id}: ${row.status} | ${row.detail}`);
  }
}

function usage() {
  console.error([
    'Usage:',
    '  harness-goal.js start --wp WP00 [--level A0|A1|A2|A3] [--success csv] [--scope csv] <goal>',
    '  harness-goal.js revise --reason text --authority IN-id --by name [--success csv] [--scope csv] <goal>',
    '  harness-goal.js approve [--level A1|A2|A3] [--by name]',
    '  harness-goal.js approve-action --request /absolute/request.json (exact authority, clean SHA, max one hour, single use)',
    '  harness-goal.js phase <intake|research|contract_review|execute|verify|approval|blocked|complete>',
    '  harness-goal.js checkpoint --name text --status pending|pass|blocked [--detail text]',
    '  harness-goal.js evidence --status pass|fail|info --type command|note --summary text [--detail text] [--satisfies csv]',
    '  harness-goal.js audit [--json]',
    '  harness-goal.js complete [--by name]',
    '  harness-goal.js status [--json]',
    '  harness-goal.js preflight [--tools comma-separated-tools] [--paths comma-separated-paths]',
    '  harness-goal.js bind --caller /checkout --workspace /registered-worktree --authority IN-id',
    '  harness-goal.js switch-check --caller /checkout --workspace /registered-worktree --authority IN-id --candidate /absolute/candidate.json',
    '  harness-goal.js switch --caller /checkout --workspace /registered-worktree --authority IN-id --candidate /absolute/candidate.json',
    '  harness-goal.js recover-switch --caller /checkout --workspace /registered-worktree --authority IN-id',
    '  harness-goal.js template',
    '  harness-goal.js clear'
  ].join('\n'));
}

function main() {
  const repoRoot = repoRootFromRegistry();
  const [command, ...args] = process.argv.slice(2);
  const { options, rest } = parseOptions(args);

  try {
    if (['switch-check', 'switch', 'recover-switch'].includes(command)) {
      if (!options.caller || !options.workspace || !options.authority) throw new Error('switch requires caller, workspace and authority');
      const switches = require('./harness-switch');
      const input = { caller: options.caller, workspace: options.workspace, authority: options.authority };
      if (command !== 'recover-switch') {
        if (!options.candidate) throw new Error('switch requires a candidate JSON path');
        input.candidate = readJson(options.candidate);
      }
      const result = command === 'switch-check' ? switches.checkSwitch(input) : command === 'switch' ? switches.switchWorkspace(input) : switches.recoverSwitch(input);
      console.log(JSON.stringify(result, null, 2));
      if (result.ok === false) process.exitCode = 2;
      return;
    }
    if (command === 'bind') {
      if (!options.caller || !options.workspace || !options.authority) throw new Error('bind requires caller, workspace and authority');
      console.log(JSON.stringify(bindWorkspace(options.caller, options.workspace, options.authority), null, 2));
      return;
    }
    if (command === 'preflight') {
      const scheduler = registry.validateSchedulerState({ repoRoot });
      const state = loadState(repoRoot), contract = loadContract(repoRoot);
      const defaults = ['Read', 'AskUserQuestion', 'get_goal', 'create_goal', 'update_goal'];
      if (['research', 'execute', 'verify'].includes(state.phase)) defaults.push('Bash');
      if (['research', 'contract_review', 'execute', 'verify'].includes(state.phase)) defaults.push('Delegate');
      if (['execute', 'verify'].includes(state.phase)) defaults.push('Browser');
      const tools = String(options.tools || defaults.join(',')).split(',').filter(Boolean);
      const toolChecks = tools.map(tool => {
        const result = core.evaluateToolUse(repoRoot, { tool_name: tool });
        return { tool, ok: result.ok, reason: result.reason || null };
      });
      const pathChecks = String(options.paths || '').split(',').filter(Boolean).map(file => ({ file, ...registry.isSchedulerPathAllowed(file, { repoRoot }) }));
      const errors = [...scheduler.errors, ...toolChecks.filter(row => !row.ok).map(row => `${row.tool}: ${row.reason}`), ...pathChecks.filter(row => !row.allowed).map(row => `${row.file}: ${row.reason || 'outside Active scope'}`)];
      const target = registry.loadSchedulerState({ repoRoot }).state.active_task?.execution_workspace;
      if (target !== repoRoot) errors.push(`Active execution workspace differs: ${target}`);
      console.log(JSON.stringify({ ok: errors.length === 0, repoRoot, workPackage: scheduler.activeId, phase: state.phase, gate: state.activeGates?.[0], autonomy: contract?.autonomyBudget?.level, tools: toolChecks, paths: pathChecks, errors }, null, 2));
      process.exitCode = errors.length ? 2 : 0;
      return;
    }
    if (command === 'approve-action') {
      const approval = approveAction(repoRoot, readJson(options.request));
      console.log(`Action approval recorded: ${approval.id} target=${approval.target} expires=${approval.expiresAt}`);
      return;
    }
    if (command === 'start') {
      const goalText = rest.join(' ');
      const { contract } = startGoal(repoRoot, goalText, {
        workPackageId: options.wp,
        level: options.level,
        success: options.success,
        scopes: options.scope || options.scopes,
        forbiddenScopes: options.forbiddenScope || options.forbiddenScopes,
        nonGoals: options.nonGoals,
        researchable: options.researchable,
        askUser: options.askUser,
        requiredChecks: options.requiredChecks
      });
      console.log(`Harness phase=intake gate=HG0`);
      console.log(`Goal contract written: ${paths(repoRoot).contractPath}`);
      console.log(`Goal id=${contract.id}`);
      console.log(`Autonomy=${contract.autonomyBudget.level}`);
      return;
    }

    if (command === 'approve') {
      const contract = approveContract(repoRoot, {
        level: options.level,
        by: options.by
      });
      console.log(`Goal contract approved: ${contract.id}`);
      console.log(`Autonomy=${contract.autonomyBudget.level}`);
      return;
    }

    if (command === 'revise') {
      const goalText = rest.join(' ');
      const contract = reviseContract(repoRoot, goalText, {
        reason: options.reason,
        authority: options.authority,
        by: options.by,
        success: options.success,
        scopes: options.scope || options.scopes,
        forbiddenScopes: options.forbiddenScope || options.forbiddenScopes,
        nonGoals: options.nonGoals,
        researchable: options.researchable,
        askUser: options.askUser
      });
      console.log(`Goal contract revised: ${contract.id}`);
      console.log(`Status=${contract.status} phase=${contract.phase.current}`);
      return;
    }

    if (command === 'phase') {
      const phase = rest[0] || '';
      const result = setPhase(repoRoot, phase, 'phase command');
      console.log(`Harness phase=${phase} gate=${result.gate || 'none'}`);
      return;
    }

    if (command === 'evidence') {
      const summary = options.summary || rest.join(' ');
      const evidence = recordEvidence(repoRoot, {
        type: options.type || 'note',
        status: options.status || 'info',
        summary,
        detail: options.detail || '',
        satisfies: options.satisfies
      });
      console.log(`Evidence recorded: ${evidence.status} ${evidence.summary}`);
      return;
    }

    if (command === 'checkpoint') {
      const checkpoint = updateCheckpoint(repoRoot, {
        name: options.name || rest.join(' '),
        status: options.status,
        detail: options.detail || ''
      });
      console.log(`Checkpoint updated: ${checkpoint.name || checkpoint.id}=${checkpoint.status}`);
      return;
    }

    if (command === 'audit') {
      const audit = completionAudit(repoRoot);
      printAudit(audit, Boolean(options.json));
      process.exit(audit.ok ? 0 : 2);
    }

    if (command === 'complete') {
      const result = completeGoal(repoRoot, { by: options.by });
      printAudit(result.audit, Boolean(options.json));
      console.log(`Goal complete: ${result.contract.id}`);
      return;
    }

    if (!command || command === 'status') {
      printStatus(repoRoot, Boolean(options.json));
      return;
    }

    if (command === 'template') {
      printTemplate();
      return;
    }

    if (command === 'clear') {
      clearGoal(repoRoot);
      console.log('Harness goal cleared');
      return;
    }

    usage();
    process.exit(1);
  } catch (error) {
    console.error(`Harness goal error: ${error.message}`);
    process.exit(1);
  }
}

main();
