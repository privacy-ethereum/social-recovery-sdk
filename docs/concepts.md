# Core Concepts

## Guardians

A **guardian** is a party that can vouch for a wallet recovery. Each guardian is identified by an authentication method:

| Type | Identifier | Example |
|------|------------|---------|
| EOA | Ethereum address | `0x1234...abcd` |
| Passkey | Hash of P-256 public key | `keccak256(pubKeyX \|\| pubKeyY)` |
| zkJWT | Poseidon commitment | `Poseidon(email, salt)` |

Guardians don't need to deploy contracts or hold assets — they just need to be able to produce a valid proof when recovery is needed.

## Policies

A **policy** defines the recovery configuration for a wallet:

```
Policy {
    guardians: Guardian[]     // List of authorized guardians
    threshold: uint8          // N in N-of-M (minimum approvals needed)
    challengePeriod: uint64   // Seconds owner has to cancel
}
```

**Example:** 3 guardians with threshold 2 means any 2 of the 3 can authorize recovery.

## Recovery Sessions

A **session** represents a single recovery attempt. Only one session can be active per wallet at a time.

```
Session {
    intentHash: bytes32       // Hash of the recovery intent
    newOwner: address         // Proposed new wallet owner
    deadline: uint64          // When proofs expire
    thresholdMetAt: uint64    // Timestamp when N approvals reached (0 if not yet)
    approvalCount: uint8      // Current number of valid proofs
    approvals: mapping        // Which guardians have approved
}
```

## Challenge Period

The **challenge period** is a time window after threshold is met during which the original owner can cancel the recovery. This protects against:

- Compromised guardian keys
- Malicious guardian collusion
- Mistaken recovery attempts

Recommended: 1-7 days depending on wallet value. Can be set to 0 for testing.

## Recovery Intent

Guardians sign or prove over a **RecoveryIntent** structure (EIP-712 typed data):

```solidity
struct RecoveryIntent {
    address wallet;           // Wallet being recovered
    address newOwner;         // New owner address
    uint256 nonce;            // Session identifier (prevents replay)
    uint256 deadline;         // Proof expiration
    uint256 chainId;          // Target chain
    address recoveryManager;  // Contract address
}
```

This binding prevents:
- Cross-chain replay attacks
- Cross-contract replay attacks
- Proof reuse across sessions

## Nonce

The **nonce** increments each time:
- A recovery session completes (success or cancellation)
- The policy is updated (guardians, threshold, or challenge period changed)

This invalidates any existing proofs, ensuring guardians must re-approve for new recovery attempts.
