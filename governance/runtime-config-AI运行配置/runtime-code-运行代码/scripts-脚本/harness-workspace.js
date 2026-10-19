#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const SCHEDULER = 'governance/runtime-state/active-task.json';
const INBOX = 'governance/runtime-state/demand-inbox.jsonl';

function git(root, args) {
  const env = { ...process.env };
  // Hooks inherit Git pointers belonging to the caller, not necessarily root.
  for (const name of Object.keys(env)) if (name.startsWith('GIT_')) delete env[name];
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env });
  if (result.status !== 0) throw new Error((result.stderr || 'Cannot resolve Git workspace').trim());
  return result.stdout.trim();
}

function identity(root) {
  root = fs.realpathSync(root);
  const top = fs.realpathSync(git(root, ['rev-parse', '--show-toplevel']));
  if (root !== top) throw new Error('Workspace must be a Git checkout root');
  return {
    root,
    common: fs.realpathSync(git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])),
    runtime: path.resolve(git(root, ['rev-parse', '--path-format=absolute', '--git-path', 'codex-runtime']))
  };
}

function bindingPath(root) { return path.join(identity(root).runtime, 'harness', 'workspace-binding.json'); }
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function validateWorkspaceAuthority(caller, workspace, authorityId, workPackageId) {
  const source = identity(caller), target = identity(workspace);
  if (source.common !== target.common) throw new Error('Workspace binding crosses repositories');
  const registered = git(caller, ['worktree', 'list', '--porcelain']).split('\n').filter(line => line.startsWith('worktree ')).map(line => fs.realpathSync(line.slice(9)));
  if (!registered.includes(target.root)) throw new Error('Workspace is not a registered checkout');
  const authority = fs.readFileSync(path.join(target.root, INBOX), 'utf8').split('\n').filter(Boolean).map(JSON.parse).find(item => item.id === authorityId);
  if (!/^WP\d{2}$/.test(workPackageId || '') || !authority || authority.source !== 'user_explicit' || !['approved', 'approved_execution'].includes(authority.state) || !authority.execution_workspace || fs.realpathSync(authority.execution_workspace) !== target.root || authority.target !== workPackageId) throw new Error('Workspace binding lacks explicit recorded authority');
  return target.root;
}

function validateBinding(caller, binding) {
  if (binding.version !== 1 || !binding.workspace || !binding.authority || !/^WP\d{2}$/.test(binding.workPackageId)) throw new Error('Invalid workspace binding');
  const source = identity(caller), target = identity(binding.workspace);
  if (binding.common !== source.common) throw new Error('Workspace binding crosses repositories');
  validateWorkspaceAuthority(caller, target.root, binding.authority, binding.workPackageId);
  const state = read(path.join(target.root, SCHEDULER));
  if (state.execution_queue?.active?.id !== binding.workPackageId || state.active_task?.id !== binding.workPackageId || state.active_task?.status !== 'active') throw new Error('Workspace binding has a stale Active work package');
  if (fs.realpathSync(state.active_task.execution_workspace) !== target.root) throw new Error('Active execution workspace does not match binding');
  return target.root;
}

function resolveExecutionWorkspace(caller) {
  const lock = path.join(identity(caller).common, 'codex-runtime', 'harness', 'workspace-switch.lock');
  if (fs.existsSync(lock)) throw new Error('Workspace switch is pending; use its bounded recover-switch command');
  const file = bindingPath(caller);
  return fs.existsSync(file) ? validateBinding(caller, read(file)) : identity(caller).root;
}

