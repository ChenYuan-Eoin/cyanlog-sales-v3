#!/usr/bin/env node
/**
 * Gate Enforcement Hook
 * 拦截式门控执行器 - 基于settings中的gates配置进行工具级拦截
 *
 * 退出码:
 *   0 - 允许操作
 *   1 - 系统错误
 *   2 - 被Gate拦截 (不允许的工具)
 *   3 - 需求未确认 (Write/Edit无REQ或状态不对)
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = process.env.PRICE_V3_WORKSPACE_ROOT ||
  path.resolve(__dirname, '../../../..');

const SETTINGS_PATH = path.join(
  WORKSPACE_ROOT,
  'governance/runtime-config-AI运行配置/config-配置文件/settings-claude运行配置.json'
);

// 读取当前激活的Gate
function getActiveGate() {
  try {
    const statePath = path.join(WORKSPACE_ROOT, 'governance/runtime-state/harness-state.json');
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      // 检查模式：permissive模式不拦截任何操作
      if (state.mode === 'permissive' || !state.mode) {
        return null;
      }
      return state.activeGates?.[0] || null;
    }
  } catch (e) {
    console.error('⚠️ 无法读取harness状态:', e.message);
  }
  return null;
}

// 加载settings中的gates配置
function loadGateConfig(gateId) {
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    return settings.gates?.[gateId] || null;
  } catch (e) {
    console.error('⚠️ 无法加载settings:', e.message);
    return null;
  }
}

// 主拦截逻辑
function main() {
  const input = fs.readFileSync(0, 'utf8');
  const payload = input ? JSON.parse(input) : {};

  const toolName = payload.tool_name;
  const toolInput = payload.tool_input || {};

  if (!toolName) {
    console.error('❌ Gate Enforcer: 无法获取工具名称');
    process.exit(1);
  }

  // 获取当前激活的Gate
  const activeGateId = getActiveGate();

  // 如果没有激活的gate，默认允许（宽松模式）
  // 如果要严格模式，这里应该默认拒绝
  if (!activeGateId) {
    process.exit(0);
  }

  const gateConfig = loadGateConfig(activeGateId);

  if (!gateConfig) {
    console.error(`❌ Gate ${activeGateId} 配置不存在`);
    process.exit(1);
  }

  // 检查工具是否在允许列表中
  const allowedTools = gateConfig.tools || [];

  if (!allowedTools.includes(toolName)) {
    console.error(`\n🚫 GATE INTERCEPTED: ${activeGateId}`);
    console.error(`   工具: ${toolName}`);
    console.error(`   原因: 当前Gate不允许使用该工具`);
    console.error(`   允许的工具: ${allowedTools.join(', ')}`);
    console.error(`\n   💡 要执行此操作，需要先切换Gate或获得授权\n`);
    process.exit(2);
  }

  // 如果是Edit/Write，还需要检查REQ ID
  if (['Edit', 'Write', 'NotebookEdit'].includes(toolName)) {
    const filePath = toolInput.file_path;
    if (filePath) {
      // 委托给REQ检查
      const reqCheckPath = path.join(__dirname, 'check-req-confirmed.js');
      const { spawnSync } = require('child_process');

      // 只检查product-src目录下的文件
      const productSrcPath = path.join(WORKSPACE_ROOT, 'product-truth/product-code');
      if (filePath.startsWith(productSrcPath) || filePath.includes('product-code')) {
        const result = spawnSync(process.execPath, [reqCheckPath, filePath], {
          stdio: 'pipe',
          encoding: 'utf8'
        });

        if (result.status !== 0) {
          console.error(result.stderr || result.stdout);
          process.exit(3);
        }
      }
    }
  }

  // 通过Gate检查
  process.exit(0);
}

main();
