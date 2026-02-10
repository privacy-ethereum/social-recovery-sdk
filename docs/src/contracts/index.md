# Contracts Guide

## Main contracts

- `RecoveryManager.sol` - per-wallet policy/session state and execution logic
- `RecoveryManagerFactory.sol` - deploys minimal proxy instances
- `verifiers/PasskeyVerifier.sol` - passkey proof verification
- `verifiers/ZkJwtVerifier.sol` - zk proof verification wrapper around Honk verifier

## Wallet-facing integration contract

Wallets integrate by implementing `IWallet`:

- `owner()`
- `setOwner(address)`
- `isRecoveryAuthorized(address)`

`RecoveryManager.executeRecovery()` calls wallet `setOwner(newOwner)`.

## Lifecycle-critical invariants

- One active session per wallet
- Nonce replay protection
- Threshold + challenge period gating
- Deadline expiry prevents execution and further approvals
- Owner-only cancellation
