#!/usr/bin/env node
/**
 * 行为审计日志记录器
 * 记录每次 commit 的 AI 行为检查结果
 *
 * 用法: node log-commit.mjs [commit-hash]
 */

import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const RUNTIME_DIR = process.env.PRICE_V3_RUNTIME_DIR || execFileSync(
  'git',
  ['rev-parse', '--path-format=absolute', '--git-path', 'codex-runtime'],
  { cwd: PROJECT_ROOT, encoding: 'utf8' }
).trim();
const LOG_FILE = process.env.PRICE_V3_BEHAVIOR_LOG_PATH || path.join(RUNTIME_DIR, 'behavior-log.jsonl');
const AUDIT_DIR = path.dirname(LOG_FILE);
const CHECK_LOG_ROOT = path.resolve(RUNTIME_DIR, 'check-logs');
const HARNESS_SCRIPTS_RELATIVE_DIR = 'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本';
const REQUIRED_ARTIFACT_NAMES = new Set([
  'harness-selftest',
  'check-01-typecheck',
  'check-02-lint',
  'check-03-test',
  'check-04-nav',
  'check-05-git',
  'check-06-feedback-loop',
  'check-07-healthcheck',
  'check-08-error-handling',
  'check-09-business-loop',
  'check-10-ci-cd-loop',
]);

