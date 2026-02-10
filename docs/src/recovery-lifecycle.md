# Recovery Lifecycle

## 1. Setup

1. Choose guardian set and threshold.
2. Deploy RecoveryManager for the wallet via factory.
3. Authorize RecoveryManager in wallet logic.

## 2. Start recovery

A guardian calls `startRecovery(intent, guardianIndex, proof)`.

Key constraints enforced by contract:

- No active session already
- Intent fields match wallet/nonce/chain/contract
- `intent.deadline > block.timestamp + challengePeriod`
- Guardian index exists and proof verifies

## 3. Submit additional proofs

Other guardians call `submitProof(guardianIndex, proof)`.

- Duplicate approvals are rejected.
- When approvals reach threshold, `thresholdMetAt` is set.

## 4. Challenge period window

Until execution:

- Owner can call `cancelRecovery()`.
- If deadline passes, anyone can call `clearExpiredRecovery()`.

## 5. Execute recovery

After challenge period and before deadline, anyone can call `executeRecovery()`.

- RecoveryManager calls wallet `setOwner(newOwner)`.
- Session is cleared and nonce increments.

## Session reset cases

Session state is reset and nonce increments on:

- `executeRecovery()`
- `cancelRecovery()`
- `clearExpiredRecovery()`
- `updatePolicy()`
