#!/usr/bin/env node
/**
 * 行为审计日志记录器
 * 记录每次 commit 的 AI 行为检查结果
 *
 * 用法: node log-commit.mjs [commit-hash]
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const AUDIT_DIR = path.join(PROJECT_ROOT, 'governance/ai-behavior-准则/audit');
const LOG_FILE = path.join(AUDIT_DIR, 'behavior-log.jsonl');

// 确保审计目录存在
if (!existsSync(AUDIT_DIR)) {
  mkdirSync(AUDIT_DIR, { recursive: true });
}

// 获取提交信息
const commitHash = process.argv[2] || execSync('git rev-parse HEAD', { cwd: PROJECT_ROOT }).toString().trim();
const timestamp = new Date().toISOString();
const author = execSync(`git log -1 --format='%an' ${commitHash}`, { cwd: PROJECT_ROOT }).toString().trim();
const message = execSync(`git log -1 --format='%s' ${commitHash}`, { cwd: PROJECT_ROOT }).toString().trim();
const filesChanged = execSync(`git diff-tree --no-commit-id --name-only -r ${commitHash}`, { cwd: PROJECT_ROOT })
  .toString()
  .trim()
  .split('\n')
  .filter(Boolean);

// 构建审计日志条目
const auditEntry = {
  timestamp,
  commit: commitHash,
  author,
  message: message.substring(0, 100), // 截断过长消息
  filesChanged: filesChanged.slice(0, 20), // 最多记录 20 个文件
  filesCount: filesChanged.length,
  trigger: 'post-commit',
  aiBehavior: {
    checked: true,
    version: '2026-06-02'
  }
};

// 追加到日志文件
appendFileSync(LOG_FILE, JSON.stringify(auditEntry) + '\n');

console.log(`📝 审计日志已记录: ${commitHash.substring(0, 7)}`);
