#!/bin/bash
# check-10-ci-cd-loop.sh - CI/CD 回路检查
# 架构硬约束：代码必须通过 CI/CD 自动化验证

set -e

echo "🔍 检查 CI/CD 回路..."

# 检查 CI 配置
CI_FILE=".github/workflows/ci.yml"

if [ -f "$CI_FILE" ]; then
    echo "   ✅ CI 工作流存在"

    # 检查 CI 中的必要步骤
    if grep -q "lint" "$CI_FILE" 2>/dev/null; then
        echo "      ✓ lint 步骤"
    fi

    if grep -q "test\|typecheck" "$CI_FILE" 2>/dev/null; then
        echo "      ✓ test/typecheck 步骤"
    fi

    if grep -q "build" "$CI_FILE" 2>/dev/null; then
        echo "      ✓ build 步骤"
    fi
else
    echo "   ❌ CI 工作流不存在: $CI_FILE"
    exit 1
fi

# 检查 Vercel 配置
VERCEL_CONFIG="product-truth/product-code/vercel.json"

if [ -f "$VERCEL_CONFIG" ]; then
    echo "   ✅ Vercel 配置存在"
fi

# 检查 package.json 脚本
cd product-truth/product-code

if grep -q '"ci"\|"test:ci"\|"build"' package.json 2>/dev/null; then
    echo "   ✅ package.json 包含 CI 脚本"
fi

# 检查分支保护提示
if [ -d ".git" ]; then
    echo "   ℹ️  提醒：确保 main 分支启用了分支保护"
    echo "      - 需要 PR 才能合并"
    echo "      - 需要 CI 通过"
fi

echo "✅ CI/CD 回路检查完成"
exit 0
