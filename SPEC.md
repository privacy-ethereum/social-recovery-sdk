# Social Recovery SDK v1 — Technical Specification

**Version:** 1.0.0-draft
**Date:** 2026-01-12
**Status:** Pre-Implementation

---

## Table of Contents

1. [Overview](#1-overview)
2. [Definitions & Terminology](#2-definitions--terminology)
3. [Architecture](#3-architecture)
4. [Authentication Methods](#4-authentication-methods)
5. [RecoveryManager Contract](#5-recoverymanager-contract)
6. [Verifier Contracts](#6-verifier-contracts)
7. [Recovery Flow](#7-recovery-flow)
8. [SDK (TypeScript)](#8-sdk-typescript)
9. [Wallet Integration](#9-wallet-integration)
10. [Security Model](#10-security-model)
11. [Privacy Model](#11-privacy-model)
12. [Data Structures](#12-data-structures)
13. [Contract Interfaces](#13-contract-interfaces)
14. [Events](#14-events)
15. [Error Handling](#15-error-handling)
16. [Deployment](#16-deployment)
17. [Future Considerations (Out of Scope for v1)](#17-future-considerations-out-of-scope-for-v1)

---

## 1. Overview

### 1.1 Purpose

The Social Recovery SDK provides a composable, standalone solution for adding social recovery to smart wallets. It enables wallet owners to designate guardians who can collectively restore access to a wallet if the owner loses their keys.

### 1.2 Design Goals

- **Easy Integration**: Drop-in SDK for existing wallets (Ambire, MetaMask, Rabby, etc.)
- **Minimal Centralization**: No centralized services required for core functionality
- **Good UX**: Similar to Web2 "forgot password" flows
- **Extensible Architecture**: Easy to add new authentication methods
- **Privacy**: Guardian identities protected where possible

### 1.3 What This SDK Does

- Allows wallet owners to configure guardians with different authentication methods
- Manages N-of-M threshold policies for recovery
- Handles the complete recovery lifecycle (initiate → prove → challenge → execute)
- Provides on-chain verification for guardian proofs
- Integrates with EIP-7702 and EIP-4337 compatible wallets

### 1.4 What This SDK Does NOT Do

- Does not handle wallet UI/UX after recovery (wallet's responsibility)
- Does not manage asset migration (recovery changes ownership, not assets)
- Does not provide cross-chain recovery coordination (each chain is independent)
- Does not enforce guardian acceptance (social coordination is off-chain)

---

## 2. Definitions & Terminology

| Term | Definition |
|------|------------|
| **Guardian** | A party that can vouch for account recovery. Identified by an authentication method (EOA, Passkey, zkJWT). |
| **Authentication Method** | A verifiable way a guardian proves their identity (EOA signature, Passkey/WebAuthn, zkJWT). |
| **Policy** | Configuration specifying guardians, threshold (N-of-M), and challenge period. |
| **Threshold** | Minimum number of guardians (N) required to approve recovery out of total guardians (M). |
| **Challenge Period** | Time window after threshold is met during which the wallet owner can cancel recovery. |
| **Intent** | A typed, hashable message specifying the recovery action (new owner address) with replay protection. |
| **Session** | A single recovery attempt, identified by intent parameters. Only one active session per wallet. |
| **Commitment** | For zkJWT: `keccak256(email \|\| salt)` — hides guardian's email while allowing verification. |
| **Verifier** | On-chain contract that validates guardian proofs for a specific authentication method. |
| **Wallet Adapter** | Logic for interacting with a specific wallet implementation (e.g., Ambire's privilege system). |

---

## 3. Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              WALLET                                     │
│                    (Ambire, MetaMask 7702, etc.)                        │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Authorized Addresses:                                            │  │
│  │    - Owner Key: 0xOwner (primary control)                         │  │
│  │    - RecoveryManager: 0xRecoveryManager (recovery control)        │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                        authorized to execute
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         RECOVERY MANAGER                                │
│                      (one instance per wallet)                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Policy:                                                          │  │
│  │    - wallet: address                                              │  │
│  │    - threshold: uint8                                             │  │
│  │    - challengePeriod: uint64                                      │  │
│  │    - guardians: Guardian[]                                        │  │
│  │    - nonce: uint256                                               │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Active Session (if any):                                         │  │
│  │    - intentHash, newOwner, deadline                               │  │
│  │    - approvals[], approvalCount                                   │  │
│  │    - thresholdMetAt (timestamp when challenge period started)     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  Functions:                                                             │
│    - startRecovery(newOwner, deadline, guardianIndex, proof)            │
│    - submitProof(guardianIndex, proof)                                  │
│    - cancelRecovery() [owner only]                                      │
│    - executeRecovery()                                                  │
│    - updatePolicy(...) [owner only]                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    delegates proof verification
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
             ┌───────────┐   ┌───────────┐   ┌───────────┐
             │    EOA    │   │  Passkey  │   │  ZkJWT    │
             │(ecrecover)│   │ Verifier  │   │ Verifier  │
             │ built-in  │   │  (P-256)  │   │  (Noir)   │
             └───────────┘   └───────────┘   └───────────┘
                                (shared)        (shared)
```

### 3.2 Component Overview

#### On-Chain Components

| Contract | Deployment | Purpose |
|----------|------------|---------|
| `RecoveryManager` | One per wallet (via factory) | Stores policy, manages sessions, executes recovery |
| `RecoveryManagerFactory` | Singleton | Deploys RecoveryManager instances using minimal proxy pattern |
| `PasskeyVerifier` | Singleton (shared) | Verifies WebAuthn/P-256 signatures |
| `ZkJwtVerifier` | Singleton (shared) | Verifies Noir ZK proofs for JWT authentication |

#### Off-Chain Components (SDK)

| Module | Purpose |
|--------|---------|
| `AuthManager` | Manages authentication adapters, generates proofs |
| `RecoveryManager` | Orchestrates recovery flow, interacts with contracts |
| `EOAAdapter` | Generates EIP-712 signatures for EOA guardians |
| `PasskeyAdapter` | Handles WebAuthn credential creation and signing |
| `ZkJwtAdapter` | Generates ZK proofs for JWT-based authentication |

### 3.3 Design Decisions

#### Why Custom RecoveryManager (Not Safe)

1. **Purpose-built primitives**: Recovery sessions, challenge periods, and proof accumulation are first-class concepts
2. **No intermediate layer**: Guardian → RecoveryManager → Wallet (simpler than Guardian → Guardian Contract → Safe → Wallet)
3. **No guardian contracts needed**: RecoveryManager verifies proofs directly via shared verifiers
4. **Lower deployment cost**: No Safe deployment overhead
5. **Independence**: No dependency on Safe's upgrade path or governance

#### Why No Guardian Contracts

1. **Simpler architecture**: RecoveryManager routes verification to shared verifiers
2. **Lower gas costs**: No per-guardian contract deployment
3. **Easier management**: Guardian data stored directly in RecoveryManager

#### Why Factory Pattern with Minimal Proxies

1. **Gas efficiency**: Minimal proxies (~100k gas vs ~300k+ for full contract)
2. **Consistent interface**: All RecoveryManager instances have same implementation
3. **Upgradeability path**: Can deploy new implementation, users migrate by deploying new proxy

---

## 4. Authentication Methods

### 4.1 Overview

v1 supports three authentication methods:

| Method | Guardian Identifier | Proof Type | Privacy |
|--------|---------------------|------------|---------|
| EOA | Ethereum address | ECDSA signature | Reveal on use |
| Passkey | P-256 public key (hash) | WebAuthn assertion | Reveal on use |
| zkJWT | Commitment: `keccak256(email \|\| salt)` | ZK proof | Full privacy |

### 4.2 EOA (Ethereum Account)

#### Guardian Setup
- Guardian provides their Ethereum address
- Address stored directly in RecoveryManager

#### Proof Generation
- Guardian signs EIP-712 typed `RecoveryIntent` with their private key
- Signature is the proof

#### Verification
- `ecrecover` on intent hash and signature
- Verify recovered address matches stored guardian address

#### Storage
```solidity
Guardian {
    guardianType: GuardianType.EOA,
    identifier: bytes32(uint256(uint160(guardianAddress)))
}
```

### 4.3 Passkey (WebAuthn / P-256)

#### Guardian Setup
1. Guardian creates a passkey (same device flow for v1)
2. Browser returns P-256 public key (64 bytes: x, y coordinates)
3. Public key hash stored: `keccak256(abi.encodePacked(pubKeyX, pubKeyY))`

#### Proof Generation
1. SDK constructs WebAuthn challenge from intent hash
2. Guardian authenticates (biometric, PIN, etc.)
3. Authenticator returns: `authenticatorData`, `clientDataJSON`, `signature`
4. Proof bundle: `(pubKeyX, pubKeyY, authenticatorData, clientDataJSON, signature)`

#### Verification (PasskeyVerifier)
1. Verify `keccak256(pubKeyX, pubKeyY)` matches stored identifier
2. Parse `clientDataJSON`, extract challenge, verify it matches intent hash
3. Construct signed data: `authenticatorData || sha256(clientDataJSON)`
4. Verify P-256 signature over signed data using public key

#### Storage
```solidity
Guardian {
    guardianType: GuardianType.Passkey,
    identifier: keccak256(abi.encodePacked(pubKeyX, pubKeyY))
}
```

#### Notes
- P-256 verification uses precompile where available (EIP-7212), otherwise fallback verifier
- WebAuthn signature format includes additional metadata that must be parsed
- Same-device setup only for v1; cross-device via QR deferred

### 4.4 zkJWT (Zero-Knowledge JWT)

#### Guardian Setup
1. Wallet owner enters guardian's email (e.g., `alice@gmail.com`)
2. Wallet owner generates random salt (or derives deterministically)
3. Commitment computed: `keccak256(abi.encodePacked(email, salt))`
4. Commitment stored in RecoveryManager
5. Wallet owner shares salt with guardian out-of-band

#### Proof Generation
1. Guardian authenticates with identity provider (Google) to obtain JWT
2. Guardian uses Noir circuit to generate ZK proof proving:
   - They possess a valid JWT for some email
   - `keccak256(email || salt) == commitment` (public input)
   - They authorize the recovery intent (intent hash as public input)
3. Email is never revealed; only commitment and intent hash are public

#### Verification (ZkJwtVerifier)
1. Verify Noir proof with public inputs: `(commitment, intentHash)`
2. Verify commitment matches stored guardian identifier
3. Proof is valid if Noir verifier returns true

#### Storage
```solidity
Guardian {
    guardianType: GuardianType.ZkJWT,
    identifier: commitment  // keccak256(email || salt)
}
```

#### Notes
- v1 supports Google JWT only
- Noir circuits and verifier treated as black box
- Salt management is guardian's responsibility (shared by wallet owner)
- No guardian acceptance flow; wallet owner takes responsibility for informing guardian

---

## 5. RecoveryManager Contract

### 5.1 Responsibilities

1. Store recovery policy (guardians, threshold, challenge period)
2. Manage recovery sessions (one active session at a time)
3. Verify guardian proofs (delegate to verifiers)
4. Enforce threshold and challenge period rules
5. Execute recovery action on wallet

### 5.2 State

```solidity
// Policy (set by wallet owner)
address public wallet;
uint8 public threshold;
uint64 public challengePeriod;
Guardian[] public guardians;
uint256 public nonce;

// Verifier addresses (immutable, set at deployment)
address public passkeyVerifier;
address public zkJwtVerifier;

// Active session (only one at a time)
RecoverySession public activeSession;
```

### 5.3 Session Lifecycle

```
[No Session]
     │
     │ startRecovery() with valid guardian proof
     ▼
[Session Active, Collecting Proofs]
     │
     ├─── submitProof() ───► accumulate approvals
     │
     │ (when approvalCount >= threshold)
     ▼
[Threshold Met, Challenge Period Active]
     │
     ├─── cancelRecovery() by owner ───► [No Session] (nonce++)
     │
     │ (after challengePeriod elapsed)
     ▼
[Ready for Execution]
     │
     │ executeRecovery()
     ▼
[No Session] (nonce++, new owner set)
```

### 5.4 Session States

| State | Condition |
|-------|-----------|
| No Session | `activeSession.intentHash == bytes32(0)` |
| Collecting Proofs | Session exists, `approvalCount < threshold` |
| Challenge Period | `approvalCount >= threshold`, `block.timestamp < thresholdMetAt + challengePeriod` |
| Ready for Execution | `approvalCount >= threshold`, `block.timestamp >= thresholdMetAt + challengePeriod`, `block.timestamp <= deadline` |
| Expired | `block.timestamp > deadline` |

### 5.5 Nonce Management

- Nonce is per-wallet, stored in RecoveryManager
- Increments when:
  - Recovery is successfully executed
  - Recovery is cancelled by owner
  - Session expires and new session starts (implicit cancellation)
- Prevents replay of proofs from previous sessions

### 5.6 Policy Updates

Owner can update policy at any time:
- Add/remove guardians
- Change threshold
- Change challenge period

Policy updates:
- Take effect immediately (no delay in v1)
- Invalidate any active session (nonce increments)
- Require owner authorization (only wallet owner can call)

---

## 6. Verifier Contracts

### 6.1 PasskeyVerifier

Singleton contract for WebAuthn/P-256 signature verification.

#### Interface
```solidity
function verify(
    bytes32 intentHash,
    bytes32 pubKeyHash,
    bytes calldata proof  // (pubKeyX, pubKeyY, authenticatorData, clientDataJSON, signature)
) external view returns (bool);
```

#### Verification Steps
1. Decode proof into components
2. Verify `keccak256(pubKeyX, pubKeyY) == pubKeyHash`
3. Parse `clientDataJSON`, extract `challenge` field
4. Verify `challenge == base64url(intentHash)`
5. Construct message: `authenticatorData || sha256(clientDataJSON)`
6. Verify P-256 signature over message using (pubKeyX, pubKeyY)

#### P-256 Verification
- Use RIP-7212 precompile at `0x0000...0100` if available
- Fallback to pure Solidity implementation or external verifier

### 6.2 ZkJwtVerifier

Singleton contract for Noir ZK proof verification.

#### Interface
```solidity
function verify(
    bytes32 intentHash,
    bytes32 commitment,
    bytes calldata proof  // Noir proof bytes
) external view returns (bool);
```

#### Verification Steps
1. Construct public inputs array: `[commitment, intentHash]`
2. Call Noir verifier with proof and public inputs
3. Return verifier result

#### Notes
- Noir verifier contract is deployed separately (generated from circuit)
- ZkJwtVerifier is a thin wrapper that formats inputs correctly
- Circuit proves: valid JWT + email hashes to commitment + authorizes intent

---

## 7. Recovery Flow

### 7.1 Setup Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           SETUP PHASE                                   │
└─────────────────────────────────────────────────────────────────────────┘

1. Wallet Owner decides on guardians:
   ┌─────────────────────────────────────────────────────────────────────┐
   │ Guardian 1: Alice (EOA)                                            │
   │   → identifier: 0xAlice...                                         │
   │                                                                     │
   │ Guardian 2: Bob (Passkey)                                          │
   │   → Bob creates passkey, returns pubKey                            │
   │   → identifier: keccak256(pubKey)                                  │
   │                                                                     │
   │ Guardian 3: Carol (zkJWT)                                          │
   │   → email: carol@gmail.com                                         │
   │   → salt: 0x1234... (generated randomly)                           │
   │   → identifier: keccak256(email || salt)                           │
   │   → Owner shares salt with Carol out-of-band                       │
   └─────────────────────────────────────────────────────────────────────┘

2. Owner configures policy:
   ┌─────────────────────────────────────────────────────────────────────┐
   │ threshold: 2                                                       │
   │ challengePeriod: 3 days (259200 seconds)                           │
   │ guardians: [Guardian1, Guardian2, Guardian3]                       │
   └─────────────────────────────────────────────────────────────────────┘

3. Deploy RecoveryManager:
   ┌─────────────────────────────────────────────────────────────────────┐
   │ factory.deploy(                                                    │
   │     wallet: 0xMyWallet,                                            │
   │     threshold: 2,                                                  │
   │     challengePeriod: 259200,                                       │
   │     guardians: [...],                                              │
   │     passkeyVerifier: 0xPasskeyVerifier,                            │
   │     zkJwtVerifier: 0xZkJwtVerifier                                 │
   │ )                                                                  │
   │ → returns: 0xRecoveryManager                                       │
   └─────────────────────────────────────────────────────────────────────┘

4. Authorize RecoveryManager in wallet:
   ┌─────────────────────────────────────────────────────────────────────┐
   │ // For Ambire:                                                     │
   │ wallet.setAddrPrivilege(0xRecoveryManager, bytes32(uint256(1)))    │
   └─────────────────────────────────────────────────────────────────────┘
```

### 7.2 Recovery Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          RECOVERY PHASE                                 │
└─────────────────────────────────────────────────────────────────────────┘

1. User loses access to wallet, contacts guardians

2. Guardian 1 (Alice, EOA) initiates recovery:
   ┌─────────────────────────────────────────────────────────────────────┐
   │ // Build intent                                                    │
   │ intent = {                                                         │
   │     wallet: 0xMyWallet,                                            │
   │     newOwner: 0xNewKey,                                            │
   │     nonce: 0,                                                      │
   │     deadline: block.timestamp + 7 days,                            │
   │     chainId: 1,                                                    │
   │     recoveryManager: 0xRecoveryManager                             │
   │ }                                                                  │
   │                                                                     │
   │ // Alice signs intent (EIP-712)                                    │
   │ signature = alice.signTypedData(intent)                            │
   │                                                                     │
   │ // Submit to contract                                              │
   │ recoveryManager.startRecovery(                                     │
   │     newOwner: 0xNewKey,                                            │
   │     deadline: intent.deadline,                                     │
   │     guardianIndex: 0,                                              │
   │     proof: signature                                               │
   │ )                                                                  │
   └─────────────────────────────────────────────────────────────────────┘

   → Session created
   → Alice's approval recorded (1/2)
   → Event: RecoveryStarted(intentHash, wallet, newOwner, deadline)
   → Event: ProofSubmitted(intentHash, guardianIndex: 0)

3. Guardian 3 (Carol, zkJWT) submits proof:
   ┌─────────────────────────────────────────────────────────────────────┐
   │ // Carol authenticates with Google, gets JWT                       │
   │ // Carol generates ZK proof using Noir circuit                     │
   │ zkProof = generateZkProof(jwt, email, salt, intentHash)            │
   │                                                                     │
   │ // Submit to contract                                              │
   │ recoveryManager.submitProof(                                       │
   │     guardianIndex: 2,                                              │
   │     proof: zkProof                                                 │
   │ )                                                                  │
   └─────────────────────────────────────────────────────────────────────┘

   → Carol's approval recorded (2/2)
   → Threshold met!
   → Challenge period starts (thresholdMetAt = block.timestamp)
   → Event: ProofSubmitted(intentHash, guardianIndex: 2)
   → Event: ThresholdMet(intentHash, thresholdMetAt)

4. Challenge Period (3 days):
   ┌─────────────────────────────────────────────────────────────────────┐
   │ During this window:                                                │
   │   - Owner can call cancelRecovery() if they regain access          │
   │   - UI displays countdown                                          │
   │   - If cancelled: session cleared, nonce incremented               │
   └─────────────────────────────────────────────────────────────────────┘

5. After challenge period, execute recovery:
   ┌─────────────────────────────────────────────────────────────────────┐
   │ // Anyone can call (typically last guardian or relayer)            │
   │ recoveryManager.executeRecovery()                                  │
   │                                                                     │
   │ // RecoveryManager executes on wallet (Ambire-specific):           │
   │ // wallet.executeBySender([                                        │
   │ //     Transaction({                                               │
   │ //         to: wallet,                                             │
   │ //         value: 0,                                               │
   │ //         data: setAddrPrivilege(newOwner, 1)                     │
   │ //     })                                                          │
   │ // ])                                                              │
   └─────────────────────────────────────────────────────────────────────┘

   → New owner set in wallet
   → Session cleared, nonce incremented
   → Event: RecoveryExecuted(intentHash, newOwner)

6. Post-recovery:
   ┌─────────────────────────────────────────────────────────────────────┐
   │ - newOwner (0xNewKey) now has privilege on wallet                  │
   │ - Old owner privilege NOT removed (wallet's responsibility)        │
   │ - RecoveryManager privilege NOT removed (allows future recovery)   │
   │ - User imports newOwner key into wallet UI to regain access        │
   └─────────────────────────────────────────────────────────────────────┘
```

### 7.3 Cancellation Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CANCELLATION FLOW                               │
└─────────────────────────────────────────────────────────────────────────┘

Scenario: Owner regains access during challenge period

1. Owner detects unauthorized recovery attempt (via events, UI notification)

2. Owner calls cancel:
   ┌─────────────────────────────────────────────────────────────────────┐
   │ // Must be called by wallet (owner)                                │
   │ // RecoveryManager checks msg.sender == wallet                     │
   │ recoveryManager.cancelRecovery()                                   │
   └─────────────────────────────────────────────────────────────────────┘

   → Session cleared
   → Nonce incremented (invalidates all existing proofs)
   → Event: RecoveryCancelled(intentHash)

3. Owner should consider:
   - Rotating compromised guardian(s)
   - Increasing threshold
   - Increasing challenge period
```

---

## 8. SDK (TypeScript)

### 8.1 Module Structure

```
social-recovery-sdk/
├── src/
│   ├── auth/
│   │   ├── AuthManager.ts
│   │   ├── adapters/
│   │   │   ├── EOAAdapter.ts
│   │   │   ├── PasskeyAdapter.ts
│   │   │   └── ZkJwtAdapter.ts
│   │   └── types.ts
│   ├── recovery/
│   │   ├── RecoveryManager.ts
│   │   ├── PolicyBuilder.ts
│   │   ├── IntentBuilder.ts
│   │   └── types.ts
│   ├── contracts/
│   │   ├── abis/
│   │   └── addresses.ts
│   └── index.ts
├── contracts/
│   ├── RecoveryManager.sol
│   ├── RecoveryManagerFactory.sol
│   ├── verifiers/
│   │   ├── PasskeyVerifier.sol
│   │   └── ZkJwtVerifier.sol
│   └── interfaces/
└── package.json
```

### 8.2 AuthManager API

```typescript
interface IAuthAdapter {
  readonly methodType: GuardianType;

  // Generate identifier for storage (address, pubkey hash, or commitment)
  deriveIdentifier(params: IdentifierParams): Promise<bytes32>;

  // Generate proof for a recovery intent
  generateProof(intent: RecoveryIntent, params: ProofParams): Promise<bytes>;
}

class AuthManager {
  private adapters: Map<GuardianType, IAuthAdapter>;

  constructor() {
    this.adapters = new Map([
      [GuardianType.EOA, new EOAAdapter()],
      [GuardianType.Passkey, new PasskeyAdapter()],
      [GuardianType.ZkJWT, new ZkJwtAdapter()],
    ]);
  }

  getAdapter(type: GuardianType): IAuthAdapter;

  // Convenience methods
  async deriveEOAIdentifier(address: Address): Promise<bytes32>;
  async derivePasskeyIdentifier(): Promise<{ identifier: bytes32, pubKey: bytes }>;
  async deriveZkJwtIdentifier(email: string, salt: bytes32): Promise<bytes32>;
}
```

### 8.3 EOAAdapter

```typescript
class EOAAdapter implements IAuthAdapter {
  readonly methodType = GuardianType.EOA;

  async deriveIdentifier(params: { address: Address }): Promise<bytes32> {
    // Simply pad address to bytes32
    return padAddress(params.address);
  }

  async generateProof(
    intent: RecoveryIntent,
    params: { signer: Signer }
  ): Promise<bytes> {
    // Sign EIP-712 typed data
    const signature = await params.signer.signTypedData(
      buildDomain(intent.recoveryManager, intent.chainId),
      RECOVERY_INTENT_TYPES,
      intent
    );
    return signature;
  }
}
```

### 8.4 PasskeyAdapter

```typescript
class PasskeyAdapter implements IAuthAdapter {
  readonly methodType = GuardianType.Passkey;

  async deriveIdentifier(params?: {}): Promise<{
    identifier: bytes32,
    pubKey: { x: bytes32, y: bytes32 }
  }> {
    // Create WebAuthn credential
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: "Social Recovery", id: window.location.hostname },
        user: { id: randomBytes(16), name: "guardian", displayName: "Guardian" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256 (P-256)
        authenticatorSelection: { userVerification: "required" },
      }
    });

    const pubKey = extractPublicKey(credential);
    const identifier = keccak256(encodePacked(pubKey.x, pubKey.y));

    return { identifier, pubKey };
  }

  async generateProof(
    intent: RecoveryIntent,
    params: { credentialId: bytes, pubKey: { x: bytes32, y: bytes32 } }
  ): Promise<bytes> {
    const intentHash = hashIntent(intent);

    // Get WebAuthn assertion
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: intentHash,
        allowCredentials: [{ type: "public-key", id: params.credentialId }],
        userVerification: "required",
      }
    });

    return encodePasskeyProof(
      params.pubKey,
      assertion.response.authenticatorData,
      assertion.response.clientDataJSON,
      assertion.response.signature
    );
  }
}
```

### 8.5 ZkJwtAdapter

```typescript
class ZkJwtAdapter implements IAuthAdapter {
  readonly methodType = GuardianType.ZkJWT;

  async deriveIdentifier(params: { email: string, salt: bytes32 }): Promise<bytes32> {
    return keccak256(encodePacked(params.email, params.salt));
  }

  async generateProof(
    intent: RecoveryIntent,
    params: { jwt: string, email: string, salt: bytes32 }
  ): Promise<bytes> {
    const intentHash = hashIntent(intent);
    const commitment = await this.deriveIdentifier({ email: params.email, salt: params.salt });

    // Generate Noir proof (implementation depends on Noir SDK)
    const proof = await generateNoirProof({
      jwt: params.jwt,
      email: params.email,
      salt: params.salt,
      intentHash,
      commitment,
    });

    return proof;
  }
}
```

### 8.6 RecoveryManager (SDK)

```typescript
class RecoveryManager {
  private provider: Provider;
  private authManager: AuthManager;

  constructor(provider: Provider, authManager?: AuthManager) {
    this.provider = provider;
    this.authManager = authManager ?? new AuthManager();
  }

  // ─────────────────────────────────────────────────────────────────────
  // Policy Management
  // ─────────────────────────────────────────────────────────────────────

  async deployRecoveryManager(params: {
    wallet: Address,
    threshold: number,
    challengePeriod: number,
    guardians: Guardian[],
  }): Promise<Address> {
    const factory = RecoveryManagerFactory__factory.connect(FACTORY_ADDRESS, this.provider);
    const tx = await factory.deploy(
      params.wallet,
      params.threshold,
      params.challengePeriod,
      params.guardians,
      PASSKEY_VERIFIER_ADDRESS,
      ZKJWT_VERIFIER_ADDRESS
    );
    const receipt = await tx.wait();
    return extractDeployedAddress(receipt);
  }

  async getPolicy(recoveryManager: Address): Promise<Policy> {
    const contract = RecoveryManager__factory.connect(recoveryManager, this.provider);
    return {
      wallet: await contract.wallet(),
      threshold: await contract.threshold(),
      challengePeriod: await contract.challengePeriod(),
      guardians: await contract.getGuardians(),
      nonce: await contract.nonce(),
    };
  }

  async updatePolicy(
    recoveryManager: Address,
    updates: Partial<PolicyUpdates>,
    signer: Signer
  ): Promise<TransactionReceipt>;

  // ─────────────────────────────────────────────────────────────────────
  // Recovery Flow
  // ─────────────────────────────────────────────────────────────────────

  buildIntent(params: {
    wallet: Address,
    newOwner: Address,
    recoveryManager: Address,
    nonce: bigint,
    deadline?: number,  // defaults to 7 days from now
    chainId?: number,   // defaults to connected chain
  }): RecoveryIntent {
    return {
      wallet: params.wallet,
      newOwner: params.newOwner,
      nonce: params.nonce,
      deadline: params.deadline ?? Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      chainId: params.chainId ?? this.provider.network.chainId,
      recoveryManager: params.recoveryManager,
    };
  }

  async startRecovery(params: {
    recoveryManager: Address,
    newOwner: Address,
    deadline: number,
    guardianIndex: number,
    proof: bytes,
    signer: Signer,
  }): Promise<{ intentHash: bytes32, txReceipt: TransactionReceipt }>;

  async submitProof(params: {
    recoveryManager: Address,
    guardianIndex: number,
    proof: bytes,
    signer: Signer,
  }): Promise<TransactionReceipt>;

  async cancelRecovery(params: {
    recoveryManager: Address,
    walletSigner: Signer,  // must be wallet owner
  }): Promise<TransactionReceipt>;

  async executeRecovery(params: {
    recoveryManager: Address,
    signer: Signer,
  }): Promise<TransactionReceipt>;

  // ─────────────────────────────────────────────────────────────────────
  // Session Queries
  // ─────────────────────────────────────────────────────────────────────

  async getActiveSession(recoveryManager: Address): Promise<RecoverySession | null>;
  async getSessionStatus(recoveryManager: Address): Promise<SessionStatus>;
  async canExecute(recoveryManager: Address): Promise<boolean>;
  async getChallengeTimeRemaining(recoveryManager: Address): Promise<number>;  // seconds
}
```

### 8.7 Type Definitions

```typescript
enum GuardianType {
  EOA = 0,
  Passkey = 1,
  ZkJWT = 2,
}

interface Guardian {
  guardianType: GuardianType;
  identifier: bytes32;
}

interface RecoveryIntent {
  wallet: Address;
  newOwner: Address;
  nonce: bigint;
  deadline: number;
  chainId: number;
  recoveryManager: Address;
}

interface RecoverySession {
  intentHash: bytes32;
  newOwner: Address;
  deadline: number;
  approvalCount: number;
  approvals: boolean[];  // indexed by guardian index
  thresholdMetAt: number;  // 0 if threshold not yet met
}

enum SessionStatus {
  NoSession,
  CollectingProofs,
  ChallengePeriod,
  ReadyForExecution,
  Expired,
}

interface Policy {
  wallet: Address;
  threshold: number;
  challengePeriod: number;
  guardians: Guardian[];
  nonce: bigint;
}
```

---

## 9. Wallet Integration

### 9.1 Integration Requirements

For a wallet to integrate with the Social Recovery SDK, it must:

1. **Support authorization of external addresses**: The wallet must have a mechanism to authorize the RecoveryManager contract address to execute transactions on its behalf.

2. **Expose ownership modification**: The wallet must have a function that RecoveryManager can call to set a new owner.

### 9.2 Ambire Integration (v1)

Ambire uses a privilege-based system where any address with non-zero privilege can execute transactions.

#### Setup
```solidity
// Wallet owner authorizes RecoveryManager
wallet.setAddrPrivilege(recoveryManager, bytes32(uint256(1)));
```

#### Recovery Execution
```solidity
// RecoveryManager executes via Ambire's executeBySender
function executeRecovery() external {
    // ... validation ...

    Transaction[] memory txns = new Transaction[](1);
    txns[0] = Transaction({
        to: wallet,
        value: 0,
        data: abi.encodeCall(IAmbireAccount.setAddrPrivilege, (newOwner, bytes32(uint256(1))))
    });

    IAmbireAccount(wallet).executeBySender(txns);
}
```

### 9.3 Generic Wallet Integration (Future)

For wallets with different architectures, the integration pattern is:

1. **Identify authorization mechanism**: How does wallet authorize external actors?
2. **Identify ownership function**: What function changes the owner?
3. **Implement wallet-specific execution**: Modify `executeRecovery` or use a wallet adapter pattern

Potential future approach — wallet adapter interface:
```solidity
interface IWalletAdapter {
    function executeRecovery(address wallet, address newOwner) external;
}

// RecoveryManager calls adapter instead of wallet directly
function executeRecovery() external {
    // ... validation ...
    IWalletAdapter(walletAdapter).executeRecovery(wallet, session.newOwner);
}
```

### 9.4 Post-Recovery UX

After recovery executes:

1. **New owner has privilege**: The `newOwner` address can now authorize transactions
2. **Old owner not removed**: RecoveryManager does not revoke old owner (wallet's choice)
3. **RecoveryManager retained**: Allows future recovery attempts
4. **Wallet UI responsibility**: User must import `newOwner` key into wallet UI

The SDK does not handle wallet UI. Wallet implementations must support:
- Importing a key that has privilege on an existing wallet
- Or: manual asset migration to a new wallet as fallback

---

## 10. Security Model

### 10.1 Trust Assumptions

| Entity | Trust Level | Notes |
|--------|-------------|-------|
| Guardians | Trusted | N-of-M guardians can recover wallet. Choose carefully. |
| RecoveryManager Contract | Verified | Must be audited. Has full control during recovery. |
| Verifier Contracts | Verified | Must be audited. Bugs could allow fake proofs. |
| Wallet | Trusted | RecoveryManager is authorized; wallet must be secure. |
| SDK | Verified | Generates proofs; bugs could create invalid proofs. |

### 10.2 Threat Model

#### Malicious Guardian Collusion
- **Threat**: N guardians collude to recover wallet to attacker's address
- **Mitigation**: Choose trusted guardians, set appropriate threshold, challenge period allows owner to react

#### Single Guardian Compromise
- **Threat**: Attacker compromises one guardian's key/credentials
- **Mitigation**: Requires N guardians; single compromise insufficient

#### Replay Attacks
- **Threat**: Reuse proof from previous recovery attempt
- **Mitigation**: Intent includes nonce (increments per session), deadline, chainId, recoveryManager address

#### Front-Running
- **Threat**: Attacker sees proof in mempool, front-runs with different newOwner
- **Mitigation**: Proof is bound to specific newOwner in intent; cannot be reused

#### Griefing (Spam Recovery)
- **Threat**: Attacker spams `startRecovery` to annoy owner
- **Mitigation**: Only guardians with valid proofs can start recovery

#### RecoveryManager Compromise
- **Threat**: Bug in RecoveryManager allows unauthorized recovery
- **Mitigation**: Thorough auditing, formal verification if possible

#### Verifier Bugs
- **Threat**: Verifier accepts invalid proofs
- **Mitigation**: Use well-tested implementations, audit thoroughly

### 10.3 Challenge Period Security

The challenge period is the primary defense against unauthorized recovery:

1. **Detection**: Owner/UI monitors for `RecoveryStarted` events
2. **Reaction**: Owner calls `cancelRecovery()` during challenge window
3. **Remediation**: Owner rotates compromised guardians, adjusts policy

Recommended minimum challenge periods:
- High-value wallets: 3-7 days
- Standard wallets: 1-3 days
- Low-value/test wallets: Can be 0 (instant recovery)

### 10.4 Proof Security

#### EOA Proofs
- Standard ECDSA security
- Compromised private key = compromised guardian

#### Passkey Proofs
- WebAuthn security model (phishing-resistant)
- Tied to device/authenticator
- Requires user gesture (biometric, PIN)

#### zkJWT Proofs
- OAuth security model for JWT
- ZK proof security for circuit
- Salt secrecy required (if salt leaked + email known, commitment can be computed)

---

## 11. Privacy Model

### 11.1 Privacy Goals

| Phase | EOA | Passkey | zkJWT |
|-------|-----|---------|-------|
| At Rest (before recovery) | Address stored on-chain | PubKey hash stored | Commitment stored (email hidden) |
| During Recovery | Address revealed (ecrecover) | PubKey revealed (in proof) | Email NOT revealed (ZK proof) |
| After Recovery | Address visible in history | PubKey visible in history | Only commitment visible |

### 11.2 EOA Privacy

- **At rest**: Guardian's Ethereum address stored directly in contract
- **On use**: Address revealed via signature
- **Privacy level**: Low (address is public identifier anyway)

### 11.3 Passkey Privacy

- **At rest**: Public key hash stored; actual public key not on-chain
- **On use**: Full public key submitted with proof, revealed in transaction
- **Privacy level**: Medium (public key revealed on use, but not meaningful without context)

### 11.4 zkJWT Privacy

- **At rest**: Only commitment stored: `keccak256(email || salt)`
- **On use**: ZK proof reveals nothing; email stays hidden
- **Privacy level**: High (email never revealed, even during recovery)

#### Salt Management
- Salt generated by wallet owner during setup
- Shared with guardian out-of-band (secure messaging, in-person, etc.)
- Guardian must store/remember salt for recovery
- If salt is leaked AND email is known, commitment can be verified (but not forged)

### 11.5 Privacy Recommendations

1. **For sensitive guardians**: Use zkJWT (email hidden)
2. **For convenience**: Use EOA or Passkey (simpler setup)
3. **Salt storage**: Guardian should store salt securely; can be derived from a master secret for easier management

---

## 12. Data Structures

### 12.1 Solidity Structures

```solidity
// ─────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────

enum GuardianType {
    EOA,      // 0
    Passkey,  // 1
    ZkJWT     // 2
}

// ─────────────────────────────────────────────────────────────────────
// Guardian
// ─────────────────────────────────────────────────────────────────────

struct Guardian {
    GuardianType guardianType;
    bytes32 identifier;
    // For EOA: bytes32(uint256(uint160(address)))
    // For Passkey: keccak256(pubKeyX || pubKeyY)
    // For ZkJWT: keccak256(email || salt)
}

// ─────────────────────────────────────────────────────────────────────
// Recovery Session
// ─────────────────────────────────────────────────────────────────────

struct RecoverySession {
    bytes32 intentHash;      // EIP-712 hash of RecoveryIntent
    address newOwner;        // Target new owner address
    uint64 deadline;         // Timestamp after which session expires
    uint64 thresholdMetAt;   // Timestamp when threshold was met (0 if not met)
    uint8 approvalCount;     // Number of guardians who approved
    // approvals stored separately: mapping(uint8 => bool)
}

// ─────────────────────────────────────────────────────────────────────
// Recovery Intent (for EIP-712 signing)
// ─────────────────────────────────────────────────────────────────────

struct RecoveryIntent {
    address wallet;
    address newOwner;
    uint256 nonce;
    uint256 deadline;
    uint256 chainId;
    address recoveryManager;
}

// EIP-712 TypeHash
bytes32 constant RECOVERY_INTENT_TYPEHASH = keccak256(
    "RecoveryIntent(address wallet,address newOwner,uint256 nonce,uint256 deadline,uint256 chainId,address recoveryManager)"
);
```

### 12.2 EIP-712 Domain

```solidity
bytes32 constant DOMAIN_TYPEHASH = keccak256(
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
);

function buildDomainSeparator(address recoveryManager, uint256 chainId) pure returns (bytes32) {
    return keccak256(abi.encode(
        DOMAIN_TYPEHASH,
        keccak256("SocialRecovery"),
        keccak256("1"),
        chainId,
        recoveryManager
    ));
}
```

### 12.3 Proof Formats

#### EOA Proof
```
bytes proof = abi.encodePacked(r, s, v)  // 65 bytes ECDSA signature
```

#### Passkey Proof
```
bytes proof = abi.encode(
    bytes32 pubKeyX,           // P-256 public key X coordinate
    bytes32 pubKeyY,           // P-256 public key Y coordinate
    bytes authenticatorData,   // WebAuthn authenticator data
    bytes clientDataJSON,      // WebAuthn client data JSON
    bytes signature            // P-256 signature (r, s)
)
```

#### zkJWT Proof
```
bytes proof = <noir_proof_bytes>  // Noir proof format (opaque to SDK)
```

---

## 13. Contract Interfaces

### 13.1 IRecoveryManager

```solidity
interface IRecoveryManager {
    // ─────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────

    event RecoveryStarted(
        bytes32 indexed intentHash,
        address indexed wallet,
        address newOwner,
        uint256 deadline
    );

    event ProofSubmitted(
        bytes32 indexed intentHash,
        uint8 indexed guardianIndex
    );

    event ThresholdMet(
        bytes32 indexed intentHash,
        uint256 thresholdMetAt
    );

    event RecoveryCancelled(bytes32 indexed intentHash);

    event RecoveryExecuted(
        bytes32 indexed intentHash,
        address indexed newOwner
    );

    event PolicyUpdated(
        uint8 newThreshold,
        uint64 newChallengePeriod,
        uint256 guardianCount
    );

    // ─────────────────────────────────────────────────────────────────
    // Recovery Functions
    // ─────────────────────────────────────────────────────────────────

    /// @notice Start a new recovery session with the first guardian proof
    /// @param newOwner Address to become the new wallet owner
    /// @param deadline Timestamp after which the session expires
    /// @param guardianIndex Index of the guardian providing the first proof
    /// @param proof Guardian's proof (signature, WebAuthn assertion, or ZK proof)
    function startRecovery(
        address newOwner,
        uint64 deadline,
        uint8 guardianIndex,
        bytes calldata proof
    ) external;

    /// @notice Submit a guardian proof for the active recovery session
    /// @param guardianIndex Index of the guardian providing the proof
    /// @param proof Guardian's proof
    function submitProof(uint8 guardianIndex, bytes calldata proof) external;

    /// @notice Cancel the active recovery session (wallet owner only)
    function cancelRecovery() external;

    /// @notice Execute recovery after threshold met and challenge period passed
    function executeRecovery() external;

    // ─────────────────────────────────────────────────────────────────
    // Policy Management (wallet owner only)
    // ─────────────────────────────────────────────────────────────────

    /// @notice Update the recovery policy
    /// @param newThreshold New threshold (N in N-of-M)
    /// @param newChallengePeriod New challenge period in seconds
    /// @param newGuardians New guardian array
    function updatePolicy(
        uint8 newThreshold,
        uint64 newChallengePeriod,
        Guardian[] calldata newGuardians
    ) external;

    /// @notice Add a guardian
    function addGuardian(Guardian calldata guardian) external;

    /// @notice Remove a guardian by index
    function removeGuardian(uint8 guardianIndex) external;

    // ─────────────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────────────

    function wallet() external view returns (address);
    function threshold() external view returns (uint8);
    function challengePeriod() external view returns (uint64);
    function nonce() external view returns (uint256);
    function getGuardians() external view returns (Guardian[] memory);
    function getGuardian(uint8 index) external view returns (Guardian memory);
    function guardianCount() external view returns (uint8);

    function getActiveSession() external view returns (RecoverySession memory);
    function hasActiveSession() external view returns (bool);
    function isGuardianApproved(uint8 guardianIndex) external view returns (bool);
    function canExecute() external view returns (bool);
    function getSessionStatus() external view returns (SessionStatus);
}

enum SessionStatus {
    NoSession,
    CollectingProofs,
    ChallengePeriod,
    ReadyForExecution,
    Expired
}
```

### 13.2 IRecoveryManagerFactory

```solidity
interface IRecoveryManagerFactory {
    event RecoveryManagerDeployed(
        address indexed recoveryManager,
        address indexed wallet
    );

    /// @notice Deploy a new RecoveryManager for a wallet
    /// @param wallet The wallet address this RecoveryManager will protect
    /// @param threshold Initial threshold (N in N-of-M)
    /// @param challengePeriod Initial challenge period in seconds
    /// @param guardians Initial guardian array
    /// @return recoveryManager Address of deployed RecoveryManager
    function deploy(
        address wallet,
        uint8 threshold,
        uint64 challengePeriod,
        Guardian[] calldata guardians
    ) external returns (address recoveryManager);

    /// @notice Compute the address of a RecoveryManager before deployment
    function computeAddress(
        address wallet,
        uint8 threshold,
        uint64 challengePeriod,
        Guardian[] calldata guardians
    ) external view returns (address);

    function implementation() external view returns (address);
    function passkeyVerifier() external view returns (address);
    function zkJwtVerifier() external view returns (address);
}
```

### 13.3 IPasskeyVerifier

```solidity
interface IPasskeyVerifier {
    /// @notice Verify a WebAuthn assertion
    /// @param intentHash The intent hash that should be the challenge
    /// @param pubKeyHash keccak256(pubKeyX || pubKeyY)
    /// @param proof Encoded (pubKeyX, pubKeyY, authenticatorData, clientDataJSON, signature)
    /// @return valid True if the proof is valid
    function verify(
        bytes32 intentHash,
        bytes32 pubKeyHash,
        bytes calldata proof
    ) external view returns (bool valid);
}
```

### 13.4 IZkJwtVerifier

```solidity
interface IZkJwtVerifier {
    /// @notice Verify a zkJWT proof
    /// @param intentHash The intent hash (public input to circuit)
    /// @param commitment The commitment: keccak256(email || salt)
    /// @param proof Noir proof bytes
    /// @return valid True if the proof is valid
    function verify(
        bytes32 intentHash,
        bytes32 commitment,
        bytes calldata proof
    ) external view returns (bool valid);
}
```

---

## 14. Events

### 14.1 RecoveryManager Events

| Event | Emitted When | Indexed Fields |
|-------|--------------|----------------|
| `RecoveryStarted` | `startRecovery` succeeds | `intentHash`, `wallet` |
| `ProofSubmitted` | `submitProof` or `startRecovery` succeeds | `intentHash`, `guardianIndex` |
| `ThresholdMet` | Approval count reaches threshold | `intentHash` |
| `RecoveryCancelled` | `cancelRecovery` succeeds | `intentHash` |
| `RecoveryExecuted` | `executeRecovery` succeeds | `intentHash`, `newOwner` |
| `PolicyUpdated` | Any policy change | (none) |

### 14.2 Factory Events

| Event | Emitted When | Indexed Fields |
|-------|--------------|----------------|
| `RecoveryManagerDeployed` | New RecoveryManager deployed | `recoveryManager`, `wallet` |

---

## 15. Error Handling

### 15.1 RecoveryManager Errors

```solidity
// Session errors
error NoActiveSession();
error SessionAlreadyActive();
error SessionExpired();
error InvalidDeadline();

// Proof errors
error InvalidProof();
error GuardianAlreadyApproved();
error InvalidGuardianIndex();

// Threshold/timing errors
error ThresholdNotMet();
error ChallengePeriodNotElapsed();
error ChallengePeriodElapsed();  // for cancellation after challenge

// Authorization errors
error NotWalletOwner();
error NotAuthorized();

// Policy errors
error InvalidThreshold();  // threshold > guardianCount or threshold == 0
error NoGuardians();
error TooManyGuardians();
```

### 15.2 Verifier Errors

```solidity
// PasskeyVerifier
error InvalidPublicKey();
error InvalidSignature();
error ChallengeMismatch();
error InvalidAuthenticatorData();

// ZkJwtVerifier
error InvalidProof();
error CommitmentMismatch();
```

---

## 16. Deployment

### 16.1 Deployment Order

1. **Deploy Verifiers** (singleton, shared)
   - `PasskeyVerifier`
   - `ZkJwtVerifier`

2. **Deploy RecoveryManager Implementation** (singleton)
   - Implementation contract for minimal proxies

3. **Deploy RecoveryManagerFactory** (singleton)
   - Pass: implementation address, verifier addresses

4. **Per-Wallet Deployment**
   - Call `factory.deploy(...)` for each wallet
   - Returns minimal proxy pointing to implementation

### 16.2 Deployment Addresses

Verifiers and factory should be deployed to deterministic addresses (CREATE2) for easy discovery across chains.

Suggested approach:
- Use a deterministic deployer (e.g., `0x4e59b44847b379578588920cA78FbF26c0B4956C`)
- Use consistent salt for each contract
- Document addresses in SDK

### 16.3 Chain Support (v1)

Primary target: Ethereum mainnet and major L2s where:
- EIP-7702 is supported (for Ambire integration)
- P-256 precompile available (for efficient passkey verification) OR fallback verifier works

---

## 17. Future Considerations (Out of Scope for v1)

### 17.1 Deferred Features

| Feature | Reason for Deferral |
|---------|---------------------|
| Cross-device passkey setup | Requires relay service or complex P2P; same-device sufficient for v1 |
| L2 UX (unified cross-chain recovery) | Complex; each chain independent for now |
| Smart contract guardians (EIP-1271) | Additional complexity; EOA/Passkey/zkJWT sufficient for v1 |
| Additional identity providers | Google JWT only for v1; others (Apple, Microsoft) can be added |
| Guardian acceptance flow | Social coordination is sufficient; formal acceptance adds UX friction |
| Policy update delays | Immediate updates for v1; delays can be added if needed |
| Slashing/penalties | No on-chain economics for v1 |

### 17.2 Potential v2 Features

1. **Cross-device passkey setup**: QR-based flow with relay or WebRTC
2. **More identity providers**: Apple, Microsoft, GitHub, etc.
3. **EIP-1271 guardians**: Safe or other smart wallets as guardians
4. **Policy update timelocks**: Delay between policy change and effect
5. **Guardian classes**: Require guardians from different categories
6. **Recovery delegation**: Allow a service to coordinate recovery
7. **Cross-chain coordination**: Unified recovery across L2s

### 17.3 Upgrade Path

- RecoveryManager uses minimal proxy pattern
- Users can deploy new RecoveryManager with updated implementation
- Old RecoveryManager can be removed from wallet privileges
- No migration needed for verifiers (stateless)

---

## Appendix A: Example Flows

### A.1 Complete Setup Example (TypeScript)

```typescript
import { AuthManager, RecoveryManager, GuardianType } from 'social-recovery-sdk';

const authManager = new AuthManager();
const recoveryManager = new RecoveryManager(provider, authManager);

// 1. Prepare guardians
const guardians = [];

// Guardian 1: EOA (Alice)
const aliceAddress = '0xAlice...';
guardians.push({
  guardianType: GuardianType.EOA,
  identifier: await authManager.deriveEOAIdentifier(aliceAddress),
});

// Guardian 2: Passkey (Bob)
const { identifier: bobIdentifier, pubKey: bobPubKey } =
  await authManager.derivePasskeyIdentifier();
// Bob should save bobPubKey for recovery
guardians.push({
  guardianType: GuardianType.Passkey,
  identifier: bobIdentifier,
});

// Guardian 3: zkJWT (Carol)
const carolEmail = 'carol@gmail.com';
const carolSalt = randomBytes(32);
// Owner must share carolSalt with Carol securely
guardians.push({
  guardianType: GuardianType.ZkJWT,
  identifier: await authManager.deriveZkJwtIdentifier(carolEmail, carolSalt),
});

// 2. Deploy RecoveryManager
const recoveryManagerAddress = await recoveryManager.deployRecoveryManager({
  wallet: walletAddress,
  threshold: 2,
  challengePeriod: 3 * 24 * 60 * 60, // 3 days
  guardians,
});

// 3. Authorize in wallet (Ambire)
await wallet.setAddrPrivilege(recoveryManagerAddress, 1n);
```

### A.2 Complete Recovery Example (TypeScript)

```typescript
// Assume: User lost access, has new key, contacts guardians

const recoveryManager = new RecoveryManager(provider);
const authManager = new AuthManager();

// 1. Get current policy
const policy = await recoveryManager.getPolicy(recoveryManagerAddress);

// 2. Build intent
const intent = recoveryManager.buildIntent({
  wallet: walletAddress,
  newOwner: newOwnerAddress,
  recoveryManager: recoveryManagerAddress,
  nonce: policy.nonce,
});

// 3. Guardian 1 (Alice, EOA) starts recovery
const aliceProof = await authManager.getAdapter(GuardianType.EOA)
  .generateProof(intent, { signer: aliceSigner });

await recoveryManager.startRecovery({
  recoveryManager: recoveryManagerAddress,
  newOwner: newOwnerAddress,
  deadline: intent.deadline,
  guardianIndex: 0,
  proof: aliceProof,
  signer: aliceSigner,
});

// 4. Guardian 3 (Carol, zkJWT) submits proof
const carolJwt = await googleAuth.getIdToken(); // Carol authenticates
const carolProof = await authManager.getAdapter(GuardianType.ZkJWT)
  .generateProof(intent, {
    jwt: carolJwt,
    email: 'carol@gmail.com',
    salt: carolSalt
  });

await recoveryManager.submitProof({
  recoveryManager: recoveryManagerAddress,
  guardianIndex: 2,
  proof: carolProof,
  signer: anyoneSigner,
});

// 5. Wait for challenge period
const remaining = await recoveryManager.getChallengeTimeRemaining(recoveryManagerAddress);
console.log(`Challenge period: ${remaining} seconds remaining`);

// ... wait ...

// 6. Execute recovery
await recoveryManager.executeRecovery({
  recoveryManager: recoveryManagerAddress,
  signer: anyoneSigner,
});

// 7. User imports newOwnerAddress key into wallet UI
```

---

## Appendix B: Gas Estimates

| Operation | Estimated Gas |
|-----------|---------------|
| Deploy RecoveryManager (via factory) | ~150,000 |
| startRecovery (EOA proof) | ~80,000 |
| startRecovery (Passkey proof) | ~200,000 |
| startRecovery (zkJWT proof) | ~300,000+ |
| submitProof (EOA) | ~50,000 |
| submitProof (Passkey) | ~180,000 |
| submitProof (zkJWT) | ~280,000+ |
| cancelRecovery | ~30,000 |
| executeRecovery | ~100,000 |
| updatePolicy | ~50,000 + 20,000 per guardian |

*Estimates are approximate and depend on chain, EVM version, and verifier implementations.*

---

## Appendix C: Security Checklist

### Pre-Deployment
- [ ] All contracts audited by reputable firm
- [ ] Formal verification of critical paths (optional)
- [ ] Test coverage > 95%
- [ ] Fuzzing completed
- [ ] Gas optimization reviewed

### Deployment
- [ ] Verifiers deployed and verified on block explorer
- [ ] Factory deployed and verified
- [ ] Implementation deployed and verified
- [ ] Addresses documented in SDK

### Integration
- [ ] Wallet correctly authorizes RecoveryManager
- [ ] Challenge period appropriate for wallet value
- [ ] Threshold appropriate for guardian count
- [ ] Guardians properly informed and have stored necessary data (salts, pubkeys)

---

*End of Specification*
