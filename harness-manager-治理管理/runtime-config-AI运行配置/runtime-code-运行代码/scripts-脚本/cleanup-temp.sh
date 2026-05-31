#!/bin/bash
# REQ:GOV-CLEAN-001
# PURPOSE: 临时文件清理脚本 - 按策略清理临时目录
# 用法: ./harness-manager-治理管理/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/cleanup-temp.sh

set -euo pipefail
shopt -s nullglob

TEMP_DIR="临时文件"
DOCS_DIR="product-truth-产品真相层"
ARCHIVE_DIR="$DOCS_DIR/temporary-archive"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🧹 Price V3 Temporary File Cleanup"
echo "=================================="
echo ""

# 检查临时目录是否存在
if [ ! -d "$TEMP_DIR" ]; then
    echo "✅ No temporary directory found"
    exit 0
fi

# 创建归档目录
mkdir -p "$ARCHIVE_DIR/design"
mkdir -p "$ARCHIVE_DIR/research"
mkdir -p "$ARCHIVE_DIR/scripts"

# 统计函数
MOVED=0
DELETED=0
CONFIRM=0

# 处理设计稿 -> 归档到 archived/design/
for file in "$TEMP_DIR"/*.{fig,sketch,xd,png,jpg,jpeg}; do
    [ -e "$file" ] || continue
    filename=$(basename "$file")
    echo "📐 Moving design file: $filename"
    mv "$file" "$ARCHIVE_DIR/design/"
    MOVED=$((MOVED + 1))
done

# 处理调研资料 -> 归档到 archived/research/
for file in "$TEMP_DIR"/*.{pdf,docx,xlsx,txt}; do
    [ -e "$file" ] || continue
    # 检查是否包含调研关键字
    if echo "$file" | grep -qiE "(调研|分析|报告|research|analysis)"; then
        filename=$(basename "$file")
        echo "📊 Moving research file: $filename"
        mv "$file" "$ARCHIVE_DIR/research/"
        MOVED=$((MOVED + 1))
    fi
done

# 处理脚本 -> 归档到 archived/scripts/
for file in "$TEMP_DIR"/*.{py,sh,js}; do
    [ -e "$file" ] || continue
    filename=$(basename "$file")
    echo "🔧 Moving script: $filename"
    mv "$file" "$ARCHIVE_DIR/scripts/"
    MOVED=$((MOVED + 1))
done

# 删除日志/缓存（7天以上）
while IFS= read -r f; do
    echo "🗑️  Deleting old log: $(basename "$f")"
    rm "$f"
    DELETED=$((DELETED + 1))
done < <(find "$TEMP_DIR" -name "*.log" -mtime +7 -type f 2>/dev/null)

while IFS= read -r f; do
    echo "🗑️  Deleting temp file: $(basename "$f")"
    rm "$f"
    DELETED=$((DELETED + 1))
done < <(find "$TEMP_DIR" -name "*.tmp" -mtime +1 -type f 2>/dev/null)

# 处理未知文件（需确认）
UNKNOWN=$(find "$TEMP_DIR" -type f 2>/dev/null)
if [ -n "$UNKNOWN" ]; then
    echo ""
    echo "⚠️  Unknown files found:"
    echo "$UNKNOWN" | while read f; do
        echo "   - $(basename "$f")"
    done
    echo ""
    echo "Please review and move/delete these files manually."
    CONFIRM=$(echo "$UNKNOWN" | wc -l)
fi

# 如果目录为空，删除它
if [ -z "$(ls -A "$TEMP_DIR" 2>/dev/null)" ]; then
    rmdir "$TEMP_DIR"
    echo "✅ Removed empty temporary directory"
fi

# 输出统计
echo ""
echo "=================================="
echo "📊 Cleanup Summary:"
echo "   Moved:   $MOVED files"
echo "   Deleted: $DELETED files"
echo "   Pending: $CONFIRM files (need manual review)"
echo ""
echo "✅ Cleanup complete!"
