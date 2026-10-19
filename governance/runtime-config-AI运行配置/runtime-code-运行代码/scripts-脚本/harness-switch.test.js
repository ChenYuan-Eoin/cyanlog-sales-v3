'use strict';
// Fixture APIs also invoke Git internally. Isolate the entire test process
// before loading them, not merely the explicit git() helper below.
for (const name of Object.keys(process.env)) if (name.startsWith('GIT_')) delete process.env[name];
delete process.env.PRICE_V3_HARNESS_RUNTIME_DIR;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const registry = require('./project-registry');
const core = require('./harness-core');
const workspace = require('./harness-workspace');
const subject = require('./harness-switch');
const SCHEDULER = 'governance/runtime-state/active-task.json';
const SCRIPTS = 'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本';
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('GIT_') || key === 'PRICE_V3_HARNESS_RUNTIME_DIR') delete env[key];
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const json = value => JSON.stringify(value, null, 2) + '\n';
const clone = value => JSON.parse(JSON.stringify(value));
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : json(value)); }

function pair(root, scheduler, id) {
  const objective = `Bounded ${id} work`;
  const harnessContract = core.makeGoalContract(objective, { level: 'A1', workPackageId: id, scopes: 'app,governance/runtime-state', success: 'checks pass' });
  Object.assign(harnessContract, { status: 'approved', approvedAt: new Date().toISOString(), approvedBy: 'existing-user-authority:IN-switch' });
  harnessContract.evidence.collected.push({ status: 'pass', summary: 'Fixture research completed', satisfies: harnessContract.researchPlan.requiredChecks.map(check => `research-check:${check.id}`) });
  harnessContract.phase.current = 'execute'; harnessContract.phase.gate = 'HG3';
  scheduler.active_task = { id, name: objective, slug: 'bounded-work', status: 'active', kind: 'governance', objective,
    execution_workspace: root, started_at: '2026-01-01T00:00:00.000Z', allowed_paths: ['app', 'governance/runtime-state'],
    delivery_contract: { target_state: 'code_green', allowed_states: ['executing', 'code_green'], integration_branch: 'main', production_branch: 'production',
      production_release_separate: true, same_release_commit_required: true, attestation_ref: 'refs/notes/price-v3-delivery',
      required_code_checks: ['target_tests', 'full_tests', 'lint', 'typecheck', 'build'], required_runtime_evidence: ['provider_probe', 'review_run', 'model_invocations', 'tokens'] } };
  scheduler.execution_queue = { active: { id }, next: { id: id === 'WP39' ? 'WP40' : 'WP39' }, ready: [], parked: [], completed: [] };
  const harnessState = { version: '1.0', status: 'enforcing', mode: 'enforcing', phase: 'execute', activeGates: ['HG3'],
    currentGoal: { id: harnessContract.id, workPackageId: id, objective, status: 'approved', autonomy: 'A1' } };
  return { version: 1, scheduler, harnessState, harnessContract };
}

function fixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'price-v3-switch-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const caller = path.join(base, 'caller'), target = path.join(base, 'target');
  fs.mkdirSync(caller); git(caller, 'init'); git(caller, 'config', 'user.name', 'Switch test'); git(caller, 'config', 'user.email', 'test@example.invalid');
  const settings = path.join(registry.findRepoRoot(), registry.HARNESS_SETTINGS_RELATIVE_PATH);
  write(path.join(caller, registry.HARNESS_SETTINGS_RELATIVE_PATH), fs.readFileSync(settings, 'utf8'));
  write(path.join(caller, registry.REGISTRY_RELATIVE_PATH), fs.readFileSync(path.join(registry.findRepoRoot(), registry.REGISTRY_RELATIVE_PATH), 'utf8'));
  for (const file of ['project-registry.js', 'harness-core.js', 'harness-workspace.js', 'harness-goal.js', 'harness-switch.js']) {
    write(path.join(caller, SCRIPTS, file), fs.readFileSync(path.join(__dirname, file), 'utf8'));
  }
  const current = pair(caller, { product_baseline: { status: 'active' }, protected_snapshot: { keep: 'dirty' }, scheduling_policy: { wip_limit: 1 } }, 'WP39');
  current.scheduler.parked_tasks = { WP40: pair(target, clone(current.scheduler), 'WP40').scheduler.active_task };
  write(path.join(caller, SCHEDULER), current.scheduler);
  write(path.join(caller, registry.DEMAND_INBOX_RELATIVE_PATH), '');
  git(caller, 'add', '.'); git(caller, 'commit', '-m', 'fixture'); git(caller, 'worktree', 'add', '-b', 'target', target);
  for (const root of [caller, target]) {
    const initial = pair(root, clone(current.scheduler), 'WP39');
    write(path.join(root, SCHEDULER), initial.scheduler);
    write(core.paths(root).statePath, initial.harnessState); write(core.paths(root).contractPath, initial.harnessContract);
  }
  write(path.join(target, registry.DEMAND_INBOX_RELATIVE_PATH), [
    { id: 'IN-original', source: 'user_explicit', state: 'approved_execution', target: 'WP39', execution_workspace: target },
    { id: 'IN-switch', source: 'user_explicit', state: 'approved_execution', target: 'WP40', execution_workspace: target }
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
  const originalBinding = { version: 1, workspace: target, common: workspace.identity(target).common, workPackageId: 'WP39', authority: 'IN-original' };
  write(workspace.bindingPath(caller), originalBinding);
  const candidate = pair(target, clone(current.scheduler), 'WP40');
  const options = { caller, workspace: target, authority: 'IN-switch', candidate };
  const files = [path.join(target, SCHEDULER), core.paths(target).statePath, core.paths(target).contractPath, workspace.bindingPath(caller)];
  const before = files.map(file => fs.readFileSync(file, 'utf8'));
  const unchanged = () => files.forEach((file, index) => assert.equal(fs.readFileSync(file, 'utf8'), before[index], file));
  return { base, caller, target, candidate, options, files, unchanged };
}

test('candidate validation is read-only, and normal validation ignores injected snapshots', t => {
  const f = fixture(t);
  assert.equal(subject.checkSwitch(f.options).ok, true); f.unchanged();
  assert.equal(fs.existsSync(subject.switchLockPath(f.caller)), false);
  const invalid = clone(f.candidate); invalid.scheduler.active_task.delivery_contract.allowed_states = ['code_green'];
  assert.equal(registry.validateSchedulerCandidate({ repoRoot: f.target, ...invalid }).ok, false);
  assert.equal(registry.validateSchedulerState({ repoRoot: f.target, ...invalid }).ok, true);
  f.unchanged();
});

test('invalid static contracts, phase mismatch, forged authority, scopes and protected state leave originals intact', t => {
  const f = fixture(t);
  const changes = [
    c => { c.scheduler.active_task.delivery_contract.allowed_states = ['code_green']; },
    c => { c.scheduler.execution_queue.next.id = 'WP40-long-name'; },
    c => { c.harnessContract.phase.current = 'verify'; },
    c => { c.harnessContract.status = 'draft'; },
    c => { c.harnessContract.evidence.collected = []; },
    c => { c.harnessState.currentGoal.status = 'draft'; },
    c => { c.harnessState.currentGoal.contractPath = '/foreign/goal-contract.json'; },
    c => { c.harnessContract.boundaries.allowedScopes.push('/'); },
    c => { c.scheduler.protected_snapshot.keep = 'discarded'; },
    c => { c.scheduler.product_baseline.status = 'draft'; },
    c => { c.scheduler.scheduling_policy.wip_limit = 2; }
  ];
  for (const change of changes) {
    const candidate = clone(f.candidate); change(candidate);
    assert.throws(() => subject.switchWorkspace({ ...f.options, candidate })); f.unchanged();
  }
  assert.throws(() => subject.switchWorkspace({ ...f.options, authority: 'IN-forged' }), /authority/); f.unchanged();
  assert.equal(fs.existsSync(subject.switchLockPath(f.caller)), false);
});

test('an old authority cannot expand the saved task scope or introduce an unscheduled task', t => {
  const f = fixture(t);
  for (const change of [
    c => { c.scheduler.active_task.allowed_paths.push('secrets'); c.harnessContract.boundaries.allowedScopes.push('secrets'); },
    c => { c.scheduler.active_task.objective = 'different product'; c.harnessContract.objective = 'different product'; c.harnessState.currentGoal.objective = 'different product'; },
    c => { c.scheduler.active_task.delivery_contract.target_state = 'clean_preview_green'; c.scheduler.active_task.delivery_contract.allowed_states.push('clean_preview_green'); }
  ]) {
    const candidate = clone(f.candidate); change(candidate);
    assert.throws(() => subject.switchWorkspace({ ...f.options, candidate }), /authorization scope/); f.unchanged();
  }
  const parkedCandidate = clone(f.candidate); parkedCandidate.scheduler.parked_tasks.WP40.allowed_paths.push('secrets');
  assert.throws(() => subject.switchWorkspace({ ...f.options, candidate: parkedCandidate }), /saved task authorization scope/); f.unchanged();
  const current = JSON.parse(fs.readFileSync(f.files[0], 'utf8')); delete current.parked_tasks.WP40; write(f.files[0], current);
  assert.throws(() => subject.switchWorkspace(f.options), /complete scheduled task/);
});

test('a valid switch binds scheduler, approved Harness and caller together', t => {
  const f = fixture(t), result = subject.switchWorkspace(f.options);
  assert.equal(result.ok, true);
  assert.equal(registry.validateSchedulerState({ repoRoot: f.target }).ok, true);
  assert.equal(workspace.resolveExecutionWorkspace(f.caller), f.target);
  assert.equal(JSON.parse(fs.readFileSync(workspace.bindingPath(f.caller))).workPackageId, 'WP40');
  assert.equal(fs.existsSync(subject.switchLockPath(f.caller)), false);
});

test('a queued full task cannot launder expanded authority through a second switch', t => {
  const f = fixture(t);
  const original = JSON.parse(fs.readFileSync(f.files[0], 'utf8')).active_task;
  const injected = { ...clone(original), allowed_paths: [...original.allowed_paths, 'secrets'] };
  f.candidate.scheduler.parked_tasks.WP39 = clone(original);
  f.candidate.scheduler.execution_queue.next = injected;
  assert.equal(subject.switchWorkspace(f.options).ok, true);
  const second = pair(f.target, clone(f.candidate.scheduler), 'WP39');
  second.scheduler.active_task.allowed_paths.push('secrets');
  second.harnessContract.boundaries.allowedScopes.push('secrets');
  assert.throws(() => subject.switchWorkspace({ ...f.options, authority: 'IN-original', candidate: second }), /authorization scope/);
  assert.equal(JSON.parse(fs.readFileSync(f.files[0], 'utf8')).active_task.id, 'WP40');
});

test('each write failure restores all four original byte snapshots', t => {
  const f = fixture(t);
  for (let failure = 0; failure < 4; failure++) {
    assert.throws(() => subject.switchWorkspace(f.options, { afterWrite(index) { if (index === failure) throw new Error('injected write failure'); } }), /rolled back/);
    f.unchanged(); assert.equal(fs.existsSync(subject.switchLockPath(f.caller)), false);
    assert.equal(workspace.resolveExecutionWorkspace(f.caller), f.target);
  }
});

test('concurrent switch is refused, and live owner cannot be recovered', t => {
  const f = fixture(t);
  subject.switchWorkspace(f.options, { afterWrite(index) {
    if (index !== 0) return;
    assert.throws(() => subject.switchWorkspace(f.options), /locked/);
    assert.throws(() => subject.recoverSwitch(f.options), /still running/);
  } });
  assert.equal(registry.validateSchedulerState({ repoRoot: f.target }).ok, true);
});

function interrupt(f) {
  const script = `require(${JSON.stringify(require.resolve('./harness-switch'))}).switchWorkspace(${JSON.stringify(f.options)}, { afterWrite(index) { if(index===1) process.kill(process.pid, 'SIGKILL'); } });`;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: f.target, env, encoding: 'utf8' });
  assert.equal(result.signal, 'SIGKILL', result.stderr);
  assert.equal(fs.existsSync(subject.switchLockPath(f.caller)), true);
}

