const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
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

test('repository Git reads ignore inherited hook pointers without touching the caller runtime or index', () => {
  const source = path.join(sandbox, 'hook-source'), destination = path.join(sandbox, 'hook-destination');
  const sibling = path.join(sandbox, 'hook-sibling');
  const initializeGoal = directory => {
    core.startGoal(directory, 'Validate isolated Preview', { workPackageId: 'WP40', level: 'A3', scopes: 'app', success: 'checks pass' });
    core.approveContract(directory, { level: 'A3', by: 'fixture' });
    core.recordEvidence(directory, { status: 'pass', summary: 'fixture research', satisfies: core.loadContract(directory).researchPlan.requiredChecks.map(item => `research-check:${item.id}`) });
    core.setPhase(directory, 'execute');
  };
  for (const directory of [source, destination]) {
    fs.mkdirSync(directory);
    git(directory, 'init'); git(directory, 'config', 'user.name', 'Harness test'); git(directory, 'config', 'user.email', 'test@example.invalid');
    write(path.join(directory, settingsPath), fs.readFileSync(path.join(actual, settingsPath), 'utf8'));
    write(path.join(directory, '.vercel/project.json'), { projectId: 'prj_test', orgId: 'team_test' });
    write(path.join(directory, 'README.md'), directory);
    git(directory, 'add', '.'); git(directory, 'commit', '-m', 'Hook fixture');
    initializeGoal(directory);
  }
  git(destination, 'worktree', 'add', '-b', 'sibling', sibling);
  write(path.join(sibling, 'README.md'), 'Distinct sibling HEAD');
  git(sibling, 'add', '.'); git(sibling, 'commit', '-m', 'Sibling fixture');
  initializeGoal(sibling);
  const sourcePaths = core.paths(source);
  const guarded = [sourcePaths.statePath, sourcePaths.contractPath, sourcePaths.evidenceLedgerPath, git(source, 'rev-parse', '--path-format=absolute', '--git-path', 'index')];
  const before = guarded.map(file => fs.readFileSync(file));
  const expectedRuntime = git(destination, 'rev-parse', '--path-format=absolute', '--git-path', 'codex-runtime/harness');
  const poisoned = {
    ...env,
    GIT_DIR: git(source, 'rev-parse', '--absolute-git-dir'),
    GIT_COMMON_DIR: git(source, 'rev-parse', '--path-format=absolute', '--git-common-dir'),
    GIT_WORK_TREE: source,
    GIT_INDEX_FILE: guarded[3],
    GIT_PREFIX: 'foreign-prefix/',
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.worktree', GIT_CONFIG_VALUE_0: source
  };
  delete poisoned.PRICE_V3_HARNESS_RUNTIME_DIR;
  const script = `
    const assert = require('node:assert/strict');
    const core = require(${JSON.stringify(require.resolve('./harness-core'))});
    const destination = ${JSON.stringify(destination)}, source = ${JSON.stringify(source)}, sibling = ${JSON.stringify(sibling)};
    assert.equal(core.paths(destination).runtimeDir, ${JSON.stringify(expectedRuntime)});
    core.recordEvidence(destination, { status: 'pass', summary: 'Hook environment stays isolated' });
    const command = 'vercel deploy --target preview --scope team_test';
    const binding = core.actionBinding(destination, command, destination);
    assert.equal(binding.workspace, destination);
    assert.equal(binding.head, ${JSON.stringify(git(destination, 'rev-parse', 'HEAD'))});
    const siblingBinding = core.actionBinding(destination, command, sibling);
    assert.equal(siblingBinding.workspace, sibling);
    assert.equal(siblingBinding.head, ${JSON.stringify(git(sibling, 'rev-parse', 'HEAD'))});
    assert.throws(() => core.actionBinding(destination, command, source), /another repository/);
  `;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: destination, env: poisoned, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  guarded.forEach((file, index) => assert.deepEqual(fs.readFileSync(file), before[index], `foreign file must remain unchanged: ${file}`));
  assert.match(fs.readFileSync(path.join(expectedRuntime, 'evidence-ledger.jsonl'), 'utf8'), /Hook environment stays isolated/);
});

