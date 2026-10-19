const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const core = require('./harness-core');
const workspace = require('./harness-workspace');
const registry = require('./project-registry');
const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'price-v3-wp39-')));
const root = path.join(sandbox, 'repo'), target = path.join(sandbox, 'target');
const scripts = 'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本';
const settingsPath = 'governance/runtime-config-AI运行配置/config-配置文件/settings-claude运行配置.json';
const env = { ...process.env };
for (const name of Object.keys(env)) if (name.startsWith('GIT_')) delete env[name];
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2)); }
fs.mkdirSync(root);
git(root, 'init'); git(root, 'config', 'user.name', 'Harness test'); git(root, 'config', 'user.email', 'test@example.invalid');
const actual = registry.findRepoRoot();
for (const file of ['project-registry.js', 'harness-workspace.js', 'harness-core.js', 'harness-goal.js']) write(path.join(root, scripts, file), fs.readFileSync(path.join(__dirname, file), 'utf8'));
write(path.join(root, settingsPath), fs.readFileSync(path.join(actual, settingsPath), 'utf8'));
write(path.join(root, registry.REGISTRY_RELATIVE_PATH), fs.readFileSync(path.join(actual, registry.REGISTRY_RELATIVE_PATH), 'utf8'));
write(path.join(root, registry.SCHEDULER_RELATIVE_PATH || 'governance/runtime-state/active-task.json'), fs.readFileSync(path.join(actual, 'governance/runtime-state/active-task.json'), 'utf8'));
write(path.join(root, registry.DEMAND_INBOX_RELATIVE_PATH), fs.readFileSync(path.join(actual, registry.DEMAND_INBOX_RELATIVE_PATH), 'utf8'));
write(path.join(root, '.codex/hooks/harness-adapter.js'), fs.readFileSync(path.join(actual, '.codex/hooks/harness-adapter.js'), 'utf8'));
git(root, 'add', '.'); git(root, 'commit', '-m', 'fixture'); git(root, 'worktree', 'add', '-b', 'candidate', target);
function prepare(directory) {
  const schedulerPath = path.join(directory, 'governance/runtime-state/active-task.json');
  const state = JSON.parse(fs.readFileSync(schedulerPath, 'utf8'));
  state.active_task.id = 'WP39';
  state.execution_queue.active.id = 'WP39';
  state.active_task.execution_workspace = directory;
  write(schedulerPath, state);
  core.startGoal(directory, 'Bounded repository implementation', { workPackageId: 'WP39', level: 'A3', scopes: 'app,governance/runtime-state', success: 'checks pass' });
  core.recordEvidence(directory, { status: 'pass', summary: 'fixture research', satisfies: ['research-check:repo-pattern-scan','research-check:reuse-or-library-scan','research-check:best-practice-check','research-check:user-intent-boundary-check'] });
  core.approveContract(directory, { level: 'A3', by: 'fixture' }); core.setPhase(directory, 'execute');
}
prepare(root); prepare(target);
after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

