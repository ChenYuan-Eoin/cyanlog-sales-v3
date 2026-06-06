#!/bin/bash
# Harness Gate Controller
# 切换当前线程的Gate状态

set -euo pipefail

WORKSPACE_ROOT="/Users/nsss/Price-v3"
STATE_FILE="$WORKSPACE_ROOT/governance/runtime-state/harness-state.json"

ACTION="${1:-status}"
GATE_ID="${2:-}"

function get_status() {
  if [ -f "$STATE_FILE" ]; then
    local mode=$(cat "$STATE_FILE" | grep -o '"mode": "[^"]*"' | cut -d'"' -f4)
    local activeGates=$(cat "$STATE_FILE" | grep -o '"activeGates": \[[^\]]*\]' | grep -o '"[^"]*"' | grep -v 'activeGates' | tr '\n' ' ')
    echo "Mode: $mode"
    echo "Active Gates: $activeGates"
  else
    echo "Status: unknown (state file not found)"
  fi
}

function switch_gate() {
  local gate="$1"

  if [ -z "$gate" ]; then
    echo "❌ 请指定Gate ID: G2, G4, or none"
    exit 1
  fi

  # 使用Node.js修改JSON（更可靠）
  node -e "
const fs = require('fs');
const state = JSON.parse(fs.readFileSync('$STATE_FILE', 'utf8'));

if ('$gate' === 'none') {
  state.activeGates = [];
  state.mode = 'permissive';
} else if (state.gates && state.gates['$gate']) {
  state.activeGates = ['$gate'];
  state.mode = 'enforcing';
} else {
  console.error('❌ Unknown gate: $gate');
  process.exit(1);
}

state.lastActivity = new Date().toISOString();
fs.writeFileSync('$STATE_FILE', JSON.stringify(state, null, 2));
console.log('✅ Gate switched to: $gate');
"
}

case "$ACTION" in
  status)
    get_status
    ;;
  switch|set)
    switch_gate "$GATE_ID"
    ;;
  strict)
    switch_gate "G2"
    ;;
  permissive|open)
    switch_gate "none"
    ;;
  *)
    echo "Usage: $0 {status|switch|strict|permissive} [gate-id]"
    echo ""
    echo "Examples:"
    echo "  $0 status                    # 查看当前状态"
    echo "  $0 switch G2                 # 切换到审查门（只读）"
    echo "  $0 switch G4                 # 切换到复核门（深度只读）"
    echo "  $0 strict                    # 快捷方式：进入严格模式"
    echo "  $0 permissive                # 快捷方式：解除限制"
    exit 1
    ;;
esac