test('supported native tools use exact categories without granting arbitrary MCP names', () => {
  for (const name of ['collaboration.spawn_agent','collaborationspawn_agent','collaboration__followup_task']) assert.equal(core.normalizeToolName(name), 'Delegate');
  assert.equal(core.normalizeToolName('mcp__cua_repl__js'), 'Browser');
  assert.equal(core.normalizeToolName('web__run'), 'WebRead');
  for (const name of ['mcp__untrusted__spawn_agent','mcp__untrusted__get_project','mcp__untrusted__js']) assert.equal(core.normalizeToolName(name), name);
});
test('native conversation goals keep read and management separate from local Harness authority', () => {
  const readNames = ['get_goal', 'functions.get_goal', 'functions__get_goal'];
  const manageNames = ['create_goal', 'functions.create_goal', 'functions__create_goal', 'update_goal', 'functions.update_goal', 'functions__update_goal'];
  for (const name of readNames) assert.equal(core.normalizeToolName(name), 'Read', name);
  for (const name of manageNames) assert.equal(core.normalizeToolName(name), 'GoalManage', name);
  const localPaths = core.paths(root);
  const controlFiles = [localPaths.statePath, localPaths.contractPath, localPaths.evidenceLedgerPath, path.join(workspace.identity(root).runtime, 'delivery-evidence.json')];
  const snapshot = () => controlFiles.map(file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
  for (const phase of ['intake','research','contract_review','execute','verify','approval']) {
    core.setPhase(root, phase);
    const before = snapshot();
    for (const name of [...readNames, ...manageNames]) {
      const result = core.evaluateToolUse(root, { tool_name: name, tool_input: { objective: 'Conversation objective', status: 'complete' } });
      assert.equal(result.ok, true, `${phase}: ${name}`);
      assert.equal(result.matrix.targetObject, 'conversation-goal');
      assert.match(result.matrix.rows.find(row => row.id === 'action_type').detail, new RegExp(`category=${readNames.includes(name) ? 'read' : 'goal'};`));
      assert.match(result.matrix.rows.find(row => row.id === 'control_plane').detail, /local Harness approval, phase and delivery state remain independent/);
    }
    assert.deepEqual(snapshot(), before, `${phase}: native goal checks must not mutate local authority or delivery state`);
  }
  const settingsFile = path.join(root, settingsPath), originalSettings = fs.readFileSync(settingsFile, 'utf8');
  try {
    const settings = JSON.parse(originalSettings);
    settings.gates.HG5.tools = settings.gates.HG5.tools.filter(name => name !== 'GoalManage');
    write(settingsFile, settings);
    assert.equal(core.evaluateToolUse(root, { tool_name: 'get_goal' }).ok, true);
    assert.equal(core.evaluateToolUse(root, { tool_name: 'update_goal', tool_input: { status: 'complete' } }).ok, false, 'Read alone must not grant goal management');
  } finally {
    write(settingsFile, originalSettings);
    core.setPhase(root, 'execute');
  }
  for (const name of ['mcp__untrusted__get_goal', 'mcp__untrusted__create_goal', 'mcp__untrusted__update_goal', 'unknown.get_goal', 'functions.get_goal_extra']) {
    assert.equal(core.normalizeToolName(name), name);
    assert.equal(core.evaluateToolUse(root, { tool_name: name }).ok, false, name);
  }
  assert.equal(core.evaluateToolUse(root, { tool_name: 'Write', tool_input: { file_path: localPaths.contractPath } }).ok, false);
  assert.equal(core.evaluateToolUse(root, { tool_name: 'exec_command', tool_input: { command: 'git push origin main' } }).ok, false);
});
test('only exact read-only Vercel deployment-file tool aliases are admitted', () => {
  core.setPhase(root, 'verify');
  try {
    for (const separator of ['_', '__']) for (const operation of ['list_deployment_files', 'get_deployment_file_contents']) {
      const name = `mcp__codex_apps__vercel${separator}${operation}`;
      assert.equal(core.normalizeToolName(name), 'Read', name);
      assert.equal(core.evaluateToolUse(root, { tool_name: name }).ok, true, name);
    }
    for (const name of ['mcp__untrusted__list_deployment_files', 'mcp__codex_apps__vercel___list_deployment_files', 'mcp__codex_apps__vercel__list_deployment_files_extra', 'mcp__codex_apps__vercel__delete_deployment', 'mcp__codex_apps__vercel_deploy_to_vercel']) {
      assert.equal(core.normalizeToolName(name), name);
      assert.equal(core.evaluateToolUse(root, { tool_name: name }).ok, false, name);
    }
  } finally {
    core.setPhase(root, 'execute');
  }
});
test('only exact Vercel protected fetch aliases receive WebRead without protection-management access', () => {
  try {
    for (const phase of ['execute', 'verify']) {
      core.setPhase(root, phase);
      for (const separator of ['_', '__']) {
        const name = `mcp__codex_apps__vercel${separator}web_fetch_vercel_url`;
        assert.equal(core.normalizeToolName(name), 'WebRead', name);
        assert.equal(core.evaluateToolUse(root, { tool_name: name, tool_input: { url: 'https://candidate.vercel.app/api/shipping/settings' } }).ok, true, `${phase}: ${name}`);
        for (const operation of ['update_project_protection_bypass', 'create_protection_bypass', 'create_access_to_vercel_url', 'web_fetch_vercel_url_extra']) {
          const rejected = `mcp__codex_apps__vercel${separator}${operation}`;
          assert.equal(core.normalizeToolName(rejected), rejected);
          assert.equal(core.evaluateToolUse(root, { tool_name: rejected }).ok, false, `${phase}: ${rejected}`);
        }
      }
      for (const name of ['mcp__untrusted__web_fetch_vercel_url', 'mcp__codex_apps__vercel___web_fetch_vercel_url']) {
        assert.equal(core.normalizeToolName(name), name);
        assert.equal(core.evaluateToolUse(root, { tool_name: name }).ok, false, `${phase}: ${name}`);
      }
    }
  } finally {
    core.setPhase(root, 'execute');
  }
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
test('literal cat accepts quoted absolute Markdown paths without allowing shell syntax', () => {
  const document = '/Users/test/vercel/deployments-cicd/SKILL.md';
  const localized = '/Users/test/中文 目录/vercel/deployments-cicd/SKILL.md';
  for (const command of [`cat ${document}`, `cat '${document}'`, `cat "${localized}"`, `cat '${localized}' /tmp/README.md "${document}"`]) {
    assert.equal(core.detectCommandRisk(command), '', command);
    assert.equal(core.evaluateToolUse(root, { tool_name: 'exec_command', tool_input: { command } }).ok, true, command);
  }
  for (const command of [
    `cat "${document}"; git push origin main`,
    `cat "${document}" && git push origin main`,
    `cat "${document}" | sh`,
    `cat "${document}" > /tmp/copied.md`,
    `cat "${document}" < /tmp/input.md`,
    `cat "${document}"\ngit push origin main`,
    `cat "${document}" $HOME/extra.md`,
    `cat "${document}" "$(id).md"`,
    `cat "${document.replace('SKILL', '$HOME')}"`,
    `cat "${document.replace('SKILL', '$(id)')}"`,
    `cat "${document.replace('SKILL', '`id`')}"`,
    `cat "${document.replace('SKILL', 'SKILL\\ name')}"`,
    'cat "' + document + '" `/tmp/extra.md`',
    `cat '${document}'\\ /tmp/extra.md`,
    `cat 'relative/vercel/deployments-cicd/SKILL.md'`,
    `cat "${document}" --help`,
    `cat "${document}.txt"`,
    `cat "${document}`
  ]) {
    assert.notEqual(core.detectCommandRisk(command), '', command);
    assert.equal(core.evaluateToolUse(root, { tool_name: 'exec_command', tool_input: { command } }).ok, false, command);
  }
});
for (const format of ['sha1', 'sha256']) test(`Preview metadata binds exact clean ${format} HEAD and consumes only the complete literal`, () => {
  const previewRoot = path.join(sandbox, `preview-${format}`);
  fs.mkdirSync(previewRoot);
  git(previewRoot, 'init', `--object-format=${format}`);
  git(previewRoot, 'config', 'user.name', 'Harness test');
  git(previewRoot, 'config', 'user.email', 'test@example.invalid');
  write(path.join(previewRoot, settingsPath), fs.readFileSync(path.join(actual, settingsPath), 'utf8'));
  write(path.join(previewRoot, '.vercel/project.json'), { projectId: 'prj_test', orgId: 'team_test' });
  write(path.join(previewRoot, 'child/.vercel/project.json'), { projectId: 'prj_test', orgId: 'team_test' });
  core.startGoal(previewRoot, 'Validate shipping Preview', { level: 'A3', workPackageId: 'WP40', scopes: 'app', success: 'checks pass' });
  core.approveContract(previewRoot, { level: 'A3', by: 'fixture' });
  core.recordEvidence(previewRoot, { status: 'pass', summary: 'fixture research', satisfies: core.loadContract(previewRoot).researchPlan.requiredChecks.map(item => `research-check:${item.id}`) });
  core.setPhase(previewRoot, 'execute');
  const command = 'vercel deploy --target preview --scope team_test';
  const digest = value => crypto.createHash('sha256').update(value).digest('hex');
  const authority = 'IN-preview-metadata';
  write(path.join(previewRoot, registry.DEMAND_INBOX_RELATIVE_PATH), JSON.stringify({ id: authority, state: 'user_authorized', action_approval: {
    by: 'user', target: 'team_test/prj_test', environment: 'preview', cwd: previewRoot, commandHash: digest(command)
  } }) + '\n');
  git(previewRoot, 'add', '.'); git(previewRoot, 'commit', '-m', 'Preview authority fixture');
  const head = git(previewRoot, 'rev-parse', 'HEAD');
  assert.equal(head.length, format === 'sha1' ? 40 : 64);
  const tagged = `${command} --meta gitCommitSha=${head}`;
  const binding = core.actionBinding(previewRoot, tagged, previewRoot);
  assert.equal(binding.head, head);
  assert.equal(binding.commandHash, digest(tagged));
  assert.equal(binding.authorityCommandHash, digest(command));
  assert.equal(core.actionBinding(previewRoot, command, previewRoot).authorityCommandHash, undefined);
  const request = { command: tagged, cwd: previewRoot, authority, expiresAt: new Date(Date.now() + 600000).toISOString() };
  const evaluate = (cmd = tagged, workdir = previewRoot) => core.evaluateToolUse(previewRoot, { tool_name: 'Bash', tool_input: { cmd, workdir } });
  assert.equal(evaluate().ok, false);
  assert.throws(() => core.actionBinding(previewRoot, `${command} --meta gitCommitSha=${'0'.repeat(head.length)}`, previewRoot), /match current HEAD/);
  for (const invalid of [
    `${tagged} --meta gitCommitSha=${head}`, `${tagged} --yes`, `${tagged} --force`,
    `${command} --meta other=${head}`, `${command} --meta gitCommitSha=${head.slice(1)}`,
    `vercel deploy --prod --skip-domain --scope team_test --meta gitCommitSha=${head}`,
    `vercel promote dpl_test --scope team_test --meta gitCommitSha=${head}`
  ]) assert.throws(() => core.actionBinding(previewRoot, invalid, previewRoot), /unsupported/, invalid);
  assert.throws(() => core.approveAction(previewRoot, { ...request, command: `${command} --yes --meta gitCommitSha=${head}` }), /authority/);
  assert.throws(() => core.approveAction(previewRoot, { ...request, command: tagged.replace('team_test', 'team_other') }), /scope binding/);
  assert.throws(() => core.approveAction(previewRoot, { ...request, cwd: path.join(previewRoot, 'child') }), /authority/);
  const grant = core.approveAction(previewRoot, request);
  const grantFile = core.actionApprovalPath(previewRoot, binding);
  assert.equal(grant.commandHash, digest(tagged));
  assert.equal(evaluate(command).ok, false, 'base command cannot consume the metadata grant');
  assert.equal(evaluate(`${tagged} --yes`).ok, false);
  assert.equal(evaluate(tagged, path.join(previewRoot, 'child')).ok, false);
  for (const replacement of [{ commandHash: digest(command) }, { authorityCommandHash: 'forged' }, { head: 'old' }, { target: 'other' }]) {
    write(grantFile, { ...grant, ...replacement });
    assert.equal(evaluate().ok, false);
  }
  write(grantFile, grant);
  write(path.join(previewRoot, 'dirty.txt'), 'uncommitted');
  assert.equal(evaluate().ok, false);
  fs.unlinkSync(path.join(previewRoot, 'dirty.txt'));
  assert.equal(fs.existsSync(`${grantFile}.consumed`), false);
  assert.equal(evaluate().ok, true);
  assert.equal(evaluate().ok, false, 'complete literal grant is single-use');
  write(path.join(previewRoot, 'new.txt'), 'new committed version');
  git(previewRoot, 'add', '.'); git(previewRoot, 'commit', '-m', 'Advance Preview candidate');
  assert.throws(() => core.approveAction(previewRoot, request), /match current HEAD/);
  const nextTagged = `${command} --meta gitCommitSha=${git(previewRoot, 'rev-parse', 'HEAD')}`;
  assert.equal(evaluate(nextTagged).ok, false, 'new HEAD needs its own complete literal grant');
  assert.equal(core.approveAction(previewRoot, { ...request, command: nextTagged }).authorityCommandHash, digest(command));
});
test('a governance command mention cannot exempt a composed remote mutation', () => {
  const command = `node ${path.join(root, scripts, 'harness-goal.js')} status; git push origin main`;
  assert.equal(core.evaluateToolUse(root, { tool_name: 'exec_command', tool_input: { command } }).ok, false);
});
test('switch control operations require one command invoking the local CLI', () => {
  core.setPhase(root, 'approval');
  try {
    for (const operation of ['switch-check', 'switch', 'recover-switch']) {
      const command = `node ${path.join(root, scripts, 'harness-goal.js')} ${operation} --candidate /tmp/fixture.json`;
      const result = core.evaluateToolUse(root, { tool_name: 'exec_command', tool_input: { command } });
      assert.equal(result.ok, true, operation);
      assert.equal(result.controlPlaneCommand, true, operation);
      for (const altered of [command + '; git push', command + ' && git push', command + '\ngit push', command.replace(root, target), command.replace(operation, operation + '-extra')]) {
        assert.equal(core.evaluateToolUse(root, { tool_name: 'exec_command', tool_input: { command: altered } }).ok, false, altered);
      }
    }
  } finally {
    core.setPhase(root, 'execute');
  }
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
