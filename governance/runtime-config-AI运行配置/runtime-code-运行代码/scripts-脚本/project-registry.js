#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REGISTRY_RELATIVE_PATH = 'governance/runtime-config-AI运行配置/config-配置文件/project-governance-项目治理注册表.json';
const SCHEDULER_RELATIVE_PATH = 'governance/runtime-state/active-task.json';
const DEMAND_INBOX_RELATIVE_PATH = 'governance/runtime-state/demand-inbox.jsonl';
const HARNESS_SETTINGS_RELATIVE_PATH = 'governance/runtime-config-AI运行配置/config-配置文件/settings-claude运行配置.json';
const HARNESS_STATE_RELATIVE_PATH = 'governance/runtime-state/harness-state.json';
const WORK_PACKAGE_ID_PATTERN = /^WP\d{2}$/;
const HARNESS_GATE_ID_PATTERN = /^HG\d+$/;
const REQUIRED_HARNESS_GATE_IDS = ['HG0', 'HG1', 'HG2', 'HG3', 'HG4', 'HG5'];
const HARNESS_GATE_PHASES = {
  HG0: 'intake',
  HG1: 'research',
  HG2: 'contract_review',
  HG3: 'execute',
  HG4: 'verify',
  HG5: 'approval'
};

function normalizeRelative(value) {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function findRepoRoot(startDir = __dirname) {
  let current = path.resolve(startDir);

  while (true) {
    const registryPath = path.join(current, REGISTRY_RELATIVE_PATH);
    if (fs.existsSync(registryPath)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Repository root not found from ${startDir}`);
    }
    current = parent;
  }
}

function loadRegistry(repoRoot = findRepoRoot()) {
  const registryPath = path.join(repoRoot, REGISTRY_RELATIVE_PATH);
  const raw = fs.readFileSync(registryPath, 'utf8');
  const registry = JSON.parse(raw);
  return { repoRoot, registry, registryPath };
}

function getDocumentEntry(registry, documentId) {
  return (registry.documents || []).find((entry) => entry.id === documentId) || null;
}

function resolveDocumentPath(documentId, options = {}) {
  const { repoRoot, registry } = loadRegistry(options.repoRoot);
  const entry = getDocumentEntry(registry, documentId);
  if (!entry) {
    return null;
  }
  return {
    entry,
    relativePath: normalizeRelative(entry.path),
    absolutePath: path.join(repoRoot, entry.path)
  };
}

function resolveEnabledDocumentPath(documentId, options = {}) {
  const resolved = resolveDocumentPath(documentId, options);
  if (!resolved) {
    return null;
  }
  if (resolved.entry.enabled === false) {
    return null;
  }
  if (!pathExists(resolved.absolutePath)) {
    return null;
  }
  return resolved;
}

function resolveRuntimePath(pathValue, options = {}) {
  const { repoRoot } = loadRegistry(options.repoRoot);
  return path.join(repoRoot, pathValue);
}

function getHarnessRuntime(options = {}) {
  const { repoRoot, registry } = loadRegistry(options.repoRoot);
  return {
    repoRoot,
    config: registry.runtime && registry.runtime.harness ? registry.runtime.harness : {}
  };
}

function resolveHookCommand(hookId, options = {}) {
  const { repoRoot, config } = getHarnessRuntime(options);
  const hook = config.hook_commands && config.hook_commands[hookId];
  if (!hook) {
    return null;
  }
  return {
    command: hook.command,
    args: [path.join(repoRoot, hook.path)],
    path: path.join(repoRoot, hook.path),
    repoRoot
  };
}

function toRepoRelative(filePath, options = {}) {
  const { repoRoot } = loadRegistry(options.repoRoot);
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
  return normalizeRelative(path.relative(repoRoot, absolute));
}

function isWithinDocument(filePath, documentId, options = {}) {
  const resolved = resolveDocumentPath(documentId, options);
  if (!resolved) {
    return false;
  }

  const target = resolved.relativePath;
  const fileRelative = toRepoRelative(filePath, options);
  return fileRelative === target || fileRelative.startsWith(`${target}/`);
}

function isEnabled(documentId, options = {}) {
  const resolved = resolveDocumentPath(documentId, options);
  if (!resolved) {
    return false;
  }
  return resolved.entry.enabled !== false;
}

function pathExists(targetPath) {
  return Boolean(targetPath) && fs.existsSync(targetPath);
}

function printStatus() {
  const { repoRoot, registryPath } = loadRegistry();
  const { config } = getHarnessRuntime({ repoRoot });
  const statePath = path.join(repoRoot, HARNESS_STATE_RELATIVE_PATH);
  const settingsPath = config.settings ? path.join(repoRoot, config.settings) : null;

  console.log('Harness registry status');
  console.log(`repoRoot=${repoRoot}`);
  console.log(`registry=${registryPath}`);
  console.log(`settings=${settingsPath || '-'}`);
  console.log(`state=${statePath}`);

  if (fs.existsSync(statePath)) {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    console.log(`mode=${state.mode || '-'}`);
    console.log(`phase=${state.phase || '-'}`);
    console.log(`activeGates=${(state.activeGates || []).join(',') || '-'}`);
  }
}

function runHook(hookId, extraArgs = []) {
  const resolved = resolveHookCommand(hookId);
  if (!resolved) {
    console.error(`Unknown hook command: ${hookId}`);
    return 1;
  }
  if (!fs.existsSync(resolved.path)) {
    console.error(`Hook command path does not exist: ${resolved.path}`);
    return 1;
  }

  const result = spawnSync(resolved.command, [...resolved.args, ...extraArgs], {
    cwd: resolved.repoRoot,
    stdio: 'inherit',
    env: process.env
  });
  return typeof result.status === 'number' ? result.status : 1;
}

function loadSchedulerState(options = {}) {
  const repoRoot = options.repoRoot || findRepoRoot();
  const schedulerPath = path.join(repoRoot, SCHEDULER_RELATIVE_PATH);
  const state = JSON.parse(fs.readFileSync(schedulerPath, 'utf8'));
  return { repoRoot, schedulerPath, state };
}

function loadDemandInbox(options = {}) {
  const repoRoot = options.repoRoot || findRepoRoot();
  const inboxPath = path.join(repoRoot, DEMAND_INBOX_RELATIVE_PATH);
  if (!fs.existsSync(inboxPath)) {
    return { repoRoot, inboxPath, records: [], parseErrors: ['demand inbox is missing'] };
  }

  const records = [];
  const parseErrors = [];
  const lines = fs.readFileSync(inboxPath, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      parseErrors.push(`demand inbox line ${index + 1} is invalid JSON: ${error.message}`);
    }
  });
  return { repoRoot, inboxPath, records, parseErrors };
}

function validateSchedulerState(options = {}) {
  const { repoRoot, state } = loadSchedulerState(options);
  const { records: inboxRecords, parseErrors: inboxParseErrors } = loadDemandInbox(options);
  const errors = [];
  const activeId = state.active_task && state.active_task.id;
  const queuedActiveId = state.execution_queue && state.execution_queue.active && state.execution_queue.active.id;
  const allowedPaths = state.active_task && state.active_task.allowed_paths;

  if (!activeId) errors.push('active_task.id is required');
  if (!queuedActiveId) errors.push('execution_queue.active.id is required');
  if (activeId && queuedActiveId && activeId !== queuedActiveId) {
    errors.push(`active mismatch: active_task=${activeId}, execution_queue=${queuedActiveId}`);
  }
  if (activeId && !WORK_PACKAGE_ID_PATTERN.test(activeId)) {
    errors.push(`active_task.id must be a short work-package id (WP00-WP99): ${activeId}`);
  }
  const nextId = state.execution_queue && state.execution_queue.next && state.execution_queue.next.id;
  if (nextId && !WORK_PACKAGE_ID_PATTERN.test(nextId)) {
    errors.push(`execution_queue.next.id must be a short work-package id (WP00-WP99): ${nextId}`);
  }
  if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) {
    errors.push('active_task.allowed_paths must contain at least one path');
  }

  const queueIds = [];
  if (queuedActiveId) queueIds.push(queuedActiveId);
  if (state.execution_queue && state.execution_queue.next && state.execution_queue.next.id) {
    queueIds.push(state.execution_queue.next.id);
  }
  for (const lane of ['ready', 'parked', 'completed']) {
    for (const item of (state.execution_queue && state.execution_queue[lane]) || []) {
      if (item.id) queueIds.push(item.id);
    }
  }
  const duplicates = [...new Set(queueIds.filter((id, index) => queueIds.indexOf(id) !== index))];
  if (duplicates.length) errors.push(`queue ids must be unique: ${duplicates.join(', ')}`);
  const nonCanonicalWorkPackageIds = [...new Set(queueIds.filter((id) => id.startsWith('WP') && !WORK_PACKAGE_ID_PATTERN.test(id)))];
  if (nonCanonicalWorkPackageIds.length) {
    errors.push(`work-package queue ids must not contain names or slugs: ${nonCanonicalWorkPackageIds.join(', ')}`);
  }

  errors.push(...inboxParseErrors);
  const inboxIds = inboxRecords.map((record) => record && record.id).filter(Boolean);
  const duplicateInboxIds = [...new Set(inboxIds.filter((id, index) => inboxIds.indexOf(id) !== index))];
  if (duplicateInboxIds.length) {
    errors.push(`demand inbox ids must be unique: ${duplicateInboxIds.join(', ')}`);
  }
  const missingInboxIds = inboxRecords.filter((record) => !record || !record.id).length;
  if (missingInboxIds) errors.push(`demand inbox records missing id: ${missingInboxIds}`);

  try {
    const settingsPath = path.join(repoRoot, HARNESS_SETTINGS_RELATIVE_PATH);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const gateIds = Object.keys(settings.gates || {});
    const invalidGateIds = gateIds.filter((id) => !HARNESS_GATE_ID_PATTERN.test(id));
    if (invalidGateIds.length) {
      errors.push(`Harness gate ids must use HG namespace: ${invalidGateIds.join(', ')}`);
    }
    const missingGateIds = REQUIRED_HARNESS_GATE_IDS.filter((id) => !gateIds.includes(id));
    if (missingGateIds.length) {
      errors.push(`Harness settings must retain the six canonical gates: missing ${missingGateIds.join(', ')}`);
    }
    const extraGateIds = gateIds.filter((id) => !REQUIRED_HARNESS_GATE_IDS.includes(id));
    if (extraGateIds.length) {
      errors.push(`Harness settings may only define HG0-HG5: ${extraGateIds.join(', ')}`);
    }
    const phaseMismatches = REQUIRED_HARNESS_GATE_IDS.filter(
      (id) => settings.gates?.[id]?.phase !== HARNESS_GATE_PHASES[id]
    );
    if (phaseMismatches.length) {
      errors.push(`Harness gate phase mapping is invalid: ${phaseMismatches.join(', ')}`);
    }
  } catch (error) {
    errors.push(`Harness settings are invalid: ${error.message}`);
  }

  try {
    const harnessStatePath = path.join(repoRoot, HARNESS_STATE_RELATIVE_PATH);
    if (fs.existsSync(harnessStatePath)) {
      const harnessState = JSON.parse(fs.readFileSync(harnessStatePath, 'utf8'));
      const activeGates = harnessState.activeGates || [];
      const invalidActiveGates = activeGates.filter(
        (id) => !REQUIRED_HARNESS_GATE_IDS.includes(id)
      );
      if (invalidActiveGates.length) {
        errors.push(`active Harness gates must use HG namespace: ${invalidActiveGates.join(', ')}`);
      }
      if (activeGates.length > 1) {
        errors.push(`Harness state may activate at most one gate: ${activeGates.join(', ')}`);
      }
    }
  } catch (error) {
    errors.push(`Harness state is invalid: ${error.message}`);
  }

  const baselineStatus = state.product_baseline && state.product_baseline.status;
  if (state.active_task && state.active_task.kind === 'product' && baselineStatus !== 'active') {
    errors.push(`product task cannot be active while product baseline is ${baselineStatus || 'missing'}`);
  }

  return {
    ok: errors.length === 0,
    activeId,
    baselineStatus,
    errors
  };
}

function isSchedulerPathAllowed(filePath, options = {}) {
  const { repoRoot, state } = loadSchedulerState(options);
  const relativePath = toRepoRelative(filePath, { repoRoot });
  const allowedPaths = state.active_task.allowed_paths || [];
  return {
    allowed: allowedPaths.some((allowedPath) => {
      const normalized = normalizeRelative(allowedPath);
      return relativePath === normalized || relativePath.startsWith(`${normalized}/`);
    }),
    activeId: state.active_task.id,
    baselineStatus: state.product_baseline && state.product_baseline.status,
    relativePath
  };
}

function routeDemand(input) {
  if (Array.isArray(input.parts) && input.parts.length > 1) {
    return { route: 'split_required', activeSwitchAllowed: false };
  }
  if (input.userApprovedInterrupt === true) {
    return { route: 'approved_interrupt', activeSwitchAllowed: true };
  }
  if (input.invalidatesDirection === true || input.causesMajorRework === true || input.incident === true) {
    return { route: 'interrupt_candidate', activeSwitchAllowed: false };
  }
  if (input.kind === 'active_feedback' || input.blocksActiveAcceptance === true) {
    return { route: 'active_attachment', activeSwitchAllowed: false };
  }
  if (input.kind === 'question') {
    return { route: 'answer_or_research', activeSwitchAllowed: false };
  }
  return { route: 'inbox', activeSwitchAllowed: false };
}

function runSchedulerPressureTest() {
  const { state } = loadSchedulerState();
  const activeBefore = state.execution_queue.active.id;
  const cases = [
    { name: 'current implementation feedback', input: { kind: 'active_feedback' }, expected: 'active_attachment' },
    { name: 'ordinary favicon bug', input: { kind: 'bug' }, expected: 'inbox' },
    { name: 'Kiro reverse proxy lead', input: { kind: 'technical_lead' }, expected: 'inbox' },
    { name: 'organization cross-cutting request', input: { kind: 'cross_cutting_requirement' }, expected: 'inbox' },
    { name: 'direction invalidating evidence', input: { kind: 'product_decision', invalidatesDirection: true }, expected: 'interrupt_candidate' },
    { name: 'mixed request', input: { parts: ['bug', 'technical_lead', 'new_requirement'] }, expected: 'split_required' }
  ];
  const results = cases.map((testCase) => {
    const decision = routeDemand(testCase.input);
    return {
      name: testCase.name,
      expected: testCase.expected,
      actual: decision.route,
      activeSwitchAllowed: decision.activeSwitchAllowed,
      ok: decision.route === testCase.expected && decision.activeSwitchAllowed === false
    };
  });
  const activeAfter = loadSchedulerState().state.execution_queue.active.id;
  const ok = results.every((result) => result.ok) && activeBefore === activeAfter;
  return { ok, activeBefore, activeAfter, cases: results };
}

function runSchedulerCli(args) {
  const command = args[0] || 'scheduler-validate';
  if (command === 'scheduler-validate') {
    const result = validateSchedulerState();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 2;
  }

  if (command === 'scheduler-check') {
    const validation = validateSchedulerState();
    if (!validation.ok) {
      process.stderr.write(`SCHEDULER_INVALID: ${validation.errors.join('; ')}\n`);
      return 2;
    }
    const filePaths = args.slice(1);
    if (filePaths.length === 0) {
      process.stderr.write('scheduler-check requires at least one file path\n');
      return 2;
    }
    const results = filePaths.map((filePath) => isSchedulerPathAllowed(filePath));
    const blocked = results.filter((result) => !result.allowed);
    process.stdout.write(`${JSON.stringify({
      ok: blocked.length === 0,
      activeId: validation.activeId,
      baselineStatus: validation.baselineStatus,
      paths: results
    }, null, 2)}\n`);
    return blocked.length === 0 ? 0 : 2;
  }

  if (command === 'scheduler-pressure-test') {
    const result = runSchedulerPressureTest();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 2;
  }

  process.stderr.write(`unknown project-registry command: ${command}\n`);
  return 2;
}

function runProjectRegistryCli(args) {
  const [command, ...rest] = args;

  if (!command || command === 'status') {
    printStatus();
    return 0;
  }

  if (command === 'run-hook') {
    const [hookId, ...hookArgs] = rest;
    if (!hookId) {
      process.stderr.write('Usage: project-registry.js run-hook <hook-id> [args...]\n');
      return 1;
    }
    return runHook(hookId, hookArgs);
  }

  const { config } = getHarnessRuntime();
  if (config.hook_commands && config.hook_commands[command]) {
    return runHook(command, rest);
  }

  return runSchedulerCli(args);
}

module.exports = {
  DEMAND_INBOX_RELATIVE_PATH,
  HARNESS_GATE_ID_PATTERN,
  HARNESS_GATE_PHASES,
  HARNESS_SETTINGS_RELATIVE_PATH,
  HARNESS_STATE_RELATIVE_PATH,
  REGISTRY_RELATIVE_PATH,
  REQUIRED_HARNESS_GATE_IDS,
  WORK_PACKAGE_ID_PATTERN,
  findRepoRoot,
  getDocumentEntry,
  getHarnessRuntime,
  isEnabled,
  isWithinDocument,
  loadRegistry,
  loadDemandInbox,
  normalizeRelative,
  pathExists,
  printStatus,
  isSchedulerPathAllowed,
  loadSchedulerState,
  routeDemand,
  resolveEnabledDocumentPath,
  resolveDocumentPath,
  resolveRuntimePath,
  resolveHookCommand,
  runHook,
  runProjectRegistryCli,
  toRepoRelative,
  validateSchedulerState,
  runSchedulerPressureTest
};

if (require.main === module) {
  process.exitCode = runProjectRegistryCli(process.argv.slice(2));
}
