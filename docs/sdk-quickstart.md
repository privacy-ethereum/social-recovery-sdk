# SDK Quick Start

> **Note:** The SDK is under development. APIs shown here are illustrative and may change.

## Installation

```bash
npm install @pse/social-recovery-sdk
# or
yarn add @pse/social-recovery-sdk
```

## Basic Usage

### 1. Initialize the SDK

```typescript
import {
  RecoveryClient,
  PolicyBuilder,
  GuardianType
} from '@pse/social-recovery-sdk';
import { ethers } from 'ethers';

// Connect to provider
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const signer = new ethers.Wallet(PRIVATE_KEY, provider);

// Initialize client
const client = new RecoveryClient({
  provider,
  signer,
  factoryAddress: FACTORY_ADDRESS
});
```

### 2. Build a Guardian Policy

```typescript
const policy = new PolicyBuilder()
  // Add an EOA guardian
  .addEoaGuardian("0x1234567890123456789012345678901234567890")

  // Add a passkey guardian (after WebAuthn registration)
  .addPasskeyGuardian(pubKeyX, pubKeyY)

  // Add a zkJWT guardian (email commitment)
  .addZkJwtGuardian(emailCommitment)

  // Require 2 of 3 guardians
  .setThreshold(2)

  // 24 hour challenge period
  .setChallengePeriod(86400)

  .build();
```

### 3. Deploy RecoveryManager

```typescript
const walletAddress = "0xYourWalletAddress";

const recoveryManager = await client.deployRecoveryManager(
  walletAddress,
  policy
);

console.log("RecoveryManager deployed at:", recoveryManager.address);

// Don't forget to authorize the RecoveryManager in your wallet!
```

### 4. Start Recovery (Guardian)

When recovery is needed, a guardian initiates:

```typescript
import { EoaAdapter } from '@pse/social-recovery-sdk';

// Guardian creates recovery intent
const intent = await client.createIntent({
  wallet: walletAddress,
  newOwner: newOwnerAddress,
  deadline: Math.floor(Date.now() / 1000) + 86400 // 24h
});

// Guardian signs with their auth method
const eoaAdapter = new EoaAdapter(guardianSigner);
const proof = await eoaAdapter.generateProof(intent);

// Start recovery session
await client.startRecovery(
  recoveryManager.address,
  intent,
  guardianIndex,
  proof
);
```

### 5. Submit Additional Proofs

Other guardians submit their proofs:

```typescript
// Passkey guardian
import { PasskeyAdapter } from '@pse/social-recovery-sdk';

const passkeyAdapter = new PasskeyAdapter();
const proof = await passkeyAdapter.generateProof(intent, credentialId);

await client.submitProof(
  recoveryManager.address,
  guardianIndex,
  proof
);
```

```typescript
// zkJWT guardian
import { ZkJwtAdapter } from '@pse/social-recovery-sdk';

const zkJwtAdapter = new ZkJwtAdapter();
const proof = await zkJwtAdapter.generateProof(intent, {
  email: guardianEmail,
  salt: savedSalt
});

await client.submitProof(
  recoveryManager.address,
  guardianIndex,
  proof
);
```

### 6. Execute Recovery

After threshold is met and challenge period passes:

```typescript
// Check if ready
const status = await client.getRecoveryStatus(recoveryManager.address);

if (status.canExecute) {
  await client.executeRecovery(recoveryManager.address);
  console.log("Recovery complete! New owner:", status.newOwner);
}
```

## Monitoring Recovery Status

```typescript
// Get current session info
const session = await client.getActiveSession(recoveryManager.address);

if (session) {
  console.log("Recovery in progress");
  console.log("New owner:", session.newOwner);
  console.log("Approvals:", session.approvalCount, "/", policy.threshold);
  console.log("Challenge ends:", new Date(session.challengeEndsAt * 1000));
}
```

## Canceling Recovery (Owner)

If you're the wallet owner and see an unauthorized recovery:

```typescript
// Must be called by wallet owner
await client.cancelRecovery(recoveryManager.address);
```

## Updating Policy (Owner)

```typescript
const newPolicy = new PolicyBuilder()
  .addEoaGuardian(newGuardianAddress)
  .addPasskeyGuardian(newPubKeyX, newPubKeyY)
  .setThreshold(2)
  .setChallengePeriod(172800) // 48 hours
  .build();

// Must be called by wallet owner
await client.updatePolicy(recoveryManager.address, newPolicy);
```

## Event Listening

```typescript
// Listen for recovery events
client.on('RecoveryStarted', (event) => {
  console.log("Recovery started for wallet:", event.wallet);
  console.log("Proposed new owner:", event.newOwner);
});

client.on('ProofSubmitted', (event) => {
  console.log("Guardian", event.guardianIndex, "approved");
});

client.on('RecoveryExecuted', (event) => {
  console.log("Recovery complete for:", event.wallet);
});

client.on('RecoveryCancelled', (event) => {
  console.log("Recovery cancelled for:", event.wallet);
});
```

## Error Handling

```typescript
import { RecoveryError, ErrorCode } from '@pse/social-recovery-sdk';

try {
  await client.startRecovery(...);
} catch (error) {
  if (error instanceof RecoveryError) {
    switch (error.code) {
      case ErrorCode.SESSION_ACTIVE:
        console.log("Recovery already in progress");
        break;
      case ErrorCode.NOT_GUARDIAN:
        console.log("Caller is not a registered guardian");
        break;
      case ErrorCode.INVALID_PROOF:
        console.log("Proof verification failed");
        break;
      case ErrorCode.DEADLINE_PASSED:
        console.log("Intent deadline has passed");
        break;
    }
  }
}
```
