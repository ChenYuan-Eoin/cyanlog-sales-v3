#!/bin/bash
# Worktree Harness Setup
# 新worktree自动继承harness配置

set -euo pipefail

WORKTREE_PATH="${1:-}"

if [ -z "$WORKTREE_PATH" ]; then
  echo "Usage: $0 <worktree-path>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
TARGET_ROOT="$(cd "$WORKTREE_PATH" && pwd)"

# 确保worktree有.claude目录
CLAUDE_DIR="$WORKTREE_PATH/.claude"
mkdir -p "$CLAUDE_DIR"

# 确保worktree有 Codex 项目级 hook 配置
CODEX_DIR="$WORKTREE_PATH/.codex"
mkdir -p "$CODEX_DIR"

SETTINGS_TARGET="$CLAUDE_DIR/settings.json"
cat > "$SETTINGS_TARGET" <<'JSON'
{
  "extends": "../governance/runtime-config-AI运行配置/config-配置文件/settings-claude运行配置.json"
}
JSON
echo "✅ Harness配置已写入worktree"

for CODEX_FILE in hooks.json config.toml; do
  SOURCE="$SOURCE_ROOT/.codex/$CODEX_FILE"
  TARGET="$CODEX_DIR/$CODEX_FILE"
  if [ -f "$SOURCE" ] && [ ! -e "$TARGET" ]; then
    cp "$SOURCE" "$TARGET"
    echo "✅ Codex $CODEX_FILE 已复制到worktree"
  elif [ -e "$TARGET" ]; then
    echo "ℹ️ Codex $CODEX_FILE 已存在，保留worktree本地版本"
  fi
done

# 设置环境变量标记
ENV_FILE="$CLAUDE_DIR/.env"
echo "PRICE_V3_WORKSPACE_ROOT=$TARGET_ROOT" > "$ENV_FILE"
echo "PRICE_V3_HARNESS_STRICT=true" >> "$ENV_FILE"

echo "✅ Worktree harness setup complete: $WORKTREE_PATH"
