#!/bin/bash
# Worktree Harness Setup
# 新worktree自动继承harness配置

set -euo pipefail

WORKTREE_PATH="${1:-}"

if [ -z "$WORKTREE_PATH" ]; then
  echo "Usage: $0 <worktree-path>"
  exit 1
fi

# 确保worktree有.claude目录
CLAUDE_DIR="$WORKTREE_PATH/.claude"
mkdir -p "$CLAUDE_DIR"

# 复制settings.json到worktree（符号链接指向主配置）
SETTINGS_SOURCE="/Users/nsss/Price-v3/.claude/settings.json"
SETTINGS_TARGET="$CLAUDE_DIR/settings.json"

if [ -f "$SETTINGS_SOURCE" ]; then
  # 使用符号链接，确保配置同步更新
  ln -sf "$SETTINGS_SOURCE" "$SETTINGS_TARGET"
  echo "✅ Harness配置已链接到worktree"
fi

# 设置环境变量标记
ENV_FILE="$CLAUDE_DIR/.env"
echo "PRICE_V3_WORKSPACE_ROOT=/Users/nsss/Price-v3" > "$ENV_FILE"
echo "PRICE_V3_HARNESS_STRICT=true" >> "$ENV_FILE"

echo "✅ Worktree harness setup complete: $WORKTREE_PATH"
