# Troubleshooting

## `Recovery intent is invalid`

Common causes:

- `intent.recoveryManager` does not match target RecoveryManager address
- `deadline <= now + challengePeriod`
- stale nonce
- zero address fields

Fix:

- Re-read nonce/policy from chain and recreate intent with `challengePeriodSeconds`.

## Passkey flow error: missing P-256 verifier bytecode

Cause:

- No contract code at `0xc2b78104907F722DABAc4C69f826a522B2754De4`.

Fix:

- Deploy deterministic `p256-verifier` dependency for the network.

## `WalletClient required for write operations`

Cause:

- `RecoveryClient` created without `walletClient` but write method called.

Fix:

- Provide signer-enabled client for tx submission paths.

## WebAuthn not available in tests

Cause:

- Node test environment has no browser WebAuthn APIs.

Fix:

- Use mocked tests for adapter logic and run browser-integrated tests separately.

## `nargo` cache lock / permission issues

Cause:

- Local environment permissions around Noir cache/dependency directories.

Fix:

- Ensure writable cache/home paths for `nargo` and rerun.
