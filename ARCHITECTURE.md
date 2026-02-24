# Social Recovery SDK — Architecture

**Version:** 1.1.0
**Date:** 2026-02-24

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
│   │   │   ├── ZkJwtVerifier.sol     # Noir ZK proof verification for JWT auth
│   │   │   └── HonkVerifier.sol      # Auto-generated Noir proof verifier (via bb)
│   │   ├── interfaces/
│   │   │   ├── IRecoveryManager.sol  # RecoveryManager interface
│   │   │   ├── IVerifier.sol         # Common verifier interface
│   │   │   └── IWallet.sol           # Interface wallets must implement
│   │   └── libraries/
│   │       ├── GuardianLib.sol       # Guardian struct, encoding helpers
│   │       └── EIP712Lib.sol         # EIP-712 typed data hashing
│   └── test/
│       ├── RecoveryManager.t.sol        # Core recovery flow tests
│       ├── RecoveryManagerFactory.t.sol # Factory deployment tests
│       ├── PasskeyVerifier.t.sol        # Passkey verifier tests
│       ├── ZkJwtVerifier.t.sol          # zkJWT verifier tests
│       ├── GuardianLib.t.sol            # Guardian library tests
│       └── EIP712Lib.t.sol              # EIP-712 library tests
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
│   │   │   ├── adapters/
│   │   │   │   ├── IAuthAdapter.ts   # Adapter interface
│   │   │   │   ├── EoaAdapter.ts     # EOA: EIP-712 signing
│   │   │   │   ├── PasskeyAdapter.ts # Passkey: WebAuthn assertion
│   │   │   │   └── ZkJwtAdapter.ts   # zkJWT: OAuth + Noir proof generation
│   │   │   └── utils/
│   │   │       ├── eip712.ts         # EIP-712 typed data hashing
│   │   │       ├── webauthn.ts       # WebAuthn/COSE/DER parsing
│   │   │       └── zkjwt/            # zkJWT circuit utilities
│   │   │           ├── poseidon.ts       # Poseidon2 hashing via bb.js
│   │   │           ├── rsa.ts            # RSA modulus extraction, limb splitting
│   │   │           ├── jwt.ts            # JWT parsing, circuit input extraction
│   │   │           ├── google-jwks.ts    # Google JWKS fetch, JWT decode
│   │   │           └── circuit.ts        # Noir circuit execution, UltraHonk proving
│   │   ├── recovery/
│   │   │   ├── RecoveryClient.ts     # Main client: start, submit, execute recovery
│   │   │   └── PolicyBuilder.ts      # Fluent API for building guardian policies
│   │   └── contracts/
│   │       ├── abis/                      # Contract ABI constants
│   │       ├── RecoveryManagerContract.ts # Typed contract interactions
│   │       └── FactoryContract.ts         # Factory contract interactions
│   └── test/
│
├── docs/                         # Documentation site and guides
│   └── src/
│
├── example/                      # Standalone integration project (separate from SDK internals)
│   ├── README.md                 # Example runbook
│   ├── example-spec.md           # 3-phase delivery spec for demo app
│   ├── contracts/                # Standalone Foundry project for demo AA wallet
│   │   ├── src/
│   │   │   ├── ExampleAAWallet.sol
│   │   │   └── ExampleAAWalletFactory.sol
│   │   └── test/
│   │       └── ExampleAAWallet.t.sol
│   └── aa-wallet/                # React + viem demo app
│       ├── scripts/
│       │   ├── local-up.sh           # Start Anvil, build/deploy stack, run app
│       │   ├── local-down.sh         # Stop local services
│       │   └── deploy-local.ts       # Deploy SDK + example contracts and write local config
│       └── src/
│           ├── app/
│           │   ├── App.tsx
│           │   └── routes.tsx
│           ├── pages/
│           │   ├── WalletPage.tsx
│           │   ├── SettingsPage.tsx
│           │   └── RecoverPage.tsx
│           ├── lib/
│           │   ├── chain.ts
│           │   ├── contracts.ts
│           │   ├── recovery.ts
│           │   ├── policy.ts
│           │   └── intents.ts
│           └── styles/
│               └── global.css
│
├── SPEC.md                       # Functional requirements, protocol design
├── ARCHITECTURE.md               # Codebase structure (this file)
├── ROADMAP.md                    # SDK roadmap
├── CHECKLIST.md                  # SDK implementation status
└── README.md
```

---

*End of Architecture*
