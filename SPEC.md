# Social Recovery SDK v1 — Technical Specification

**Version:** 1.0.0-draft
**Date:** 2026-01-12

---

## 1. Overview

### 1.1 Purpose

A composable, standalone SDK for adding social recovery to smart wallets. Wallet owners designate guardians who can collectively restore access if the owner loses their keys.

### 1.2 Design Goals

- **Easy Integration**: Drop-in SDK for existing smart wallets
- **Minimal Centralization**: No centralized services for core functionality
- **Good UX**: Similar to Web2 "forgot password" flows
- **Extensible**: Easy to add new authentication methods
- **Privacy**: Guardian identities protected where possible (especially for zkJWT)

### 1.3 Scope

**In scope:**
- Guardian configuration with multiple auth methods (EOA, Passkey, zkJWT)
- N-of-M threshold policies
- Recovery lifecycle: initiate → collect proofs → challenge period → execute
- On-chain proof verification
- EIP-7702 and EIP-4337 wallet compatibility

**Out of scope:**
- Wallet UI/UX after recovery (wallet's responsibility)
- Asset migration (recovery changes ownership only)
- Cross-chain coordination (each chain independent)
- Guardian acceptance flow (social coordination is off-chain)

---

## 2. Terminology

| Term | Definition |
|------|------------|
| **Guardian** | A party that vouches for recovery, identified by an auth method |
| **Policy** | Configuration: guardians list, threshold (N-of-M), challenge period |
| **Threshold** | Minimum guardians (N) required out of total (M) |
| **Challenge Period** | Time after threshold is met during which owner can cancel |
| **Intent** | Typed message specifying recovery action with replay protection |
| **Session** | Single recovery attempt; only one active per wallet |
| **Commitment** | For zkJWT: `Poseidon(email, salt)` — hides email while allowing verification |

---

## 3. Architecture

### 3.1 Overview

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
        │   EOA    │   │ Passkey  │   │  ZkJWT   │
        │ecrecover │   │ Verifier │   │ Verifier │
        └──────────┘   └──────────┘   └──────────┘
```

### 3.2 Components

**On-Chain:**
- `RecoveryManager` — One per wallet. Stores policy, manages sessions, executes recovery.
- `RecoveryManagerFactory` — Singleton. Deploys RecoveryManager instances (minimal proxy pattern).
- `PasskeyVerifier` — Singleton. Verifies WebAuthn/P-256 signatures.
- `ZkJwtVerifier` — Singleton. Verifies Noir ZK proofs.

**Off-Chain (SDK):**
- `AuthManager` — Manages auth adapters, generates proofs
- `RecoveryManager` — Orchestrates recovery flow, interacts with contracts
- Auth Adapters — EOA, Passkey, zkJWT proof generation

### 3.3 Key Design Decisions

**Custom RecoveryManager (not Safe):**
- Purpose-built for recovery sessions, challenge periods, proof accumulation
- Simpler: Guardian → RecoveryManager → Wallet (no intermediate contracts)
- No guardian contracts needed; shared verifiers handle all auth methods
- Lower gas costs, no Safe dependency

**Factory with Minimal Proxies:**
- Gas efficient (~100k vs ~300k+ for full contract)
- Each wallet gets own RecoveryManager instance with isolated storage

---

## 4. Authentication Methods

### 4.1 Summary

| Method | Identifier | Proof | Privacy |
|--------|------------|-------|---------|
| EOA | Ethereum address | ECDSA signature (EIP-712) | Reveal on use |
| Passkey | `keccak256(pubKeyX \|\| pubKeyY)` | WebAuthn assertion | Reveal on use |
| zkJWT | `Poseidon(email, salt)` | Noir ZK proof | Full privacy |

### 4.2 EOA

- Guardian provides Ethereum address
- Proof: EIP-712 signature over RecoveryIntent
- Verification: `ecrecover`, check address matches

### 4.3 Passkey (WebAuthn / P-256)

- Guardian creates passkey; P-256 public key returned
- Identifier: hash of public key coordinates
- Proof: WebAuthn assertion (authenticatorData, clientDataJSON, signature, pubKey)
- Verification: Verifier hashes pubKey from proof, compares to stored identifier, then verifies P-256 signature (precompile where available, fallback otherwise)
- v1: Same-device setup only; cross-device deferred

### 4.4 zkJWT

- Wallet owner enters guardian's email + generates random salt
- Commitment: `Poseidon(email, salt)` — SNARK-friendly hash
- Owner shares salt with guardian out-of-band
- Proof: Noir ZK proof proving:
  - Valid JWT for some email (Google only in v1)
  - `Poseidon(email, salt) == commitment`
  - Authorizes the recovery intent
- Email never revealed, even during recovery

---

## 5. RecoveryManager Contract

### 5.1 State

- `wallet` — Address of wallet being protected
- `threshold` — N in N-of-M
- `challengePeriod` — Seconds after threshold before execution allowed
- `guardians[]` — Array of Guardian structs (type + identifier)
- `nonce` — Increments per session completion/cancellation
- `activeSession` — Current recovery session (if any)

### 5.2 Session Lifecycle

```
[No Session]
     │ startRecovery() with valid proof
     ▼
[Collecting Proofs]
     │ submitProof() accumulates approvals
     │ (when approvalCount >= threshold)
     ▼
[Challenge Period]
     │ Owner can cancelRecovery()
     │ (after challengePeriod elapsed)
     ▼
[Ready for Execution]
     │ executeRecovery()
     ▼
[No Session] (nonce++, new owner set)
```

### 5.3 Key Rules

- **One session at a time** per wallet
- **Challenge period starts when threshold is met**, not when session starts
- **Only guardians can initiate** recovery (prevents griefing)
- **Anyone can execute** after challenge period (typically last guardian or relayer)
- **Owner can cancel** during challenge period
- **Nonce prevents replay** — proofs bound to specific session

### 5.4 Policy Updates

Owner can update guardians, threshold, challenge period at any time:
- Takes effect immediately (no delay in v1)
- Increments nonce, invalidating any active session and existing proofs

---

## 6. Recovery Intent

Guardians sign/prove over this structure (EIP-712 typed data):

```
RecoveryIntent {
    wallet: address
    newOwner: address
    nonce: uint256
    deadline: uint256
    chainId: uint256
    recoveryManager: address
}
```

This binds proofs to:
- Specific wallet and recovery action
- Specific session (nonce)
- Specific chain and contract (prevents cross-chain/cross-contract replay)
- Time limit (deadline)

---

## 7. Recovery Flow

### 7.1 Setup

1. Owner chooses guardians:
   - EOA: collect Ethereum addresses
   - Passkey: guardian creates passkey, returns public key
   - zkJWT: owner enters email, generates salt, computes commitment, shares salt with guardian

2. Owner configures policy: threshold, challenge period

3. Deploy RecoveryManager via factory

4. Authorize RecoveryManager in wallet (wallet-specific mechanism)

### 7.2 Recovery

1. **Initiate**: Guardian calls `startRecovery(newOwner, deadline, guardianIndex, proof)`
   - Creates session, records first approval

2. **Collect Proofs**: Other guardians call `submitProof(guardianIndex, proof)`
   - Each verified proof recorded
   - When threshold met, challenge period starts

3. **Challenge Period**: Owner can `cancelRecovery()` if they regain access

4. **Execute**: After challenge period, anyone calls `executeRecovery()`
   - RecoveryManager sets newOwner as authorized in wallet

### 7.3 Post-Recovery

- `newOwner` is now authorized on wallet
- Old owner privilege NOT removed (wallet's choice)
- RecoveryManager privilege NOT removed (allows future recovery)
- User imports newOwner key into wallet UI (wallet's responsibility)

---

## 8. Wallet Integration

### 8.1 Requirements

For a wallet to integrate:

1. **Authorization mechanism**: Way to authorize RecoveryManager address to execute on wallet's behalf
2. **Ownership modification**: Function that RecoveryManager can call to set new owner

### 8.2 Integration Pattern

1. RecoveryManager is added to wallet's authorized addresses during setup
2. When recovery executes, RecoveryManager calls wallet's ownership function
3. Wallet-specific logic encapsulated in RecoveryManager (or via adapter pattern for multiple wallets)

### 8.3 Post-Recovery UX

SDK handles on-chain ownership change. Wallet UI must handle:
- Recognizing that a new key has authority on existing wallet
- Allowing user to access wallet with imported key
- Fallback: manual asset migration to new wallet

---

## 9. Security Model

### 9.1 Trust Assumptions

- **Guardians**: Trusted. N-of-M can recover wallet.
- **Contracts**: Must be audited. RecoveryManager has recovery control.
- **Verifiers**: Must be audited. Bugs could allow fake proofs.

### 9.2 Threat Mitigations

| Threat | Mitigation |
|--------|------------|
| Guardian collusion | Choose trusted guardians, appropriate threshold, challenge period |
| Single guardian compromise | Requires N guardians; single compromise insufficient |
| Replay attacks | Intent includes nonce, deadline, chainId, recoveryManager |
| Front-running | Proof bound to specific newOwner |
| Griefing (spam) | Only guardians can start recovery |

### 9.3 Challenge Period

Primary defense against unauthorized recovery:
- Owner monitors for `RecoveryStarted` events
- Owner calls `cancelRecovery()` during window
- Recommended: 1-7 days depending on wallet value (0 allowed for testing)

---

## 10. Privacy Model

| Method | At Rest | During Recovery |
|--------|---------|-----------------|
| EOA | Address on-chain | Address revealed (ecrecover) |
| Passkey | PubKey hash on-chain | PubKey revealed in proof |
| zkJWT | Commitment only | Email NOT revealed (ZK proof) |

**zkJWT Salt Management:**
- Generated by wallet owner during setup
- Shared with guardian out-of-band
- Guardian must store salt for recovery
- If salt leaked + email known, commitment can be verified (but not forged)

---

## 11. Data Structures

### Guardian

```
Guardian {
    guardianType: enum (EOA=0, Passkey=1, ZkJWT=2)
    identifier: bytes32
}
```

Identifier encoding:
- EOA: `bytes32(uint256(uint160(address)))`
- Passkey: `keccak256(pubKeyX || pubKeyY)`
- zkJWT: `Poseidon(email, salt)`

### RecoverySession

```
RecoverySession {
    intentHash: bytes32
    newOwner: address
    deadline: uint64
    thresholdMetAt: uint64  // 0 if not yet met
    approvalCount: uint8
    approvals: mapping(uint8 => bool)
}
```

---

## 12. Deployment

### Order

1. Deploy shared verifiers (PasskeyVerifier, ZkJwtVerifier)
2. Deploy RecoveryManager implementation
3. Deploy RecoveryManagerFactory (with impl + verifier addresses)
4. Per wallet: call factory to deploy RecoveryManager proxy

### Deterministic Addresses

Use CREATE2 for verifiers and factory for consistent addresses across chains.

---

*End of Specification*
