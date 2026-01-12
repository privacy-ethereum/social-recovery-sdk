# Recovery Flow

## Session Lifecycle

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

## Phase 1: Setup

Before recovery can happen, the wallet owner must configure their recovery policy.

### 1.1 Choose Guardians

```typescript
// Example: 3 guardians with different auth methods
const guardians = [
  { type: GuardianType.EOA, identifier: eoaAddress },
  { type: GuardianType.Passkey, identifier: passkeyHash },
  { type: GuardianType.ZkJWT, identifier: emailCommitment }
];
```

### 1.2 Configure Policy

```typescript
const policy = {
  guardians,
  threshold: 2,           // 2-of-3 required
  challengePeriod: 86400  // 24 hours
};
```

### 1.3 Deploy RecoveryManager

```typescript
const recoveryManager = await factory.deploy(
  walletAddress,
  policy.guardians,
  policy.threshold,
  policy.challengePeriod
);
```

### 1.4 Authorize in Wallet

The wallet must authorize the RecoveryManager to execute on its behalf. This is wallet-specific (see [Wallet Integration](./wallet-integration.md)).

## Phase 2: Recovery

When the owner loses access, guardians coordinate to restore it.

### 2.1 Create Recovery Intent

```typescript
const intent = {
  wallet: walletAddress,
  newOwner: newOwnerAddress,
  nonce: await recoveryManager.nonce(),
  deadline: Math.floor(Date.now() / 1000) + 86400, // 24h from now
  chainId: 1,
  recoveryManager: recoveryManager.address
};
```

### 2.2 First Guardian Initiates

```typescript
// Guardian generates proof for their auth method
const proof = await authManager.generateProof(guardian, intent);

// Start the recovery session
await recoveryManager.startRecovery(
  intent.newOwner,
  intent.deadline,
  guardianIndex,
  proof
);
```

### 2.3 Additional Guardians Submit Proofs

```typescript
// Each guardian submits their proof
const proof = await authManager.generateProof(guardian, intent);
await recoveryManager.submitProof(guardianIndex, proof);

// When threshold is met, challenge period begins automatically
```

### 2.4 Challenge Period

During this window, the original owner can cancel if they regain access:

```typescript
// Only callable by current wallet owner
await recoveryManager.cancelRecovery();
```

### 2.5 Execute Recovery

After challenge period elapses, anyone can finalize:

```typescript
// Check if ready
const session = await recoveryManager.activeSession();
const ready = block.timestamp >= session.thresholdMetAt + challengePeriod;

if (ready) {
  await recoveryManager.executeRecovery();
  // newOwner now has wallet access
}
```

## Post-Recovery

After `executeRecovery()`:

1. `newOwner` is authorized on the wallet
2. Old owner privileges are **not** automatically removed (wallet's choice)
3. RecoveryManager remains authorized (allows future recovery)
4. Nonce increments (invalidates any unused proofs)

The wallet UI must recognize the new owner and allow them to access the wallet with their imported key.

## Error Cases

| Scenario | Result |
|----------|--------|
| Non-guardian tries to start | Reverts |
| Duplicate proof from same guardian | Reverts |
| Proof with wrong nonce | Reverts |
| Proof past deadline | Reverts |
| Execute before challenge period | Reverts |
| Owner cancels during challenge | Session cleared, nonce++ |