test('hard interruption remains visibly locked until explicit hash-checked recovery', t => {
  const f = fixture(t); interrupt(f);
  assert.throws(() => workspace.resolveExecutionWorkspace(f.caller), /switch|recover|locked/i);
  const script = path.join(f.target, SCRIPTS, 'harness-goal.js');
  const args = [script, 'recover-switch', '--caller', f.caller, '--workspace', f.target, '--authority', 'IN-switch'];
  const command = ['node', ...args].join(' ');
  const permitted = cmd => workspace.isBindingRecovery(f.caller, { tool_name: 'exec_command', tool_input: { cmd } });
  assert.equal(permitted(command), true);
  for (const bad of [command.replace('recover-switch', 'bind'), command + '; git push', command.replace('--caller ' + f.caller, '--caller ' + f.target), command.replace('IN-switch', 'IN-original')]) assert.equal(permitted(bad), false, bad);
  assert.throws(() => workspace.bindWorkspace(f.caller, f.target, 'IN-switch'), /recover|pending/i);
  const recovered = spawnSync(process.execPath, args, { cwd: f.target, env, encoding: 'utf8' });
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(JSON.parse(recovered.stdout).status, 'recovered');
  f.unchanged(); assert.equal(workspace.resolveExecutionWorkspace(f.caller), f.target);
});

