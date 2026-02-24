#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANVIL_PORT="${ANVIL_PORT:-8545}"
ANVIL_PID_FILE="${ROOT_DIR}/.anvil.pid"

if [[ -f "${ANVIL_PID_FILE}" ]]; then
  PID="$(cat "${ANVIL_PID_FILE}")"
  if kill -0 "${PID}" >/dev/null 2>&1; then
    echo "Stopping Anvil process ${PID}..."
    kill "${PID}" || true
  fi
  rm -f "${ANVIL_PID_FILE}"
else
  echo "No Anvil pid file found. Attempting port-based shutdown on ${ANVIL_PORT}..."
  PIDS="$(lsof -tiTCP:${ANVIL_PORT} -sTCP:LISTEN || true)"
  if [[ -n "${PIDS}" ]]; then
    kill ${PIDS} || true
  fi
fi

echo "Stopped local services."
