#!/bin/bash
# check-02-lint.sh - ESLint 代码检查
# AI 行为硬约束 #2：所有代码必须通过 lint

set -e

echo "🔍 运行 ESLint 检查..."

cd product-truth/product-code

if ! pnpm lint 2>&1; then
    echo "❌ Lint 检查失败"
    echo "   错误：存在代码风格问题"
    echo "   修复：运行 'pnpm lint --fix' 自动修复"
    exit 1
fi

echo "✅ Lint 检查通过"
exit 0
