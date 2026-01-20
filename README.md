<h1 align="center">Social Recovery SDK</h1>

A composable SDK for adding social recovery to smart wallets. Designate guardians who can collectively restore wallet access using EOA signatures, Passkeys, or zero-knowledge proofs of emails and passport.

## Structure

```
contracts/   # Solidity smart contracts (Foundry)
sdk/         # TypeScript SDK
circuits/    # Noir ZK circuits for zkJWT
docs/        # Documentation
```

## Quick Start

```bash
# Contracts
cd contracts && forge install && forge build && forge test

# SDK
cd sdk && npm install && npm run build && npm test

# Circuits
cd circuits/zkjwt && nargo build && nargo test
```

## Documentation

See [docs/](./docs/README.md) for detailed documentation, [SPEC.md](./SPEC.md) for the full technical specification, [ARCHITECTURE.md](./ARCHITECTURE.md) for the project architecture, [ROADMAP.md](./ROADMAP.md) for the development roadmap, and [CHECKLIST.md](./CHECKLIST.md) for the current progress tracking.
