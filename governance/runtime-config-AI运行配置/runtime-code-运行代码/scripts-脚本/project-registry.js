#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REGISTRY_RELATIVE_PATH = 'governance/runtime-config-AI运行配置/config-配置文件/project-governance-项目治理注册表.json';

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
  const statePath = path.join(repoRoot, 'governance/runtime-state/harness-state.json');
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
    process.exit(1);
  }
  if (!fs.existsSync(resolved.path)) {
    console.error(`Hook command path does not exist: ${resolved.path}`);
    process.exit(1);
  }

  const result = spawnSync(resolved.command, [...resolved.args, ...extraArgs], {
    cwd: resolved.repoRoot,
    stdio: 'inherit',
    env: process.env
  });

  if (typeof result.status === 'number') {
    process.exit(result.status);
  }
  process.exit(1);
}

function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === 'status') {
    printStatus();
    return;
  }

  if (command === 'run-hook') {
    const [hookId, ...hookArgs] = args;
    if (!hookId) {
      console.error('Usage: project-registry.js run-hook <hook-id> [args...]');
      process.exit(1);
    }
    runHook(hookId, hookArgs);
    return;
  }

  const { config } = getHarnessRuntime();
  if (config.hook_commands && config.hook_commands[command]) {
    runHook(command, args);
    return;
  }

  console.error(`Unknown project-registry command: ${command}`);
  console.error('Usage: project-registry.js status | run-hook <hook-id> | <hook-id>');
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  REGISTRY_RELATIVE_PATH,
  findRepoRoot,
  getDocumentEntry,
  getHarnessRuntime,
  isEnabled,
  isWithinDocument,
  loadRegistry,
  normalizeRelative,
  pathExists,
  resolveHookCommand,
  resolveEnabledDocumentPath,
  resolveDocumentPath,
  resolveRuntimePath,
  toRepoRelative
};
