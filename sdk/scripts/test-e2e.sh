#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ANVIL_PORT="${ANVIL_PORT:-8545}"
ANVIL_LOG="${ANVIL_LOG:-/tmp/social-recovery-anvil.log}"

cleanup() {
  if [[ -n "${ANVIL_PID:-}" ]]; then
    kill "${ANVIL_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

cd "${ROOT_DIR}/contracts"
if [[ "${FORGE_OFFLINE:-0}" == "1" ]]; then
  FOUNDRY_PROFILE=deploy forge build --offline >/dev/null
else
  FOUNDRY_PROFILE=deploy forge build >/dev/null
fi

anvil --port "${ANVIL_PORT}" --code-size-limit 50000 >"${ANVIL_LOG}" 2>&1 &
ANVIL_PID=$!
sleep 1

cd "${ROOT_DIR}/sdk"
VITE_E2E_RPC_URL="http://127.0.0.1:${ANVIL_PORT}" npx vitest run test/e2e.test.ts
