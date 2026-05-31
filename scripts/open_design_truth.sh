#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

PORT="${1:-4173}"

echo "Serving design truth previews at: http://localhost:${PORT}/examples/preview-component-buttons.html"
echo "Root: ${ROOT_DIR}/product-truth-产品真相层/design-truth-设计真相层"

python3 -m http.server "${PORT}" --directory "${ROOT_DIR}/product-truth-产品真相层/design-truth-设计真相层"
