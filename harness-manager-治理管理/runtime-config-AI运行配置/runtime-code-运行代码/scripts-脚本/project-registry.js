const fs = require('fs');
const path = require('path');

const REGISTRY_RELATIVE_PATH = 'harness-manager-治理管理/runtime-config-AI运行配置/config-配置文件/project-governance-项目治理注册表.json';

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
  resolveEnabledDocumentPath,
  resolveDocumentPath,
  resolveRuntimePath,
  toRepoRelative
};
