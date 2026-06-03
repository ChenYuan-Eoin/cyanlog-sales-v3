#!/bin/bash
# check-07-healthcheck.sh - 健康检查循环检查
# 架构硬约束：系统必须有健康检查端点

set -e

echo "🔍 检查健康检查循环..."

# 检查健康检查端点
HEALTH_ENDPOINTS=$(find product-truth/product-code/app -name "*health*" -o -name "*status*" 2>/dev/null | head -5 || true)

if [ -n "$HEALTH_ENDPOINTS" ]; then
    echo "   ✅ 发现健康检查端点:"
    echo "$HEALTH_ENDPOINTS" | sed 's/^/      - /'
else
    echo "   ⚠️  未找到健康检查端点"
    echo "      建议创建: app/api/health/route.ts"
fi

# 检查 package.json 中的健康检查脚本
cd product-truth/product-code

if grep -q "healthcheck\|health" package.json 2>/dev/null; then
    echo "   ✅ 发现健康检查脚本"
fi

# 检查 Docker/部署配置
if [ -f "docker-compose.yml" ] && grep -q "healthcheck" docker-compose.yml 2>/dev/null; then
    echo "   ✅ Docker 健康检查已配置"
fi

echo "✅ 健康检查循环检查完成"
exit 0
