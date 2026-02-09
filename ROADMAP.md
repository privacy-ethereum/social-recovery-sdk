# Social Recovery SDK — Q1 2026 Roadmap

---

## Phase 1: Foundation & Passkey

- Project structure setup (Foundry, TypeScript, Noir)
- Core interfaces (`IRecoveryManager`, `IVerifier`, `IWallet`)
- Shared libraries (`GuardianLib`, `EIP712Lib`)
- `PasskeyVerifier` contract
- `PasskeyAdapter` in SDK
- Unit tests for passkey functionality

## Phase 2: Core Contracts

- `RecoveryManager` (policy, sessions, proof verification, execution)
- `RecoveryManagerFactory` (EIP-1167 proxies)
- `ZkJwtVerifier` + Noir circuit
- Contract unit tests

## Phase 3: TypeScript SDK

- `RecoveryClient` (main orchestration)
- `AuthManager` + remaining adapters (EOA, zkJWT)
- `PolicyBuilder`
- Contract bindings
- SDK unit tests

## Phase 4: Full Library Testing

- End-to-end flow tests
- SDK ↔ Contract integration tests
- Testnet deployment

## Phase 5: Integration testing // Ambire Wallet Fork

- Integration into an Ambire wallet fork
- Full recovery flow testing
