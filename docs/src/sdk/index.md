# SDK Guide

The SDK is the integration surface for applications and wallet frontends.

Primary exports:

- `RecoveryClient` - contract orchestration
- `PolicyBuilder` - policy construction + validation
- `AuthManager` - adapter registry
- `EoaAdapter`, `PasskeyAdapter`, `ZkJwtAdapter` - proof generation
- `createRecoveryIntent`, `hashRecoveryIntent` - EIP-712 helpers

## Recommended usage model

1. Build/deploy policy with owner client.
2. Create `RecoveryIntent` from on-chain nonce and challenge period.
3. Have guardian-specific clients generate proofs.
4. Call `startRecovery`/`submitProof` from guardian wallets.
5. Execute after challenge period.
