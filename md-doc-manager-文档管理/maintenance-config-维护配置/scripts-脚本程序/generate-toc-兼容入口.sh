#!/bin/bash
# 文档目录生成兼容入口
# 用法:
#   ./scripts/generate_toc.sh
#   ./scripts/generate_toc.sh prd-main
#   ./scripts/generate_toc.sh PROJECT-主文档.md

set -e

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$(cd "$(dirname "$0")/../../.." && pwd)")"
PYTHON_ENTRY="$REPO_ROOT/scripts/generate_toc.py"
TARGET="${1:-prd-main}"

exec python3 "$PYTHON_ENTRY" "$TARGET"
