# Getting Started

## Prerequisites

- Node.js 20+
- npm
- Foundry (`forge`, `cast`)
- Noir toolchain (`nargo`, `bb`) for circuit work
- Anvil for local end-to-end testing

## Repository quick check

From the project root:

```bash
# Contracts tests
cd contracts && forge test --offline

# SDK unit/integration tests
cd ../sdk && npm install && npm run build && npm test

# Full SDK <-> contracts e2e
npm run test:e2e

# Circuit tests
cd ../circuits/zkjwt && nargo test
```

## Key entry points

- Spec: `SPEC.md`
- Architecture map: `ARCHITECTURE.md`
- SDK package: `sdk/src/index.ts`
- Recovery contracts: `contracts/src/RecoveryManager.sol`

## Typical integration path

1. Deploy shared verifiers, RecoveryManager implementation, and factory.
2. In your wallet flow, deploy a per-wallet RecoveryManager via factory.
3. Authorize that RecoveryManager inside the wallet.
4. Use SDK clients/adapters to run start/submit/execute/cancel flows.
5. Add monitoring for recovery events and owner-side cancellation UX.
