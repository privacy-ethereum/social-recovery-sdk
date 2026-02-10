# Deployment Guide

## Deployment order

1. `PasskeyVerifier`
2. `ZKTranscriptLib` (for Honk verifier linking)
3. `HonkVerifier`
4. `ZkJwtVerifier`
5. `RecoveryManager` implementation
6. `RecoveryManagerFactory`

The provided script `contracts/scripts/deploy.sh` performs this order.

## Required environment

```bash
RPC_URL=...
PRIVATE_KEY=...
ETHERSCAN_API_KEY=...
CHAIN=sepolia
```

## P-256 dependency check

Passkey verification depends on deterministic `p256-verifier` deployment at:

`0xc2b78104907F722DABAc4C69f826a522B2754De4`

The deploy script checks this address and fails fast if bytecode is missing.

## Build profile

For large verifier artifacts (notably Honk verifier), use deploy profile where needed:

```bash
FOUNDRY_PROFILE=deploy forge build
```
