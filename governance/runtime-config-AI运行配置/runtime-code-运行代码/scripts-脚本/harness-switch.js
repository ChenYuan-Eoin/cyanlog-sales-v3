#!/usr/bin/env node
'use strict';

// Explicit mutator. Validators/hooks may call checkSwitch, but never recover
// implicitly: interrupted transactions remain locked until an operator recovers.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const registry = require('./project-registry');
const workspace = require('./harness-workspace');
const core = require('./harness-core');

const SCHEDULER = 'governance/runtime-state/active-task.json';
const EDITABLE_FIELDS = new Set(['active_task', 'execution_queue', 'parked_tasks', 'updated_at']);
const json = value => JSON.stringify(value, null, 2) + '\n';
const hash = value => value === null ? null : crypto.createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function switchLockPath(caller) {
  return path.join(workspace.identity(caller).common, 'codex-runtime', 'harness', 'workspace-switch.lock');
}

function fixedPaths(caller, target) {
  const runtime = core.paths(target);
  const expectedRuntime = path.join(workspace.identity(target).runtime, 'harness');
  if (runtime.statePath !== path.join(expectedRuntime, 'harness-state.json')
    || runtime.contractPath !== path.join(expectedRuntime, 'goal-contract.json')) {
    throw new Error('Harness runtime paths escaped the explicit execution worktree');
  }
  return [
    path.join(target, SCHEDULER),
    runtime.statePath,
    runtime.contractPath,
    workspace.bindingPath(caller)
  ];
}

