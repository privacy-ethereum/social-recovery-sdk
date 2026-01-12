# Social Recovery SDK — Architecture

**Version:** 1.0.0
**Date:** 2026-01-12

---

## Project Structure

```
social-recovery-sdk/
├── contracts/                    # Solidity smart contracts (Foundry)
│   ├── src/
│   │   ├── RecoveryManager.sol
│   │   ├── RecoveryManagerFactory.sol
│   │   ├── verifiers/
│   │   │   ├── PasskeyVerifier.sol
│   │   │   └── ZkJwtVerifier.sol
│   │   ├── interfaces/
│   │   │   ├── IRecoveryManager.sol
│   │   │   ├── IVerifier.sol
│   │   │   └── IWallet.sol
│   │   └── libraries/
│   │       ├── GuardianLib.sol
│   │       └── EIP712Lib.sol
│   ├── test/
│   └── script/
│
├── circuits/                     # Noir circuits for zkJWT
│   ├── zkjwt/
│   │   ├── src/
│   │   │   └── main.nr
│   │   └── Nargo.toml
│   └── lib/                      # Shared circuit libraries
│
├── sdk/                          # TypeScript SDK
│   ├── src/
│   │   ├── index.ts              # Public exports
│   │   ├── types.ts              # Shared types
│   │   ├── constants.ts          # Chain addresses, EIP-712 domain
│   │   ├── auth/
│   │   │   ├── index.ts
│   │   │   ├── AuthManager.ts
│   │   │   ├── adapters/
│   │   │   │   ├── IAuthAdapter.ts
│   │   │   │   ├── EoaAdapter.ts
│   │   │   │   ├── PasskeyAdapter.ts
│   │   │   │   └── ZkJwtAdapter.ts
│   │   │   └── utils/
│   │   │       ├── eip712.ts
│   │   │       └── webauthn.ts
│   │   ├── recovery/
│   │   │   ├── index.ts
│   │   │   ├── RecoveryClient.ts
│   │   │   └── PolicyBuilder.ts
│   │   └── contracts/
│   │       ├── index.ts
│   │       ├── RecoveryManagerContract.ts
│   │       └── FactoryContract.ts
│   ├── test/
│   └── package.json
│
├── examples/                     # Integration examples
│   └── simple-wallet/
│
└── docs/                         # Additional documentation
```

---

*End of Architecture*
