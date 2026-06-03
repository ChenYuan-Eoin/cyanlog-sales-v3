#!/bin/bash
# check-04-nav.sh - 导航集成检查
# AI 行为硬约束 #4：新功能必须集成到导航

set -e

echo "🔍 检查导航集成..."

NAV_FILE="product-truth/product-code/components/layout/sidebar.tsx"

if [ ! -f "$NAV_FILE" ]; then
    echo "⚠️  未找到导航文件: $NAV_FILE"
    echo "   跳过此检查"
    exit 0
fi

# 检查最近修改的文件是否包含页面或路由
RECENT_FILES=$(git diff --name-only --cached --diff-filter=A 2>/dev/null | grep -E "^product-truth/product-code/app/" || true)

if [ -z "$RECENT_FILES" ]; then
    echo "✅ 无新增页面，跳过导航检查"
    exit 0
fi

echo "   新增页面 detected:"
echo "$RECENT_FILES" | head -5 | sed 's/^/     - /'

# 检查是否修改了导航文件
NAV_CHANGED=$(git diff --name-only --cached 2>/dev/null | grep -E "sidebar|nav|menu" || true)

if [ -z "$NAV_CHANGED" ]; then
    echo "⚠️  警告：新增页面但未修改导航文件"
    echo "   请确认已将新页面集成到侧边栏或顶部菜单"
    echo "   如需跳过此检查：git commit --no-verify"
    # 不阻断，只警告
fi

echo "✅ 导航检查完成"
exit 0
