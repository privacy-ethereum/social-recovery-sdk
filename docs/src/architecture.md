# System Architecture

## High-level flow

```text
Wallet (owner + authorized RecoveryManager)
  -> RecoveryManager (per wallet instance)
     -> Verifier path by guardian type
        - EOA: ecrecover
        - Passkey: PasskeyVerifier
        - zkJWT: ZkJwtVerifier -> HonkVerifier
```

## On-chain components

- `RecoveryManager.sol`
  - Policy storage
  - Session lifecycle (`startRecovery`, `submitProof`, `executeRecovery`, `cancelRecovery`, `clearExpiredRecovery`)
- `RecoveryManagerFactory.sol`
  - Deploys per-wallet RecoveryManager proxies
- `verifiers/PasskeyVerifier.sol`
  - Verifies WebAuthn/P-256 proof payloads
- `verifiers/ZkJwtVerifier.sol`
  - Verifies Noir proofs and binds public inputs to intent + guardian commitment

## Off-chain SDK components

- `recovery/RecoveryClient.ts`
  - Deployment helpers, recovery tx orchestration, readiness checks
- `recovery/PolicyBuilder.ts`
  - Fluent builder + validation for policy config
- `auth/AuthManager.ts`
  - Adapter registry and proof generation delegation
- `auth/adapters/*`
  - Guardian-specific proof generation (EOA, passkey, zkJWT)

## Circuit component

- `circuits/zkjwt/src/main.nr`
  - JWT verification and zk commitment constraints
- `circuits/zkjwt/scripts/`
  - Prover input generation utilities and fixtures
