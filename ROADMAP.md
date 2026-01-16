# Social Recovery SDK — Q1 2026 Roadmap

**Target Completion:** February 27

---

## Phase 1: Foundation & Passkey (January 5–16)

- Project structure setup (Foundry, TypeScript, Noir)
- Core interfaces (`IRecoveryManager`, `IVerifier`, `IWallet`)
- Shared libraries (`GuardianLib`, `EIP712Lib`)
- `PasskeyVerifier` contract
- `PasskeyAdapter` in SDK
- Unit tests for passkey functionality

## Phase 2: Core Contracts (January 19–30)

- `RecoveryManager` (policy, sessions, proof verification, execution)
- `RecoveryManagerFactory` (EIP-1167 proxies)
- `ZkJwtVerifier` + Noir circuit
- Contract unit tests

## Phase 3: TypeScript SDK (February 2–13)

- `RecoveryClient` (main orchestration)
- `AuthManager` + remaining adapters (EOA, zkJWT)
- `PolicyBuilder`
- Contract bindings
- SDK unit tests

## Phase 4: Full Library Testing (February 16–20)

- End-to-end flow tests
- SDK ↔ Contract integration tests
- Testnet deployment

## Phase 5: Integration testing // Ambire Wallet (February 23-27)

- Integration with Ambire wallet
- Full recovery flow testing
