#!/bin/bash
# REQ:GOV-H006
# PURPOSE: 检查敏感信息不泄露到代码中
# 触发: git pre-commit

set -euo pipefail

echo "  Checking for sensitive information in staged files..."

ROOT_DIR="$(git rev-parse --show-toplevel)"
ERRORS=0
ENV_FILES=()

while IFS= read -r -d '' file; do
    case "$file" in
        *.env.local|*.env.production|*.env.development|*.env.test)
            ENV_FILES+=("$file")
            ;;
    esac

    case "$file" in
        *.ts|*.tsx|*.js|*.jsx) ;;
        *) continue ;;
    esac

    if [ ! -f "$ROOT_DIR/$file" ]; then
        continue
    fi

    # 检查常见的敏感信息模式
    if grep -nE '(password|secret|api_key|apikey|token|private_key)\s*[:=]\s*["\047][^"\047]{8,}' "$ROOT_DIR/$file" 2>/dev/null | grep -v "// " | grep -v "# " | head -3; then
        echo "    ❌ $file: Possible hardcoded credential detected"
        ERRORS=$((ERRORS + 1))
    fi

    # 检查 OpenAI/Anthropic API keys
    if grep -nE 'sk-[a-zA-Z0-9]{20,}' "$ROOT_DIR/$file" 2>/dev/null | head -1; then
        echo "    ❌ $file: Possible API key detected"
        ERRORS=$((ERRORS + 1))
    fi
done < <(git diff --cached --name-only -z)

if [ "${#ENV_FILES[@]}" -gt 0 ]; then
    echo "    ❌ Environment files should not be committed:"
    printf '       - %s\n' "${ENV_FILES[@]}"
    ERRORS=$((ERRORS + 1))
fi

if [ "$ERRORS" -eq 0 ]; then
    echo "    ✅ No sensitive information detected"
    exit 0
else
    exit 1
fi