test('supported native tools use exact categories without granting arbitrary MCP names', () => {
  for (const name of ['collaboration.spawn_agent','collaborationspawn_agent','collaboration__followup_task']) assert.equal(core.normalizeToolName(name), 'Delegate');
  assert.equal(core.normalizeToolName('mcp__cua_repl__js'), 'Browser');
  assert.equal(core.normalizeToolName('web__run'), 'WebRead');
  for (const name of ['mcp__untrusted__spawn_agent','mcp__untrusted__get_project','mcp__untrusted__js']) assert.equal(core.normalizeToolName(name), name);
});
test('questions work in every stage; verification supports Chrome but refuses file edits', () => {
  for (const phase of ['intake','research','contract_review','execute','verify','approval']) {
    core.setPhase(root, phase);
    assert.equal(core.evaluateToolUse(root, { tool_name: 'request_user_input_async' }).ok, true, phase);
  }
  core.setPhase(root, 'verify');
  for (const name of ['mcp__cua_repl__js','collaborationspawn_agent','web__run']) assert.equal(core.evaluateToolUse(root, { tool_name: name }).ok, true, name);
  assert.equal(core.evaluateToolUse(root, { tool_name: 'Edit', tool_input: { file_path: path.join(root, 'app/page.tsx') } }).ok, false);
  core.setPhase(root, 'execute');
});
test('unapproved release, destructive and external mutations stay denied', () => {
  for (const command of ['git push origin main','git reset --hard','curl -X POST https://example.invalid','vercel deploy --prod']) assert.equal(core.evaluateToolUse(root, { tool_name: 'exec_command', tool_input: { command } }).ok, false, command);
});
test('a governance command mention cannot exempt a composed remote mutation', () => {
  const command = `node ${path.join(root, scripts, 'harness-goal.js')} status; git push origin main`;
  assert.equal(core.evaluateToolUse(root, { tool_name: 'exec_command', tool_input: { command } }).ok, false);
});
test('ordinary own runtime logs are allowed; authority, Git and foreign runtime paths are refused', () => {
  const own = workspace.identity(root).runtime, foreign = workspace.identity(target).runtime;
  const log = path.join(own, 'checks', 'target.log');
  assert.equal(registry.isSchedulerPathAllowed(log, { repoRoot: root }).allowed, true);
  assert.equal(core.evaluateToolUse(root, { tool_name: 'Write', tool_input: { file_path: log } }).ok, true);
  for (const file of [path.join(own, 'harness/action-approvals/new.json'), path.join(own, 'harness/workspace-binding.json'), path.join(own, 'delivery-evidence.json'), path.join(foreign, 'checks/test.log'), path.join(root, '.git/config')]) assert.equal(registry.isSchedulerPathAllowed(file, { repoRoot: root }).allowed, false, file);
  fs.mkdirSync(path.join(own, 'checks'), { recursive: true });
  fs.symlinkSync(sandbox, path.join(own, 'checks', 'escape'));
  assert.equal(registry.isSchedulerPathAllowed(path.join(own, 'checks/escape/outside.json'), { repoRoot: root }).allowed, false);
  fs.mkdirSync(path.join(own, 'harness'), { recursive: true });
  fs.symlinkSync(path.join(own, 'harness'), path.join(own, 'checks', 'control'));
  assert.equal(registry.isSchedulerPathAllowed(path.join(own, 'checks/control/state.json'), { repoRoot: root }).allowed, false);
});
test('adapter refuses relative writes after binding and permits only authorized recovery', () => {
  const inbox = path.join(target, registry.DEMAND_INBOX_RELATIVE_PATH);
  fs.appendFileSync(inbox, JSON.stringify({ id: 'IN-test-adapter', source: 'user_explicit', state: 'approved_execution', target: 'WP39', execution_workspace: target }) + '\n');
  workspace.bindWorkspace(root, target, 'IN-test-adapter');
  const invoke = payload => spawnSync(process.execPath, [path.join(root, '.codex/hooks/harness-adapter.js'), 'PreToolUse'], { cwd: root, env, encoding: 'utf8', input: JSON.stringify(payload) });
  const edit = file_path => ({ tool_name: 'Edit', tool_input: { file_path } });
  assert.equal(invoke(edit(registry.DEMAND_INBOX_RELATIVE_PATH)).status, 2);
  assert.equal(invoke(edit(inbox)).status, 0);
  assert.equal(invoke(edit(path.join(root, registry.DEMAND_INBOX_RELATIVE_PATH))).status, 2);
  assert.equal(invoke({ tool_name: 'apply_patch', tool_input: '*** Begin Patch\n*** Update File: ' + registry.DEMAND_INBOX_RELATIVE_PATH + '\n*** End Patch' }).status, 2);
  const command = `node ${path.join(target, scripts, 'harness-goal.js')} bind --caller ${root} --workspace ${target} --authority IN-test-adapter`;
  write(workspace.bindingPath(root), '{broken');
  assert.equal(invoke(edit(inbox)).status, 2);
  assert.equal(invoke({ tool_name: 'exec_command', tool_input: { cmd: command } }).status, 0);
  for (const cmd of [command + '; git push', command.replace('IN-test-adapter', 'IN-forged'), command.replace(' bind ', ' approve ')]) assert.equal(invoke({ tool_name: 'exec_command', tool_input: { cmd } }).status, 2);
  workspace.bindWorkspace(root, target, 'IN-test-adapter');
});
test('binding uses one registered authorized workspace and rejects stale or forged authority', () => {
  const inbox = path.join(target, registry.DEMAND_INBOX_RELATIVE_PATH);
  fs.appendFileSync(inbox, JSON.stringify({ id: 'IN-test-binding', source: 'user_explicit', state: 'approved_execution', target: 'WP39', execution_workspace: target }) + '\n');
  assert.equal(workspace.bindWorkspace(root, target, 'IN-test-binding').workspace, target);
  assert.equal(workspace.resolveExecutionWorkspace(root), target);
  assert.throws(() => workspace.bindWorkspace(root, target, 'IN-nonexistent'), /authority/);
  const schedulerFile = path.join(target, 'governance/runtime-state/active-task.json');
  const state = JSON.parse(fs.readFileSync(schedulerFile, 'utf8'));
  state.execution_queue.active.id = 'WP40'; write(schedulerFile, state);
  assert.throws(() => workspace.resolveExecutionWorkspace(root), /stale/);
  state.execution_queue.active.id = 'WP39'; write(schedulerFile, state);
  const bindingFile = workspace.bindingPath(root), binding = JSON.parse(fs.readFileSync(bindingFile, 'utf8'));
  binding.common = '/different/repository'; write(bindingFile, binding);
  assert.throws(() => workspace.resolveExecutionWorkspace(root), /crosses repositories/);
  write(bindingFile, '{broken'); assert.throws(() => workspace.resolveExecutionWorkspace(root));
});
