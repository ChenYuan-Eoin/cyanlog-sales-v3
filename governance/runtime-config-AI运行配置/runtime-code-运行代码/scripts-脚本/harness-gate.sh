#!/bin/bash
# Harness Gate Controller
# 切换当前线程的Gate状态

set -euo pipefail

WORKSPACE_ROOT="${PRICE_V3_WORKSPACE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
CORE_FILE="$WORKSPACE_ROOT/governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/harness-core.js"
STATE_FILE="$(node - "$WORKSPACE_ROOT" "$CORE_FILE" <<'NODE'
const [repoRoot, corePath] = process.argv.slice(2);
const core = require(corePath);
process.stdout.write(core.paths(repoRoot).statePath);
NODE
)"
SETTINGS_FILE="$WORKSPACE_ROOT/governance/runtime-config-AI运行配置/config-配置文件/settings-claude运行配置.json"

ACTION="${1:-status}"
GATE_ID="${2:-}"

function get_status() {
  node - "$STATE_FILE" "$SETTINGS_FILE" <<'NODE'
const fs = require('fs');
const [statePath, settingsPath] = process.argv.slice(2);
if (!fs.existsSync(statePath)) {
  console.log('Status: unknown (state file not found)');
  process.exit(0);
}
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const settings = fs.existsSync(settingsPath)
  ? JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  : {};
console.log(`Mode: ${state.mode || '-'}`);
console.log(`Phase: ${state.phase || '-'}`);
console.log(`Active Gates: ${(state.activeGates || []).join(' ') || '-'}`);
console.log(`Work Package: ${state.currentGoal?.workPackageId || '-'}`);
console.log(`Runtime State: ${statePath}`);
console.log(`Available Gates: ${Object.keys(settings.gates || {}).join(' ') || '-'}`);
NODE
}

function switch_gate() {
  local gate="$1"

  if [ -z "$gate" ]; then
    echo "❌ 请指定Gate ID: HG2, HG4, or none"
    exit 1
  fi

  node - "$WORKSPACE_ROOT" "$STATE_FILE" "$SETTINGS_FILE" "$gate" <<'NODE'
const fs = require('fs');
const path = require('path');
const [repoRoot, statePath, settingsPath, gate] = process.argv.slice(2);
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
const core = require(path.join(repoRoot, 'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/harness-core.js'));

if (gate === 'none') {
  try {
    core.setPhase(repoRoot, 'idle', 'gate controller');
  } catch (error) {
    console.error(`❌ Cannot switch gate: ${error.message}`);
    process.exit(1);
  }
} else if (settings.gates && settings.gates[gate]) {
  const phase = settings.gates[gate].phase;
  if (!phase) {
    console.error(`❌ Gate has no phase: ${gate}`);
    process.exit(1);
  }
  try {
    core.setPhase(repoRoot, phase, 'gate controller');
  } catch (error) {
    console.error(`❌ Cannot switch gate: ${error.message}`);
    process.exit(1);
  }
} else {
  console.error(`❌ Unknown gate: ${gate}`);
  process.exit(1);
}

console.log(`✅ Gate switched to: ${gate}`);
NODE
}

case "$ACTION" in
  status)
    get_status
    ;;
  switch|set)
    switch_gate "$GATE_ID"
    ;;
  strict)
    switch_gate "HG2"
    ;;
  permissive|open)
    switch_gate "none"
    ;;
  *)
    echo "Usage: $0 {status|switch|strict|permissive} [gate-id]"
    echo ""
    echo "Examples:"
    echo "  $0 status                    # 查看当前状态"
    echo "  $0 switch HG2                 # 切换到审查门（只读）"
    echo "  $0 switch HG4                 # 切换到复核门（深度只读）"
    echo "  $0 strict                    # 快捷方式：进入严格模式"
    echo "  $0 permissive                # 快捷方式：解除限制"
    exit 1
    ;;
esac
