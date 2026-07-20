#!/usr/bin/env node
/**
 * Gate Enforcement Hook
 * 拦截式门控执行器 - 基于统一 harness-core policy 进行工具级拦截
 *
 * 退出码:
 *   0 - 允许操作
 *   1 - 系统错误
 *   2 - 被Gate拦截
 *   3 - 需求未确认
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const core = require('../scripts-脚本/harness-core');

const WORKSPACE_ROOT = process.env.PRICE_V3_WORKSPACE_ROOT ||
  path.resolve(__dirname, '../../../..');
const PROJECT_REGISTRY_PATH = path.join(
  WORKSPACE_ROOT,
  'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/project-registry.js'
);

function enforceSchedulerPath(payload) {
  const toolName = core.normalizeToolName(payload.tool_name);
  if (!['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(toolName)) {
    return;
  }
  const toolInput = payload.tool_input || {};
  const filePath = toolInput.file_path || toolInput.notebook_path;
  if (!filePath) {
    console.error('SCHEDULER_BLOCKED: write tool did not provide a file path');
    process.exit(2);
  }
  const result = spawnSync(process.execPath, [PROJECT_REGISTRY_PATH, 'scheduler-check', filePath], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    console.error(result.stdout || result.stderr || 'SCHEDULER_BLOCKED');
    process.exit(2);
  }
}

function printDeny(result) {
  console.error(`\n🚫 GATE INTERCEPTED: ${result.reason}`);
  const details = {
    gate: result.gate,
    phase: result.phase,
    tool: result.tool,
    risk: result.risk,
    command: result.command,
    allowed: result.allowedTools?.join(', ')
  };
  for (const [key, value] of Object.entries(details)) {
    if (value) {
      console.error(`   ${key}: ${value}`);
    }
  }
  console.error('\n   💡 要执行此操作，需要先切换Gate或获得授权\n');
}

function checkReqConfirmed(payload) {
  const toolName = core.normalizeToolName(payload.tool_name);
  if (!['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(toolName)) {
    return;
  }
  const toolInput = payload.tool_input || {};
  const filePath = toolInput.file_path;
  if (!filePath) {
    return;
  }
  const productSrcPath = path.join(WORKSPACE_ROOT, 'product-truth/product-code');
  if (!filePath.startsWith(productSrcPath) && !filePath.includes('product-code')) {
    return;
  }

  const reqCheckPath = path.join(__dirname, 'check-req-confirmed.js');
  const result = spawnSync(process.execPath, [reqCheckPath, filePath], {
    stdio: 'pipe',
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(3);
  }
}

function main() {
  let payload = {};
  try {
    const input = fs.readFileSync(0, 'utf8');
    payload = input ? JSON.parse(input) : {};
  } catch (error) {
    console.error(`❌ Gate Enforcer: invalid hook payload: ${error.message}`);
    process.exit(1);
  }

  enforceSchedulerPath(payload);

  const result = core.evaluateToolUse(WORKSPACE_ROOT, payload);
  if (!result.ok) {
    printDeny(result);
    process.exit(result.exitCode || 2);
  }

  checkReqConfirmed(payload);
  process.exit(0);
}

main();
