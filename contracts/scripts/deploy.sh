#!/usr/bin/env bash
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for this script" >&2
  exit 1
fi

: "${RPC_URL:?RPC_URL is required}"
: "${PRIVATE_KEY:?PRIVATE_KEY is required}"
: "${ETHERSCAN_API_KEY:?ETHERSCAN_API_KEY is required for verification}"

PROFILE="${FOUNDRY_PROFILE:-deploy}"
CHAIN="${CHAIN:-sepolia}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

create_json() {
  local target="$1"
  shift
  FOUNDRY_PROFILE="${PROFILE}" forge create \
    --rpc-url "${RPC_URL}" \
    --private-key "${PRIVATE_KEY}" \
    --chain "${CHAIN}" \
    --broadcast \
    --verify \
    --verifier etherscan \
    --etherscan-api-key "${ETHERSCAN_API_KEY}" \
    --json \
    --optimizer-runs 1 \
    "$target" \
    "$@"
}

extract_address() {
  jq -r '.deployedTo'
}

echo "Deploying PasskeyVerifier..."
PASSKEY_VERIFIER="$(create_json src/verifiers/PasskeyVerifier.sol:PasskeyVerifier | extract_address)"

echo "Deploying ZKTranscriptLib..."
ZK_TRANSCRIPT_LIB="$(create_json src/verifiers/HonkVerifier.sol:ZKTranscriptLib | extract_address)"

echo "Deploying HonkVerifier (linked with ZKTranscriptLib)..."
HONK_VERIFIER="$(
  create_json \
    src/verifiers/HonkVerifier.sol:HonkVerifier \
    --libraries "src/verifiers/HonkVerifier.sol:ZKTranscriptLib:${ZK_TRANSCRIPT_LIB}" \
    | extract_address
)"

echo "Deploying ZkJwtVerifier..."
ZKJWT_VERIFIER="$(create_json src/verifiers/ZkJwtVerifier.sol:ZkJwtVerifier --constructor-args "${HONK_VERIFIER}" | extract_address)"

echo "Deploying RecoveryManager implementation..."
RECOVERY_MANAGER_IMPL="$(create_json src/RecoveryManager.sol:RecoveryManager | extract_address)"

echo "Deploying RecoveryManagerFactory..."
FACTORY="$(
  create_json \
    src/RecoveryManagerFactory.sol:RecoveryManagerFactory \
    --constructor-args "${RECOVERY_MANAGER_IMPL}" "${PASSKEY_VERIFIER}" "${ZKJWT_VERIFIER}" \
    | extract_address
)"

echo ""
echo "Deployment complete"
echo "PASSKEY_VERIFIER=${PASSKEY_VERIFIER}"
echo "ZK_TRANSCRIPT_LIB=${ZK_TRANSCRIPT_LIB}"
echo "HONK_VERIFIER=${HONK_VERIFIER}"
echo "ZKJWT_VERIFIER=${ZKJWT_VERIFIER}"
echo "RECOVERY_MANAGER_IMPL=${RECOVERY_MANAGER_IMPL}"
echo "FACTORY=${FACTORY}"
