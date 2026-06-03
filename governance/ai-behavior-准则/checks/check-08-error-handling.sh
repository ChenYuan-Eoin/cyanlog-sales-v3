#!/bin/bash
# check-08-error-handling.sh - 错误处理循环检查
# 架构硬约束：错误必须被捕获、记录、恢复

set -e

echo "🔍 检查错误处理循环..."

# 检查全局错误处理
ERROR_BOUNDARY=$(find product-truth/product-code/app -name "error.tsx" -o -name "global-error.tsx" 2>/dev/null | head -3 || true)

if [ -n "$ERROR_BOUNDARY" ]; then
    echo "   ✅ 发现错误边界组件:"
    echo "$ERROR_BOUNDARY" | sed 's/^/      - /'
else
    echo "   ⚠️  未找到错误边界组件"
    echo "      建议创建: app/error.tsx"
fi

# 检查错误日志记录
ERROR_LOGGING=$(grep -r "console.error\|logger.error\|Sentry.capture" product-truth/product-code/app --include="*.ts" --include="*.tsx" 2>/dev/null | head -5 | wc -l | tr -d ' ' || echo "0")

if [ "$ERROR_LOGGING" -gt 0 ]; then
    echo "   ✅ 发现错误日志记录 ($ERROR_LOGGING 处)"
else
    echo "   ⚠️  未找到错误日志记录"
fi

# 检查 API 错误处理
API_ERROR=$(grep -r "try.*catch\|catch (" product-truth/product-code/app/api --include="*.ts" 2>/dev/null | wc -l | tr -d ' ' || echo "0")

if [ "$API_ERROR" -gt 0 ]; then
    echo "   ✅ API 层有错误处理 ($API_ERROR 处)"
else
    echo "   ⚠️  API 层错误处理不足"
fi

# 检查加载状态
LOADING_STATES=$(find product-truth/product-code/app -name "loading.tsx" -o -name "skeleton.tsx" 2>/dev/null | wc -l | tr -d ' ' || echo "0")

if [ "$LOADING_STATES" -gt 0 ]; then
    echo "   ✅ 发现加载状态组件 ($LOADING_STATES 个)"
else
    echo "   ⚠️  未找到加载状态组件"
    echo "      建议创建: app/loading.tsx"
fi

echo "✅ 错误处理循环检查完成"
exit 0
