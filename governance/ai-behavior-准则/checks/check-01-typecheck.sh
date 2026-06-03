#!/bin/bash
# check-01-typecheck.sh - TypeScript 类型检查
# AI 行为硬约束 #1：所有代码必须通过类型检查

set -e

echo "🔍 运行 TypeScript 类型检查..."

cd product-truth/product-code

if ! pnpm tsc --noEmit 2>&1; then
    echo "❌ 类型检查失败"
    echo "   错误：存在 TypeScript 类型错误"
    echo "   修复：运行 'pnpm tsc --noEmit' 查看详情"
    exit 1
fi

echo "✅ 类型检查通过"
exit 0
