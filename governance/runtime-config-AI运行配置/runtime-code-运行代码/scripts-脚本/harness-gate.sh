#!/bin/bash
# Harness Gate Controller
# 切换当前线程的Gate状态

set -euo pipefail

WORKSPACE_ROOT="${PRICE_V3_WORKSPACE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
STATE_FILE="$WORKSPACE_ROOT/governance/runtime-state/harness-state.json"
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
console.log(`Available Gates: ${Object.keys(settings.gates || {}).join(' ') || '-'}`);
NODE
}

function switch_gate() {
  local gate="$1"

  if [ -z "$gate" ]; then
    echo "❌ 请指定 Harness Gate ID: HG0-HG5, or none"
    exit 1
  fi

  node - "$STATE_FILE" "$SETTINGS_FILE" "$gate" <<'NODE'
const fs = require('fs');
const [statePath, settingsPath, gate] = process.argv.slice(2);
const state = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
  : { version: '1.0' };
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

if (gate === 'none') {
  state.activeGates = [];
  state.mode = 'permissive';
  state.status = 'permissive';
  state.phase = 'idle';
} else if (settings.gates && settings.gates[gate]) {
  state.activeGates = [gate];
  state.mode = 'enforcing';
  state.status = 'strict';
  state.phase = settings.gates[gate].phase;
} else {
  console.error(`❌ Unknown Harness gate: ${gate}`);
  process.exit(1);
}

state.lastActivity = new Date().toISOString();
fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
console.log(`✅ Harness gate switched to: ${gate}`);
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
    echo "  $0 switch HG2                # 切换到契约审查门（只读）"
    echo "  $0 switch HG4                # 切换到验证证据门（只读）"
    echo "  $0 strict                    # 快捷方式：进入严格模式"
    echo "  $0 permissive                # 快捷方式：解除限制"
    exit 1
    ;;
esac
