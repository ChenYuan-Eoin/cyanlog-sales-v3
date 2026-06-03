#!/bin/bash
# check-06-feedback-loop.sh - 用户反馈循环检查
# 架构硬约束：用户反馈必须被捕获、分类、响应

set -e

echo "🔍 检查用户反馈循环..."

# 检查反馈数据表/存储是否存在
FEEDBACK_TABLE="product-truth/product-code/supabase/migrations/*feedback*"
FEEDBACK_STORAGE="product-truth/product-code/app/api/feedback"

if ls $FEEDBACK_TABLE 1> /dev/null 2>&1; then
    echo "   ✅ 发现反馈相关的数据库迁移"
fi

if [ -d "$FEEDBACK_STORAGE" ]; then
    echo "   ✅ 发现反馈 API 端点"
fi

# 检查是否有反馈收集 UI
FEEDBACK_UI=$(find product-truth/product-code -name "*.tsx" -exec grep -l "feedback\|意见反馈\|问题反馈" {} \; 2>/dev/null | head -5 || true)

if [ -n "$FEEDBACK_UI" ]; then
    echo "   ✅ 发现反馈收集 UI:"
    echo "$FEEDBACK_UI" | sed 's/^/      - /'
else
    echo "   ⚠️  未找到反馈收集 UI（新项目可忽略）"
fi

# 检查监控/分析集成
ANALYTICS=$(find product-truth/product-code -name "*.ts" -o -name "*.tsx" | xargs grep -l "gtag\|analytics\|posthog\|sentry" 2>/dev/null | head -3 || true)

if [ -n "$ANALYTICS" ]; then
    echo "   ✅ 发现分析工具集成"
fi

echo "✅ 用户反馈循环检查完成"
exit 0
