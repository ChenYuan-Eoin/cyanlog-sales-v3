#!/bin/bash
# check-05-git.sh - Git 提交质量检查
# AI 行为硬约束 #5：提交前必须完成基础验证

set -e

echo "🔍 检查 Git 提交质量..."

# 1. 检查是否有未跟踪的大文件
LARGE_FILES=$(git ls-files --others --exclude-standard 2>/dev/null | head -20 | while read f; do
    if [ -f "$f" ]; then
        size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null || echo "0")
        if [ "$size" -gt 10485760 ]; then
            echo "$f (${size} bytes)"
        fi
    fi
done || true)

if [ -n "$LARGE_FILES" ]; then
    echo "⚠️  发现大文件（>10MB），可能不应该提交:"
    echo "$LARGE_FILES" | sed 's/^/     - /'
fi

# 2. 检查暂存区新增文件是否有对应文档
NEW_FILES=$(git diff --cached --name-only --diff-filter=A 2>/dev/null | grep -v "node_modules" | grep -E "\.(ts|tsx|js|jsx)$" || true)

if [ -n "$NEW_FILES" ]; then
    echo "   新增代码文件:"
    echo "$NEW_FILES" | head -5 | sed 's/^/     - /'
fi

# 3. 检查敏感信息（简单规则）
SENSITIVE=$(git diff --cached -U0 2>/dev/null | grep -E "(password|secret|api[_-]?key|token)" || true)

if [ -n "$SENSITIVE" ]; then
    echo "⚠️  提交中包含敏感关键词，请确认不是真实密钥:"
    echo "$SENSITIVE" | head -3 | sed 's/^/     /'
fi

echo "✅ Git 检查完成"
exit 0
