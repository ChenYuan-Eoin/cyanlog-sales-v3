#!/bin/bash
# REQ:GOV-EXE-002
# PURPOSE: 安装 Price V3 治理 hooks
# 用法: ./harness-manager-治理管理/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/install-hooks.sh [git-repo-path]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
REGISTRY_RELATIVE_PATH="harness-manager-治理管理/runtime-config-AI运行配置/config-配置文件/project-governance-项目治理注册表.json"

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