function bindWorkspace(caller, workspace, authority) {
  if (fs.existsSync(path.join(identity(caller).common, 'codex-runtime', 'harness', 'workspace-switch.lock'))) throw new Error('Workspace switch is pending; use recover-switch before binding');
  const target = identity(workspace);
  const state = read(path.join(target.root, SCHEDULER));
  const binding = { version: 1, workspace: target.root, common: target.common, workPackageId: state.active_task?.id, authority, createdAt: new Date().toISOString() };
  validateBinding(caller, binding);
  // Validate through the target's policy before making it authoritative.
  const registry = require(path.join(target.root, 'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/project-registry.js'));
  const check = registry.validateSchedulerState({ repoRoot: target.root });
  if (!check.ok) throw new Error(`Target preflight failed: ${check.errors.join('; ')}`);
  const file = bindingPath(caller);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.${Date.now()}.previous`);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(binding, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
  return { ...binding, file };
}

// Recovery is deliberately limited to one governance CLI invocation, never shell composition.
function isBindingRecovery(caller, payload = {}) {
  if (!['Bash', 'exec_command', 'functions.exec_command', 'functions__exec_command'].includes(payload.tool_name || payload.toolName)) return false;
  const input = payload.tool_input || payload.input || payload.arguments || {};
  const command = input.cmd || input.command || '';
  if (!command || /[;|&<>`$\n\r\\]/.test(command)) return false;
  const tokens = command.match(/"[^"]*"|'[^']*'|[^\s'"]+/g) || [];
  const args = tokens.map(token => token.replace(/^(['"])(.*)\1$/, '$2'));
  if (!['node', process.execPath].includes(args[0]) || !['bind', 'recover-switch'].includes(args[2]) || args.length !== 9) return false;
  if (args[3] !== '--caller' || args[5] !== '--workspace' || args[7] !== '--authority') return false;
  try {
    const source = identity(caller), destination = identity(args[6]);
    if (identity(args[4]).root !== source.root || source.common !== destination.common) return false;
    if (fs.realpathSync(args[1]) !== fs.realpathSync(path.join(destination.root, 'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/harness-goal.js'))) return false;
    if (args[2] === 'recover-switch') {
      const lock = read(path.join(source.common, 'codex-runtime', 'harness', 'workspace-switch.lock'));
      if (lock.caller !== source.root || lock.workspace !== destination.root || lock.authority !== args[8]) return false;
      const authority = fs.readFileSync(path.join(destination.root, INBOX), 'utf8').split('\n').filter(Boolean).map(JSON.parse).find(item => item.id === args[8]);
      validateWorkspaceAuthority(caller, destination.root, args[8], authority?.target);
      return true;
    }
    if (fs.existsSync(path.join(source.common, 'codex-runtime', 'harness', 'workspace-switch.lock'))) return false;
    const state = read(path.join(destination.root, SCHEDULER));
    validateBinding(caller, { version: 1, workspace: destination.root, common: source.common, workPackageId: state.active_task.id, authority: args[8] });
    return true;
  } catch { return false; }
}

function within(root, target) { return target.startsWith(root + path.sep); }
function resolvedAncestor(file) {
  let current = file;
  const suffix = [];
  while (!fs.existsSync(current)) {
    // A dangling symlink must not be treated as an ordinary new file.
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Dangling runtime symlink'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (parent === current) throw new Error('Cannot resolve runtime ancestor');
    suffix.unshift(path.basename(current)); current = parent;
  }
  return path.join(fs.realpathSync(current), ...suffix);
}

function runtimePathPolicy(root, file) {
  const runtime = identity(root).runtime;
  const absolute = path.resolve(root, file);
  if (!within(runtime, absolute)) return null;
  try {
    const resolved = resolvedAncestor(absolute), realRuntime = resolvedAncestor(runtime);
    if (!within(realRuntime, resolved)) return { allowed: false, reason: 'runtime symlink escapes this worktree' };
    const relative = path.relative(realRuntime, resolved);
    const protectedNames = ['harness', 'delivery-evidence.json', 'behavior-log.jsonl'];
    if (protectedNames.some(name => relative === name || relative.startsWith(name + path.sep))) return { allowed: false, reason: 'runtime control state must use its governance command' };
    return { allowed: true, kind: 'worktree_runtime_artifact' };
  } catch (error) { return { allowed: false, reason: error.message }; }
}

module.exports = { identity, bindingPath, validateWorkspaceAuthority, validateBinding, resolveExecutionWorkspace, bindWorkspace, runtimePathPolicy, isBindingRecovery };
