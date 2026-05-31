#!/bin/bash
# 文档目录生成兼容入口
# 用法:
#   ./scripts/generate_toc.sh
#   ./scripts/generate_toc.sh prd-main
#   ./scripts/generate_toc.sh PROJECT-主文档.md

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Prefer git root when available; otherwise treat the parent of /scripts as the repo root.
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"
PYTHON_ENTRY="$REPO_ROOT/scripts/generate_toc.py"
TARGET="${1:-prd-main}"

exec python3 "$PYTHON_ENTRY" "$TARGET"
