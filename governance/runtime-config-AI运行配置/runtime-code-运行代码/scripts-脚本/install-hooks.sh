#!/bin/bash
# REQ:GOV-EXE-002
# ⚠️ DEPRECATED: 此脚本已弃用，使用 .githooks/ 替代
# 新安装方式: git config core.hooksPath .githooks
#
# 旧用法（保留仅作参考）: ./governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/install-hooks.sh [git-repo-path]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
REGISTRY_RELATIVE_PATH="governance/runtime-config-AI运行配置/config-配置文件/project-governance-项目治理注册表.json"

echo "⚠️  此脚本已弃用"
echo "   新安装方式: git config core.hooksPath .githooks"
echo ""

# 新方式检查
if [ -d "$REPO_ROOT/.githooks" ]; then
    echo "✅ 检测到 .githooks/ 目录"
    echo "   请执行: cd $REPO_ROOT && git config core.hooksPath .githooks"
    exit 0
fi

# 旧逻辑（向后兼容，但提示弃用）
echo "⚠️  正在使用旧安装方式（已弃用）..."
echo ""

WORKSPACE_ROOT="$REPO_ROOT"

if [ $# -gt 0 ]; then
    TARGET_REPO_ROOT="$(cd "$1" && pwd)"
elif git rev-parse --show-toplevel >/dev/null 2>&1; then
    TARGET_REPO_ROOT="$(git rev-parse --show-toplevel)"
elif git -C "$WORKSPACE_ROOT/cyanlog-sales-v3" rev-parse --show-toplevel >/dev/null 2>&1; then
    TARGET_REPO_ROOT="$(git -C "$WORKSPACE_ROOT/cyanlog-sales-v3" rev-parse --show-toplevel)"
else
    echo "❌ 未找到可安装 hooks 的 Git 仓库"
    echo "   请在目标仓库内执行，或显式传入仓库路径。"
    exit 1
fi

PRE_COMMIT_PATH="$(git -C "$TARGET_REPO_ROOT" rev-parse --git-path hooks/pre-commit)"
case "$PRE_COMMIT_PATH" in
    /*) ;;
    *) PRE_COMMIT_PATH="$TARGET_REPO_ROOT/$PRE_COMMIT_PATH" ;;
esac
HOOKS_DST="$(dirname "$PRE_COMMIT_PATH")"

echo "🔧 Installing Price V3 governance hooks..."
echo "   Workspace root: $WORKSPACE_ROOT"
echo "   Target repo: $TARGET_REPO_ROOT"
echo "   Hook path: $PRE_COMMIT_PATH"
echo ""

mkdir -p "$HOOKS_DST"

cat > "$PRE_COMMIT_PATH" <<EOF
#!/bin/bash
set -e

HOOK_DIR="\$(cd "\$(dirname "\$0")" && pwd)"
SEARCH_DIR="\$HOOK_DIR"
WORKSPACE_ROOT=""

while [ "\$SEARCH_DIR" != "/" ]; do
    if [ -f "\$SEARCH_DIR/$REGISTRY_RELATIVE_PATH" ] && [ -f "\$SEARCH_DIR/scripts/run_managed_hook.py" ]; then
        WORKSPACE_ROOT="\$SEARCH_DIR"
        break
    fi
    SEARCH_DIR="\$(dirname "\$SEARCH_DIR")"
done

if [ -z "\$WORKSPACE_ROOT" ]; then
    echo "❌ Unable to locate workspace root for managed hooks" >&2
    exit 1
fi

REPO_ROOT="\$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
export PRICE_V3_EXECUTION_ROOT="\$REPO_ROOT"
exec python3 "\$WORKSPACE_ROOT/scripts/run_managed_hook.py" git-pre-commit "\$@"
EOF

chmod +x "$PRE_COMMIT_PATH"

echo "✅ pre-commit wrapper installed"
echo ""
echo "📋 Verification:"
if [ -x "$PRE_COMMIT_PATH" ]; then
    echo "   ✅ pre-commit is executable"
else
    echo "   ❌ pre-commit is not executable"
    exit 1
fi

echo ""
echo "🎉 Governance hook wrapper installed successfully"
