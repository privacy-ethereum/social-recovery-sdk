# System Architecture

## Overview

```
┌──────────────────────────────────────────────────────────────┐
│                         WALLET                               │
│  Authorizes: Owner Key + RecoveryManager address             │
└──────────────────────────────────────────────────────────────┘
                              │
                   authorized to execute
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    RECOVERY MANAGER                          │
│                   (one per wallet)                           │
│                                                              │
│  Policy: wallet, threshold, challengePeriod, guardians[]     │
│  Session: intentHash, newOwner, deadline, approvals[]        │
│                                                              │
│  startRecovery() → submitProof() → executeRecovery()         │
└──────────────────────────────────────────────────────────────┘
                              │
              delegates proof verification
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │   EOA    │   │ Passkey  │   │  zkJWT   │
        │ecrecover │   │ Verifier │   │ Verifier │
        └──────────┘   └──────────┘   └──────────┘
```

## On-Chain Components

### RecoveryManager

One instance per wallet. Core responsibilities:
- Store policy (guardians, threshold, challenge period)
- Manage recovery sessions
- Verify proofs (delegating to verifiers)
- Execute ownership transfer

### RecoveryManagerFactory

Singleton contract that deploys RecoveryManager instances using EIP-1167 minimal proxies:
- Gas efficient (~100k vs ~300k for full deployment)
- Each wallet gets isolated storage
- Deterministic addresses via CREATE2

### Verifiers (Singletons)

**PasskeyVerifier**
- Verifies WebAuthn assertions with P-256 signatures
- Uses RIP-7212 precompile where available, fallback otherwise

**ZkJwtVerifier**
- Verifies Noir ZK proofs
- Validates JWT signature + email commitment in zero knowledge

## Off-Chain Components (SDK)

### RecoveryClient

Main entry point for the SDK:
- Orchestrates the full recovery flow
- Interacts with on-chain contracts
- Manages proof collection

### AuthManager

Coordinates authentication adapters:
- Routes proof requests to correct adapter
- Handles different auth method requirements

### Auth Adapters

| Adapter | Purpose |
|---------|---------|
| EoaAdapter | EIP-712 signature generation |
| PasskeyAdapter | WebAuthn credential management |
| ZkJwtAdapter | OAuth flow + Noir proof generation |

### PolicyBuilder

Fluent API for constructing guardian policies:

```typescript
const policy = new PolicyBuilder()
  .addEoaGuardian("0x1234...")
  .addPasskeyGuardian(pubKeyX, pubKeyY)
  .addZkJwtGuardian(emailCommitment)
  .setThreshold(2)
  .setChallengePeriod(86400) // 1 day
  .build();
```

## Data Flow

```
1. Setup
   Owner → PolicyBuilder → Factory.deploy() → RecoveryManager created

2. Recovery
   Guardian → AuthAdapter → Proof → RecoveryManager.submitProof()
                                            │
                                            ▼
                                    Verifier.verify()
                                            │
                                            ▼
                          (threshold met) → Challenge period starts
                                            │
                                            ▼
                          (period elapsed) → executeRecovery()
                                            │
                                            ▼
                                    Wallet.setOwner(newOwner)
```
