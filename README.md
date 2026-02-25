<h1 align="center">Social Recovery SDK</h1>

A composable SDK for adding social recovery to smart wallets. Designate guardians who can collectively restore wallet access using EOA signatures, Passkeys, or zero-knowledge proofs of emails and passport.

<p align="center"><b>Security notice: this project has not been audited and is not production-ready</b></p>

## Structure

```
contracts/   # Solidity smart contracts (Foundry)
sdk/         # TypeScript SDK
circuits/    # Noir ZK circuits for zkJWT
docs/        # Documentation
example/     # Standalone demo app + standalone demo wallet contracts
```

## Quick Start

```bash
# Contracts
cd contracts && forge install && forge build && forge test

# SDK
cd sdk && npm install && npm run build && npm test

# SDK ↔ Contracts e2e (spins up Anvil automatically)
cd sdk && npm run test:e2e

# Circuits
cd circuits/zkjwt && nargo build && nargo test

# Standalone example app
# Set VITE_GOOGLE_OAUTH_CLIENT_ID in example/aa-wallet/.env to enable zkJWT guardian flow
cd example/aa-wallet && npm install && npm run local:up

# Stop local example stack:
cd example/aa-wallet && npm run local:down
```

## Documentation

See [docs/](./docs/README.md) for detailed documentation, [SPEC.md](./SPEC.md) for the full technical specification, [ARCHITECTURE.md](./ARCHITECTURE.md) for the project architecture, [ROADMAP.md](./ROADMAP.md) for the development roadmap, and [CHECKLIST.md](./CHECKLIST.md) for the current progress tracking.

Standalone example details (EOA + Passkey + zkJWT flows) are in [example/README.md](./example/README.md).
