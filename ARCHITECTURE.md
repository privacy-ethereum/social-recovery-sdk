# Social Recovery SDK — Architecture

**Version:** 1.0.0
**Date:** 2026-01-12

This document defines the codebase structure. For functional requirements and protocol design, see [SPEC.md](./SPEC.md).

---

## Project Structure

```
social-recovery-sdk/
├── contracts/                    # Solidity smart contracts (Foundry)
│   ├── src/
│   │   ├── RecoveryManager.sol       # Core: session lifecycle, proof verification, execution
│   │   ├── RecoveryManagerFactory.sol # Deploys RecoveryManager proxies (EIP-1167)
│   │   ├── verifiers/
│   │   │   ├── PasskeyVerifier.sol   # WebAuthn/P-256 signature verification
│   │   │   └── ZkJwtVerifier.sol     # Noir ZK proof verification for JWT auth
│   │   ├── interfaces/
│   │   │   ├── IRecoveryManager.sol  # RecoveryManager interface
│   │   │   ├── IVerifier.sol         # Common verifier interface
│   │   │   └── IWallet.sol           # Interface wallets must implement
│   │   └── libraries/
│   │       ├── GuardianLib.sol       # Guardian struct, encoding helpers
│   │       └── EIP712Lib.sol         # EIP-712 typed data hashing
│   ├── test/                         # Foundry tests
│   └── script/                       # Deployment scripts
│
├── circuits/                     # Noir circuits for zkJWT
│   └── zkjwt/
│       ├── src/
│       │   └── main.nr               # ZK circuit: JWT signature + email commitment
│       ├── Nargo.toml
│       └── scripts/                   # TypeScript input generators
│           ├── src/
│           │   ├── generate-prover.ts     # CLI: generates Prover.toml (self-signed or Google JWT)
│           │   ├── utils/
│           │   │   ├── rsa.ts             # RSA key generation, modulus extraction
│           │   │   ├── jwt.ts             # JWT creation, verification, circuit input extraction
│           │   │   ├── poseidon.ts        # Poseidon2 hashing via bb.js
│           │   │   ├── prover-toml.ts     # Prover.toml serialization
│           │   │   └── google-jwks.ts     # Google JWKS fetch, JWT header/payload decode
│           │   └── fixtures/
│           │       ├── self-signed.ts     # Self-signed JWT fixture (testing)
│           │       └── google-signed.ts   # Google-signed JWT fixture (real tokens)
│           └── package.json
│
├── sdk/                          # TypeScript SDK
│   ├── src/
│   │   ├── index.ts                  # Public exports
│   │   ├── types.ts                  # Guardian, RecoveryIntent, Session types
│   │   ├── constants.ts              # Chain addresses, EIP-712 domain config
│   │   ├── auth/
│   │   │   ├── AuthManager.ts        # Manages adapters, generates proofs
│   │   │   └── adapters/
│   │   │       ├── IAuthAdapter.ts   # Adapter interface
│   │   │       ├── EoaAdapter.ts     # EOA: EIP-712 signing
│   │   │       ├── PasskeyAdapter.ts # Passkey: WebAuthn assertion
│   │   │       └── ZkJwtAdapter.ts   # zkJWT: OAuth + Noir proof generation
│   │   ├── recovery/
│   │   │   ├── RecoveryClient.ts     # Main client: start, submit, execute recovery
│   │   │   └── PolicyBuilder.ts      # Fluent API for building guardian policies
│   │   └── contracts/
│   │       ├── RecoveryManagerContract.ts  # Typed contract interactions
│   │       └── FactoryContract.ts          # Factory contract interactions
│   └── test/
│
├── SPEC.md                       # Functional requirements, protocol design
├── ARCHITECTURE.md               # Codebase structure (this file)
└── README.md
```

---

*End of Architecture*