function git(args) {
  return execFileSync('git', args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function checkArtifactsAreValid(entry) {
  if (!Array.isArray(entry?.checkArtifacts) || entry.checkArtifacts.length !== 11) {
    return false;
  }

  const expectedDirectory = path.resolve(CHECK_LOG_ROOT, entry.indexTree);
  const names = new Set();
  const artifactPaths = new Set();

  for (const artifact of entry.checkArtifacts) {
    if (
      typeof artifact?.name !== 'string'
      || !Array.isArray(artifact?.command)
      || artifact.command.length === 0
      || artifact.command.some((part) => typeof part !== 'string')
      || typeof artifact?.artifact_path !== 'string'
      || path.isAbsolute(artifact.artifact_path)
      || !/^[0-9a-f]{64}$/i.test(artifact?.sha256 || '')
      || artifact?.exit_code !== 0
      || artifact?.timeout !== false
    ) {
      return false;
    }

    if (!REQUIRED_ARTIFACT_NAMES.has(artifact.name)) {
      return false;
    }

    const expectedCommand = artifact.name === 'harness-selftest'
      ? ['npm', '--prefix', HARNESS_SCRIPTS_RELATIVE_DIR, 'test']
      : ['bash', path.join(PROJECT_ROOT, 'governance/ai-behavior-准则/checks', `${artifact.name}.sh`)];
    if (
      artifact.command.length !== expectedCommand.length
      || artifact.command.some((part, index) => part !== expectedCommand[index])
    ) {
      return false;
    }

    const artifactPath = path.resolve(RUNTIME_DIR, artifact.artifact_path);
    const expectedFilename = artifact.name === 'harness-selftest'
      ? '00-harness-selftest.log'
      : `${artifact.name}.log`;
    if (
      path.dirname(artifactPath) !== expectedDirectory
      || path.basename(artifactPath) !== expectedFilename
      || !artifactPath.startsWith(`${CHECK_LOG_ROOT}${path.sep}`)
      || !existsSync(artifactPath)
      || names.has(artifact.name)
      || artifactPaths.has(artifactPath)
    ) {
      return false;
    }

    let actualSha256;
    try {
      const stat = lstatSync(artifactPath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        return false;
      }
      actualSha256 = createHash('sha256').update(readFileSync(artifactPath)).digest('hex');
    } catch {
      return false;
    }
    if (actualSha256 !== artifact.sha256) {
      return false;
    }

    names.add(artifact.name);
    artifactPaths.add(artifactPath);
  }

  return [...REQUIRED_ARTIFACT_NAMES].every((name) => names.has(name));
}

function preCommitBaseMatchesCommitParent(baseCommit, firstParent) {
  if (baseCommit === firstParent) return true;
  if (!/^[0-9a-f]{40,64}$/i.test(baseCommit || '')) return false;
  try {
    // During `git commit --amend`, pre-commit correctly sees the commit being
    // replaced as HEAD, while the resulting commit keeps that commit's first
    // parent. Accept only that precise sibling relationship.
    const baseParents = git(['show', '--no-patch', '--format=%P', baseCommit])
      .split(' ')
      .filter(Boolean);
    return (baseParents[0] || 'unborn') === firstParent;
  } catch {
    return false;
  }
}

// 确保审计目录存在
if (!existsSync(AUDIT_DIR)) {
  mkdirSync(AUDIT_DIR, { recursive: true });
}

// 先把用户输入解析成不可歧义的完整 commit SHA。后续 Git 调用只接收这个 SHA，
// 所有参数都通过 execFileSync 数组传递，不经过 shell 拼接。
const requestedRevision = process.argv[2] || 'HEAD';
const commitHash = git([
  'rev-parse',
  '--verify',
  '--end-of-options',
  `${requestedRevision}^{commit}`,
]);

if (!/^[0-9a-f]{40,64}$/i.test(commitHash)) {
  throw new Error(`无法把 revision 解析为完整 commit SHA: ${requestedRevision}`);
}

const timestamp = new Date().toISOString();
const commitTree = git(['show', '--no-patch', '--format=%T', commitHash]);
const parentCommits = git(['show', '--no-patch', '--format=%P', commitHash])
  .split(' ')
  .filter(Boolean);
const firstParent = parentCommits[0] || 'unborn';
const author = git(['show', '--no-patch', '--format=%an', commitHash]);
const message = git(['show', '--no-patch', '--format=%s', commitHash]);
const filesChanged = git([
  'diff-tree',
  '--no-commit-id',
  '--name-only',
  '-r',
  '--root',
  commitHash,
  '--',
])
  .trim()
  .split('\n')
  .filter(Boolean);

// post-commit 本身不能证明 pre-commit 已运行。只有找到同一最终 commit tree 的
// 10/10 通过记录，才把行为检查标记为已验证；--no-verify、SOFT 失败或旧记录都不会冒充通过。
let matchingPreCommitEvidence = null;
if (existsSync(LOG_FILE)) {
  const entries = readFileSync(LOG_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });

  matchingPreCommitEvidence = entries.reverse().find((entry) => (
    entry?.trigger === 'pre-commit'
    && entry?.indexTree === commitTree
    && preCommitBaseMatchesCommitParent(entry?.baseCommit, firstParent)
    && entry?.trackedWorkingTreeMatchesIndex === true
    && entry?.indexTreeStable === true
    && entry?.extraInputsStable === true
    && entry?.environmentFingerprint?.untrackedFileCount === 0
    && entry?.environmentFingerprint?.ignoredCheckInputCount === 0
    && /^[0-9a-f]{64}$/.test(entry?.environmentFingerprint?.extraInputSnapshotSha256 || '')
    && typeof entry?.environmentFingerprint?.node === 'string'
    && typeof entry?.environmentFingerprint?.pnpm === 'string'
    && typeof entry?.environmentFingerprint?.git === 'string'
    && entry?.controlPreflight?.name === 'harness-selftest'
    && entry?.controlPreflight?.required === true
    && entry?.controlPreflight?.executed === 1
    && entry?.controlPreflight?.passed === 1
    && entry?.controlPreflight?.failed === 0
    && entry?.requiredChecks === 10
    && entry?.executedChecks === 10
    && entry?.passed === 10
    && entry?.failed === 0
    && entry?.overallPassed === true
    && checkArtifactsAreValid(entry)
  )) || null;
}

// 构建审计日志条目
const auditEntry = {
  timestamp,
  commit: commitHash,
  commitTree,
  parentCommits,
  author,
  message: message.substring(0, 100), // 截断过长消息
  filesChanged: filesChanged.slice(0, 20), // 最多记录 20 个文件
  filesCount: filesChanged.length,
  trigger: 'post-commit',
  aiBehavior: {
    checked: Boolean(matchingPreCommitEvidence),
    evidenceBinding: matchingPreCommitEvidence
      ? {
          trigger: 'pre-commit',
          timestamp: matchingPreCommitEvidence.timestamp,
          baseCommit: matchingPreCommitEvidence.baseCommit,
          indexTree: matchingPreCommitEvidence.indexTree,
          trackedWorkingTreeMatchesIndex: matchingPreCommitEvidence.trackedWorkingTreeMatchesIndex,
          indexTreeStable: matchingPreCommitEvidence.indexTreeStable,
          extraInputsStable: matchingPreCommitEvidence.extraInputsStable,
          environmentFingerprint: matchingPreCommitEvidence.environmentFingerprint,
          controlPreflight: matchingPreCommitEvidence.controlPreflight.name,
          requiredChecks: matchingPreCommitEvidence.requiredChecks,
          executedChecks: matchingPreCommitEvidence.executedChecks,
          passed: matchingPreCommitEvidence.passed,
          failed: matchingPreCommitEvidence.failed,
          checkArtifacts: matchingPreCommitEvidence.checkArtifacts,
        }
      : null,
    version: '2026-07-22',
  },
};

// 追加到日志文件
appendFileSync(LOG_FILE, JSON.stringify(auditEntry) + '\n');

console.log(`📝 审计日志已记录: ${commitHash.substring(0, 7)}`);