function plainPath(file) {
  let current = path.resolve(file);
  while (true) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Switch control path cannot be a symlink: ${current}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function contents(file) {
  plainPath(file);
  try { return fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function atomicWrite(file, content, mode = 0o600) {
  plainPath(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, 'wx', mode);
  try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.renameSync(temporary, file); } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function checkCandidate(options) {
  if (process.env.PRICE_V3_HARNESS_RUNTIME_DIR) throw new Error('Switch refuses a Harness runtime override');
  const caller = workspace.identity(options.caller).root;
  const target = workspace.identity(options.workspace).root;
  const candidate = clone(options.candidate);
  if (candidate?.version !== 1) throw new Error('Switch candidate version must be 1');
  const activeId = candidate.scheduler?.active_task?.id;
  workspace.validateWorkspaceAuthority(caller, target, options.authority, activeId);
  if (candidate.scheduler?.active_task?.status !== 'active') throw new Error('Candidate Active must be active');
  if (fs.realpathSync(candidate.scheduler.active_task.execution_workspace) !== target) throw new Error('Candidate execution workspace mismatch');
  const current = read(path.join(target, SCHEDULER));
  for (const key of new Set([...Object.keys(current), ...Object.keys(candidate.scheduler)])) {
    if (!EDITABLE_FIELDS.has(key) && !equal(current[key], candidate.scheduler[key])) throw new Error(`Switch cannot change protected scheduler field: ${key}`);
  }
  // Queue entries only order work. They are editable during scheduling and
  // must never become an authorization snapshot on a subsequent switch.
  const known = [current.active_task,
    ...(Array.isArray(current.parked_tasks) ? current.parked_tasks : Object.values(current.parked_tasks || {}))];
  const approvedTask = known.find(item => item?.id === activeId && item.objective && item.delivery_contract && item.allowed_paths);
  if (!approvedTask) throw new Error('Candidate requires an existing complete scheduled task');
  const schedulingFields = new Set(['status', 'started_at', 'activation_basis', 'reason', 'parked_at', 'completed_at', 'ended_at', 'execution_workspace']);
  const businessFields = task => Object.fromEntries(Object.entries(task).filter(([key]) => !schedulingFields.has(key)));
  if (!equal(businessFields(approvedTask), businessFields(candidate.scheduler.active_task))) throw new Error('Candidate changes the existing task authorization scope');
  const parked = candidate.scheduler.parked_tasks || {};
  for (const task of Array.isArray(parked) ? parked : Object.values(parked)) {
    const original = known.find(item => item?.id === task?.id && item.objective && item.delivery_contract && item.allowed_paths);
    if (!original || !equal(businessFields(original), businessFields(task))) throw new Error('Candidate changes a saved task authorization scope');
  }
  const errors = core.validateContract(candidate.harnessContract);
  if (errors.length) throw new Error(`Candidate Harness contract: ${errors.join('; ')}`);
  const contract = candidate.harnessContract;
  const phaseCheck = core.canEnterPhase(contract, candidate.harnessState.phase);
  if (!phaseCheck.ok) throw new Error(`Candidate phase is not ready: ${phaseCheck.reason}`);
  if (candidate.harnessState.currentGoal?.status !== contract.status) throw new Error('Candidate Harness status mismatch');
  if (!contract.approvedBy || !Number.isFinite(Date.parse(contract.approvedAt || ''))) throw new Error('Candidate contract requires existing explicit approval metadata');
  if (!equal([...new Set(contract.boundaries?.allowedScopes || [])].sort(), [...new Set(candidate.scheduler.active_task.allowed_paths || [])].sort())) {
    throw new Error('Candidate Harness scopes must match Active allowed_paths');
  }
  if (candidate.harnessState.currentGoal?.objective !== contract.objective || contract.objective !== candidate.scheduler.active_task.objective) throw new Error('Candidate Active and Harness objectives must match');
  if (candidate.harnessState.currentGoal?.autonomy !== contract.autonomyBudget?.level) throw new Error('Candidate Harness autonomy mismatch');
  for (const pointer of [candidate.harnessState.currentGoal?.contractPath, candidate.harnessState.longTask?.contractPath].filter(Boolean)) {
    if (path.resolve(target, pointer) !== core.paths(target).contractPath) throw new Error('Candidate Harness contract path mismatch');
  }
  const result = registry.validateSchedulerCandidate({ repoRoot: target, scheduler: candidate.scheduler, harnessState: candidate.harnessState, harnessContract: candidate.harnessContract });
  if (!result.ok) throw new Error(`Candidate preflight failed: ${result.errors.join('; ')}`);
  return { caller, target, candidate, authority: options.authority, workPackageId: activeId };
}

function prepareSwitch(options) {
  const plan = checkCandidate(options);
  const lock = switchLockPath(plan.caller);
  plainPath(lock);
  if (fs.existsSync(lock)) throw new Error(`Harness switch is locked; inspect or recover: ${lock}`);
  const previousWorkspace = workspace.resolveExecutionWorkspace(plan.caller);
  for (const directory of new Set([previousWorkspace, plan.target])) {
    const check = registry.validateSchedulerState({ repoRoot: directory });
    if (!check.ok) throw new Error(`Existing workspace is inconsistent: ${check.errors.join('; ')}`);
  }
  const binding = { version: 1, workspace: plan.target, common: workspace.identity(plan.target).common,
    workPackageId: plan.workPackageId, authority: plan.authority, createdAt: new Date().toISOString() };
  const values = [plan.candidate.scheduler, plan.candidate.harnessState, plan.candidate.harnessContract, binding];
  const entries = fixedPaths(plan.caller, plan.target).map((file, index) => {
    const before = contents(file), after = json(values[index]);
    if (index < 3 && before === null) throw new Error('Existing scheduler and Harness files are required');
    return { file, before, after, beforeHash: hash(before), afterHash: hash(after), mode: before === null ? 0o600 : fs.statSync(file).mode & 0o777 };
  });
  const dependencies = [path.join(plan.target, registry.DEMAND_INBOX_RELATIVE_PATH), path.join(plan.target, registry.HARNESS_SETTINGS_RELATIVE_PATH)]
    .map(file => ({ file, sha256: hash(contents(file)) }));
  return { ...plan, lock, entries, dependencies };
}

function checkSwitch(options) {
  const plan = prepareSwitch(options);
  return { ok: true, caller: plan.caller, workspace: plan.target, authority: plan.authority, workPackageId: plan.workPackageId };
}

function assertKnownEntries(entries, onlyBefore = false) {
  for (const entry of entries) {
    const actual = hash(contents(entry.file));
    if (actual !== entry.beforeHash && (onlyBefore || actual !== entry.afterHash)) throw new Error(`Concurrent external edit; refusing to overwrite ${entry.file}`);
  }
}

function restoreEntries(entries) {
  // Check the whole transaction before restoring any file. A foreign edit must
  // not cause a partial rollback that silently overwrites newer work.
  assertKnownEntries(entries);
  for (const entry of [...entries].reverse()) {
    const actual = hash(contents(entry.file));
    if (actual === entry.beforeHash) continue;
    if (actual !== entry.afterHash) throw new Error(`Concurrent external edit: ${entry.file}`);
    if (entry.before === null) fs.unlinkSync(entry.file);
    else atomicWrite(entry.file, entry.before, entry.mode);
  }
  assertKnownEntries(entries, true);
}

function releaseLock(file, transactionId) {
  if (JSON.parse(contents(file)).transactionId !== transactionId) throw new Error('Switch lock ownership changed');
  fs.unlinkSync(file);
}

function switchWorkspace(options, testHooks = {}) {
  const plan = prepareSwitch(options);
  const transactionId = crypto.randomUUID();
  const directory = path.join(workspace.identity(plan.target).runtime, 'harness', 'switch-transactions');
  const journalFile = path.join(directory, `${transactionId}.json`);
  const journal = { version: 1, transactionId, caller: plan.caller, workspace: plan.target, authority: plan.authority,
    workPackageId: plan.workPackageId, entries: plan.entries, dependencies: plan.dependencies, createdAt: new Date().toISOString() };
  const journalText = json(journal);
  atomicWrite(journalFile, journalText);
  const lock = { version: 1, transactionId, pid: process.pid, caller: plan.caller, workspace: plan.target, authority: plan.authority,
    workPackageId: plan.workPackageId, journal: journalFile, journalHash: hash(journalText) };
  const stagingLock = path.join(directory, `${transactionId}.lock`);
  atomicWrite(stagingLock, json(lock));
  plainPath(plan.lock);
  fs.mkdirSync(path.dirname(plan.lock), { recursive: true });
  // A hard link publishes complete lock bytes atomically; an empty crash-window
  // lock can never block recovery. Both paths belong to the same Git filesystem.
  try { fs.linkSync(stagingLock, plan.lock); } finally { fs.unlinkSync(stagingLock); }
  const resultFile = path.join(directory, `${transactionId}.result.json`);
  try {
    assertKnownEntries(plan.entries, true);
    for (const item of plan.dependencies) if (hash(contents(item.file)) !== item.sha256) throw new Error('Switch authority or policy changed during preparation');
    checkCandidate(options);
    for (let index = 0; index < plan.entries.length; index++) {
      assertKnownEntries(plan.entries);
      const entry = plan.entries[index];
      atomicWrite(entry.file, entry.after, entry.mode);
      testHooks.afterWrite?.(index, clone(lock));
    }
    const check = registry.validateSchedulerState({ repoRoot: plan.target });
    if (!check.ok) throw new Error(`Applied preflight failed: ${check.errors.join('; ')}`);
    workspace.validateBinding(plan.caller, read(workspace.bindingPath(plan.caller)));
    atomicWrite(resultFile, json({ status: 'applied', at: new Date().toISOString() }));
    releaseLock(plan.lock, transactionId);
    return { ok: true, workPackageId: plan.workPackageId, workspace: plan.target, transactionId, journal: journalFile };
  } catch (error) {
    try {
      restoreEntries(plan.entries);
      atomicWrite(resultFile, json({ status: 'rolled_back', at: new Date().toISOString(), reason: error.message }));
      releaseLock(plan.lock, transactionId);
    } catch (recoveryError) {
      throw new Error(`Switch failed (${error.message}); explicit recovery required: ${recoveryError.message}`);
    }
    throw new Error(`Switch rolled back: ${error.message}`);
  }
}

function inspectRecovery(options, allowLive = false) {
  const caller = workspace.identity(options.caller).root, target = workspace.identity(options.workspace).root;
  const file = switchLockPath(caller);
  const lock = JSON.parse(contents(file));
  if (lock.version !== 1 || lock.caller !== caller || lock.workspace !== target || lock.authority !== options.authority || !/^[0-9a-f-]{36}$/.test(lock.transactionId)) throw new Error('Switch recovery identity mismatch');
  workspace.validateWorkspaceAuthority(caller, target, options.authority, lock.workPackageId);
  if (!allowLive) {
    if (!Number.isInteger(lock.pid) || lock.pid <= 0) throw new Error('Invalid switch owner PID');
    try { process.kill(lock.pid, 0); throw new Error('Switch owner is still running'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  const journalFile = path.join(workspace.identity(target).runtime, 'harness', 'switch-transactions', `${lock.transactionId}.json`);
  if (lock.journal !== journalFile) throw new Error('Switch recovery journal path mismatch');
  const journalText = contents(journalFile);
  if (hash(journalText) !== lock.journalHash) throw new Error('Switch recovery journal hash mismatch');
  const journal = JSON.parse(journalText);
  if (journal.version !== 1 || journal.transactionId !== lock.transactionId || journal.caller !== caller || journal.workspace !== target || journal.authority !== options.authority || journal.workPackageId !== lock.workPackageId) throw new Error('Switch recovery journal identity mismatch');
  const expected = fixedPaths(caller, target);
  if (!Array.isArray(journal.entries) || journal.entries.length !== expected.length) throw new Error('Switch recovery file set mismatch');
  for (const [index, entry] of journal.entries.entries()) {
    if (entry.file !== expected[index] || (entry.before !== null && typeof entry.before !== 'string') || typeof entry.after !== 'string'
      || entry.beforeHash !== hash(entry.before) || entry.afterHash !== hash(entry.after) || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777) throw new Error('Switch recovery snapshot mismatch');
  }
  assertKnownEntries(journal.entries);
  return { lock, file, journal, journalFile };
}

function recoverSwitch(options) {
  const { lock, file, journal, journalFile } = inspectRecovery(options);
  restoreEntries(journal.entries);
  atomicWrite(journalFile.replace(/\.json$/, '.result.json'), json({ status: 'recovered', at: new Date().toISOString() }));
  releaseLock(file, lock.transactionId);
  return { ok: true, status: 'recovered', transactionId: lock.transactionId, workspace: lock.workspace };
}

module.exports = { checkSwitch, prepareSwitch, switchWorkspace, recoverSwitch, inspectRecovery, switchLockPath };
