# Security Model

## Core protections

- Replay protection via `nonce`, `chainId`, and `recoveryManager` in intent
- Session exclusivity (one active recovery at a time)
- Threshold approval requirement
- Challenge period delay before execution
- Owner cancellation during active sessions

## Threat model highlights

- Guardian collusion remains an economic/social risk by design; mitigate with threshold and trusted guardian selection.
- Single guardian compromise is insufficient when threshold > 1.
- Deadline-based session clearing avoids deadlocks from stale sessions.

## Operational recommendations

- Use non-zero challenge periods in production.
- Monitor `RecoveryStarted`, `ThresholdMet`, `RecoveryCancelled`, `RecoveryExecuted` events.
- Keep guardian metadata and off-chain coordination channels secure.
- Audit custom wallet authorization logic around `setOwner`.

## zkJWT-specific notes

- On-chain guardian identifier is commitment only.
- Salt secrecy affects unlinkability/privacy properties.
- Proof correctness depends on circuit/verifier artifact consistency.
