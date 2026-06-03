#!/bin/bash
# check-03-test.sh - 单元测试检查
# AI 行为硬约束 #3：所有代码必须通过测试

set -e

echo "🔍 运行单元测试..."

cd product-truth/product-code

if ! pnpm test:run 2>&1; then
    echo "❌ 测试失败"
    echo "   错误：存在失败的测试用例"
    echo "   修复：运行 'pnpm test' 查看详情"
    exit 1
fi

echo "✅ 测试通过"
exit 0
