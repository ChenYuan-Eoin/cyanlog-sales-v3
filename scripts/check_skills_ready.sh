#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== Price-v3 Skill/Plugin Readiness =="
echo "repo_root: ${REPO_ROOT}"
echo

note() { printf " - %s\n" "$1"; }
ok() { printf "✅ %s\n" "$1"; }
warn() { printf "⚠️  %s\n" "$1"; }
fail() { printf "❌ %s\n" "$1"; exit 2; }

have() { command -v "$1" >/dev/null 2>&1; }

echo "[1/4] Core toolchain"
have node && ok "node: $(node -v)" || fail "node missing"
have python3 && ok "python3: $(python3 --version | head -n 1)" || fail "python3 missing"
have rg && ok "rg present" || warn "rg missing (recommended)"
have jq && ok "jq present" || warn "jq missing (recommended)"
have gh && ok "gh present (needed for commit-commands PR flow)" || warn "gh missing (commit-commands PR flow will not work)"
have npx && ok "npx present (used by MCP servers like context7/playwright)" || warn "npx missing"
echo

echo "[2/4] LSP helpers (optional but high-value)"
if have typescript-language-server; then ok "typescript-language-server present"; else warn "typescript-language-server missing"; fi
if have pyright; then
  ok "pyright present"
else
  # Some setups use a custom npm global prefix (this repo uses /Users/nsss/Desktop/.npm-global)
  NPM_PREFIX="$(npm config get prefix 2>/dev/null || true)"
  if [[ -n "${NPM_PREFIX}" && -x "${NPM_PREFIX}/bin/pyright" ]]; then
    warn "pyright found at ${NPM_PREFIX}/bin/pyright but not in PATH (add ${NPM_PREFIX}/bin to PATH)"
  else
    warn "pyright missing (pyright-lsp plugin will be degraded)"
  fi
fi
echo

echo "[3/4] Managed hooks smoke test"
python3 "${REPO_ROOT}/scripts/run_managed_hook.py" claude-user-prompt-submit </dev/null && ok "claude-user-prompt-submit ok" || fail "claude-user-prompt-submit failed"
python3 "${REPO_ROOT}/scripts/run_managed_hook.py" claude-pretool-req-confirmed </dev/null && ok "claude-pretool-req-confirmed ok" || fail "claude-pretool-req-confirmed failed"
python3 "${REPO_ROOT}/scripts/run_managed_hook.py" claude-pretool-req-id </dev/null && ok "claude-pretool-req-id ok" || fail "claude-pretool-req-id failed"
python3 "${REPO_ROOT}/scripts/run_managed_hook.py" generate-changelog </dev/null && ok "generate-changelog ok (or skipped)" || fail "generate-changelog failed"
echo

echo "[4/4] Environment prereqs (best-effort)"
if [[ -z "${GITHUB_PERSONAL_ACCESS_TOKEN:-}" ]]; then
  warn "GITHUB_PERSONAL_ACCESS_TOKEN is not set (github plugin MCP will not authenticate)"
else
  ok "GITHUB_PERSONAL_ACCESS_TOKEN is set"
fi

echo
ok "Readiness check complete"
