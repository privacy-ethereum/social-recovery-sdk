# SDK

TypeScript SDK for social recovery. Orchestrates guardian proofs, contract interactions, and recovery flows.

## Quick Start

```bash
npm install && npm run build && npm test

# Full SDK ↔ Contracts e2e on local Anvil
npm run test:e2e
```

## Directory Structure

```
sdk/
├── src/
│   ├── auth/
│   │   ├── AuthManager.ts         # Manages auth adapters
│   │   ├── adapters/
│   │   │   ├── IAuthAdapter.ts    # Adapter interface
│   │   │   ├── EoaAdapter.ts      # EOA: EIP-712 ECDSA signing
│   │   │   ├── PasskeyAdapter.ts  # Passkey: WebAuthn/P-256
│   │   │   └── ZkJwtAdapter.ts    # zkJWT: Noir ZK proof generation
│   │   └── utils/
│   │       ├── eip712.ts          # EIP-712 typed data hashing
│   │       ├── webauthn.ts        # WebAuthn/COSE/DER parsing
│   │       └── zkjwt/             # zkJWT circuit utilities
│   ├── contracts/
│   │   ├── abis/                  # Contract ABI constants
│   │   ├── RecoveryManagerContract.ts  # RecoveryManager interactions
│   │   └── FactoryContract.ts     # Factory interactions
│   ├── recovery/
│   │   ├── RecoveryClient.ts      # Main client: deploy, recover, cancel
│   │   └── PolicyBuilder.ts       # Fluent API for guardian policies
│   ├── types.ts                   # Core type definitions
│   ├── constants.ts               # EIP-712 domain, defaults
│   └── index.ts                   # Public exports
├── scripts/
│   └── test-e2e.sh                # Local e2e runner (Anvil + contracts + vitest)
└── test/
    ├── e2e.test.ts                # Full SDK -> contracts e2e (EOA, Passkey, zkJWT)
    └── *.test.ts                  # Unit/integration tests
```

## Usage

```typescript
import {
  RecoveryClient, PolicyBuilder, EoaAdapter,
  PasskeyAdapter, ZkJwtAdapter, AuthManager,
} from '@pse/social-recovery-sdk';

// Build a guardian policy
const policy = new PolicyBuilder()
  .setWallet('0x...')
  .addEoaGuardian('0x...')
  .addPasskeyGuardian({ x: ..., y: ... })
  .addZkJwtGuardian('0x...')  // Poseidon2 commitment
  .setThreshold(2)
  .setChallengePeriod(86400)
  .build();

// Create client
const client = new RecoveryClient({
  publicClient,
  walletClient,
  factoryAddress: '0x...',
});

// Deploy RecoveryManager
const rmAddress = await client.deployRecoveryManager(policy);

// Start recovery (guardian generates proof via adapter)
const adapter = new EoaAdapter({ walletClient: guardianWallet });
const proof = await adapter.generateProof(intent, guardianId);
await client.startRecovery({ newOwner, guardianIndex: 0n, proof: proof.proof! });
```
