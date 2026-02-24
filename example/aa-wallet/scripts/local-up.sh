#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${ROOT_DIR}/../.." && pwd)"
ANVIL_PORT="${ANVIL_PORT:-8545}"
ANVIL_LOG="${ANVIL_LOG:-/tmp/aa-wallet-anvil.log}"
ANVIL_PID_FILE="${ROOT_DIR}/.anvil.pid"

if lsof -iTCP:"${ANVIL_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Anvil already running on port ${ANVIL_PORT}."
else
  echo "Starting Anvil on port ${ANVIL_PORT}..."
  anvil --port "${ANVIL_PORT}" --code-size-limit 50000 >"${ANVIL_LOG}" 2>&1 &
  echo $! > "${ANVIL_PID_FILE}"
  sleep 1
fi

echo "Building contracts..."
(
  cd "${REPO_ROOT}/contracts"
  FOUNDRY_OFFLINE=true forge build
)
(
  cd "${REPO_ROOT}/example/contracts"
  FOUNDRY_OFFLINE=true forge build
)

echo "Deploying local contract stack..."
(
  cd "${ROOT_DIR}"
  VITE_RPC_URL="http://127.0.0.1:${ANVIL_PORT}" npm run deploy:local
)

echo "Starting web app..."
(
  cd "${ROOT_DIR}"
  VITE_RPC_URL="http://127.0.0.1:${ANVIL_PORT}" npm run dev -- --host 0.0.0.0 --port 5173
)
