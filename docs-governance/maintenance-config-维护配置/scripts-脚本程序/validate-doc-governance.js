#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REGISTRY_RELATIVE_PATH = 'governance/runtime-config-AI运行配置/config-配置文件/project-governance-项目治理注册表.json';
const RULES_RELATIVE_PATH = 'docs-governance/maintenance-config-维护配置/config-配置文件/document-maintenance-rules-文档维护规则.json';

function findRepoRoot(startDir = __dirname) {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, REGISTRY_RELATIVE_PATH))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error('project governance registry not found');
    }
    current = parent;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toRepoRelative(repoRoot, filePath) {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
  return path.relative(repoRoot, absolute).replace(/\\/g, '/');
}

function pathWithin(rel, root) {
  const normalizedRoot = String(root || '').replace(/\/+$/, '');
  return rel === normalizedRoot || rel.startsWith(`${normalizedRoot}/`);
}

function isMarkdown(rel) {
  return /\.md$/i.test(rel);
}

function registeredDocumentAllows(registry, rel) {
  return (registry.documents || []).some((entry) => {
    if (entry.enabled === false || !entry.path) {
      return false;
    }
    const entryPath = String(entry.path).replace(/\/+$/, '');
    if (entry.kind === 'directory') {
      return pathWithin(rel, entryPath);
    }
    return rel === entryPath;
  });
}

function familyAllows(rules, rel) {
  const families = rules?.rules?.documentInventory?.newDocumentPolicy?.allowedFamilies || [];
  return families.some((family) => {
    if (!pathWithin(rel, family.root)) {
      return false;
    }
    const root = String(family.root).replace(/\/+$/, '');
    const filePart = rel.slice(root.length + 1);
    return new RegExp(family.filenamePattern).test(filePart);
  });
}

function governedDocumentAllows(registry, rules, rel) {
  return registeredDocumentAllows(registry, rel) || familyAllows(rules, rel);
}

function changedMarkdownFiles(repoRoot) {
  const result = spawnSync('git', ['status', '--porcelain=v1', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git status failed');
  }
  const entries = result.stdout.split('\0').filter(Boolean);
  const files = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const status = entry.slice(0, 2);
    let filePath = entry.slice(3);
    if (status.startsWith('R') || status.startsWith('C')) {
      index += 1;
      filePath = entries[index] || filePath;
    }
    const rel = filePath.replace(/\\/g, '/');
    if (isMarkdown(rel)) {
      files.push({ rel, status, isNew: status.includes('A') || status === '??' });
    }
  }
  return files;
}

function validateTitle(repoRoot, rel) {
  const absolute = path.join(repoRoot, rel);
  if (!fs.existsSync(absolute)) {
    return `document file is missing: ${rel}`;
  }
  const firstHeading = fs.readFileSync(absolute, 'utf8')
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith('#'));
  if (!firstHeading || !/^#\s+\S+/.test(firstHeading.trim())) {
    return `document must contain a top-level '# title': ${rel}`;
  }
  return '';
}

function main() {
  const repoRoot = findRepoRoot();
  const registry = readJson(path.join(repoRoot, REGISTRY_RELATIVE_PATH));
  const rules = readJson(path.join(repoRoot, RULES_RELATIVE_PATH));
  const changed = changedMarkdownFiles(repoRoot)
    .filter((item) => !pathWithin(item.rel, 'product-truth/product-code'));
  const errors = [];

  for (const item of changed) {
    if (!governedDocumentAllows(registry, rules, item.rel)) {
      errors.push(`unregistered or disallowed document path: ${item.rel}`);
      continue;
    }
    const titleError = validateTitle(repoRoot, item.rel);
    if (titleError) {
      errors.push(titleError);
    }
  }

  if (errors.length) {
    console.error('Document governance validation failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`Document governance validation passed: ${changed.length} changed markdown file(s) checked`);
}

main();
