#!/bin/bash
# check-09-business-loop.sh - 业务闭环循环检查
# 架构硬约束：业务流程必须有完整的生命周期

set -e

echo "🔍 检查业务闭环循环..."

# 检查 REQ_REGISTRY 是否存在
REQ_REGISTRY="product-truth/REQ_REGISTRY.yml"

if [ -f "$REQ_REGISTRY" ]; then
    echo "   ✅ REQ_REGISTRY 存在"
    REQ_COUNT=$(grep -E "^\s+[A-Z]+-[0-9]+:" "$REQ_REGISTRY" 2>/dev/null | wc -l | tr -d ' ' || echo "0")
    echo "      注册了 $REQ_COUNT 个需求"
else
    echo "   ❌ REQ_REGISTRY 不存在"
    exit 1
fi

# 检查 feature-packets 目录
PACKETS_DIR="product-truth/feature-packets"

if [ -d "$PACKETS_DIR" ]; then
    PACKET_COUNT=$(ls "$PACKETS_DIR"/*.md 2>/dev/null | wc -l | tr -d ' ' || echo "0")
    echo "   ✅ feature-packets 目录存在 ($PACKET_COUNT 个 packet)"
else
    echo "   ⚠️  feature-packets 目录不存在"
fi

# 检查实施真相目录
IMPL_DIR="product-truth/04-implementation-truth"

if [ -d "$IMPL_DIR" ]; then
    echo "   ✅ 04-implementation-truth 目录存在"
else
    echo "   ⚠️  04-implementation-truth 目录不存在"
fi

# 检查状态流转追踪
if grep -q "状态\|status\|state" "$REQ_REGISTRY" 2>/dev/null; then
    echo "   ✅ REQ_REGISTRY 包含状态信息"
fi

echo "✅ 业务闭环循环检查完成"
exit 0