test('recovery refuses external edits and preserves the lock instead of overwriting them', t => {
  const f = fixture(t); interrupt(f);
  const external = 'external edit must survive\n'; fs.writeFileSync(f.files[0], external);
  assert.throws(() => subject.recoverSwitch(f.options), /external edit/);
  assert.equal(fs.readFileSync(f.files[0], 'utf8'), external);
  assert.equal(fs.existsSync(subject.switchLockPath(f.caller)), true);
});

test('recovery rejects forged journal paths or changed snapshot bytes', t => {
  const f = fixture(t); interrupt(f);
  const file = subject.switchLockPath(f.caller), original = fs.readFileSync(file, 'utf8'), lock = JSON.parse(original);
  write(file, { ...lock, journal: path.join(f.base, 'other.json') });
  assert.throws(() => subject.recoverSwitch(f.options), /journal path/);
  fs.writeFileSync(file, original);
  fs.appendFileSync(lock.journal, ' ');
  assert.throws(() => subject.recoverSwitch(f.options), /journal hash/);
});

test('hook Git pointers cannot redirect registry evidence, notes or a switch into another repository', t => {
  const f = fixture(t), foreign = fixture(t);
  const foreignGit = git(foreign.target, 'rev-parse', '--absolute-git-dir');
  const foreignCommon = workspace.identity(foreign.target).common;
  const sentinel = path.join(workspace.identity(foreign.target).runtime, 'delivery-evidence.json');
  write(sentinel, { sentinel: 'caller evidence must not change' });
  const protectedFiles = [path.join(foreignCommon, 'config'), path.join(foreignGit, 'index'), sentinel];
  const protectedBytes = protectedFiles.map(file => fs.readFileSync(file));
  const foreignNotes = git(foreign.target, 'for-each-ref', 'refs/notes');
  const poisoned = { ...env, GIT_DIR: foreignGit, GIT_COMMON_DIR: foreignCommon,
    GIT_INDEX_FILE: path.join(foreignGit, 'index'), GIT_OBJECT_DIRECTORY: path.join(foreignCommon, 'objects'),
    GIT_NAMESPACE: 'caller-hook', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.worktree', GIT_CONFIG_VALUE_0: foreign.target };
  const script = `
    const assert = require('node:assert/strict');
    const registry = require(${JSON.stringify(require.resolve('./project-registry'))});
    const switches = require(${JSON.stringify(require.resolve('./harness-switch'))});
    const options = ${JSON.stringify(f.options)};
    assert.equal(registry.validateSchedulerState({repoRoot: options.workspace}).ok, true);
    const runtime = registry.recordDeliveryEvidence('code', {fixture: 'git environment isolation'}, {repoRoot: options.workspace});
    assert.equal(registry.loadDeliveryRuntime({repoRoot: options.workspace}).runtimePath, ${JSON.stringify(path.join(workspace.identity(f.target).runtime, 'delivery-evidence.json'))});
    const seal = registry.sealDeliveryAttestation({repoRoot: options.workspace, remoteSnapshot: {}});
    assert.equal(seal.unchanged, false);
    assert.equal(switches.switchWorkspace(options).ok, true);
    console.log('fixture Git state, runtime evidence, note and switch remained inside explicit workspace');
  `;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: f.target, env: poisoned, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(JSON.parse(fs.readFileSync(f.files[0], 'utf8')).active_task.id, 'WP40');
  foreign.unchanged();
  protectedFiles.forEach((file, index) => assert.deepEqual(fs.readFileSync(file), protectedBytes[index], file));
  assert.equal(git(foreign.target, 'for-each-ref', 'refs/notes'), foreignNotes);
});
