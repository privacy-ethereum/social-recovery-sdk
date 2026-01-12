# Social Recovery SDK Documentation

Technical documentation for the Social Recovery SDK — a composable toolkit for adding social recovery to smart wallets.

> **Note:** This SDK is under active development. APIs and implementations may change.

## Documentation

| Document | Description |
|----------|-------------|
| [Concepts](./concepts.md) | Core concepts: guardians, thresholds, sessions |
| [Architecture](./architecture.md) | System components and how they interact |
| [Recovery Flow](./recovery-flow.md) | Complete recovery lifecycle with examples |
| [Authentication](./authentication.md) | EOA, Passkey, and zkJWT auth methods |
| [Wallet Integration](./wallet-integration.md) | How to integrate with smart wallets |
| [Security](./security.md) | Security model and threat mitigations |
| [SDK Quick Start](./sdk-quickstart.md) | Getting started with the TypeScript SDK |

## Quick Links

- [SPEC.md](../SPEC.md) — Full technical specification
- [ARCHITECTURE.md](../ARCHITECTURE.md) — Codebase structure

## Overview

The SDK enables wallet owners to designate **guardians** who can collectively restore wallet access if the owner loses their keys. It supports multiple authentication methods (EOA signatures, Passkeys, zkJWT) and N-of-M threshold policies.

```
Owner loses keys → Guardians submit proofs → Challenge period → New owner set
```
