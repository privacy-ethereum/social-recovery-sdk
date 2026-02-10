# Social Recovery SDK

The Social Recovery SDK is a composable stack for adding social recovery to smart wallets.

It combines:

- On-chain recovery contracts (`contracts/`)
- A TypeScript SDK for orchestration and proof generation (`sdk/`)
- A Noir circuit for privacy-preserving email guardians (`circuits/zkjwt/`)

## What this project solves

If a wallet owner loses access to their key, designated guardians can recover ownership through a controlled process:

1. A guardian starts recovery with a valid proof.
2. Additional guardians submit proofs until threshold is met.
3. A challenge period allows the owner to cancel unauthorized recovery.
4. Recovery executes on-chain and ownership is updated.

## Supported guardian types

- EOA signatures (EIP-712)
- Passkeys (WebAuthn / P-256)
- zkJWT commitments (Google JWT + Noir proof)

## Where to start

- New to the project: [Getting Started](getting-started.md)
- Integrating a wallet: [Wallet Integration](wallet-integration.md)
- Using the SDK right away: [SDK Quickstart](sdk/quickstart.md)
