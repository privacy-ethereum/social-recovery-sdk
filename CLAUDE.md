# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## IMPORTANT

Always use Opus 4.6 as a default model for background agents.

## Project Overview

Social Recovery SDK - a composable SDK for adding social recovery to smart wallets. Guardians can collectively restore wallet access using three authentication methods: EOA signatures, Passkeys (WebAuthn/P-256), and zkJWT (zero-knowledge proofs over Google JWTs).

## Build and Test Commands

**Contracts (Foundry/Solidity):**
```bash
cd contracts && forge build          # Build contracts
cd contracts && forge test           # Run all tests
cd contracts && forge test --match-test testFunctionName  # Run single test
cd contracts && forge test -vvv      # Verbose test output
```

**SDK (TypeScript):**
```bash
cd sdk && npm install && npm run build   # Build SDK
cd sdk && npm test                       # Run tests
```

**Circuits (Noir):**
```bash
cd circuits/zkjwt && nargo build    # Build circuit
cd circuits/zkjwt && nargo test     # Run circuit tests
```

## Architecture

Three main components:

1. **contracts/** - Solidity smart contracts
   - `RecoveryManager` - One instance per wallet, manages recovery sessions and proof verification
   - `RecoveryManagerFactory` - Deploys RecoveryManager proxies using EIP-1167 minimal proxy pattern
   - Shared singleton verifiers (`PasskeyVerifier`, `ZkJwtVerifier`) - all wallets share these

2. **sdk/** - TypeScript SDK for off-chain orchestration
   - `RecoveryClient` - Main entry point for recovery operations
   - `AuthManager` with adapters - Generates proofs for each auth method (EOA, Passkey, zkJWT)
   - `PolicyBuilder` - Fluent API for configuring guardians and thresholds

3. **circuits/** - Noir ZK circuits for zkJWT authentication
   - Proves JWT validity + email commitment without revealing email

## Key Concepts

- **Guardian identifier encoding**: EOA uses address, Passkey uses `keccak256(pubKeyX || pubKeyY)`, zkJWT uses `Poseidon(email, salt)`
- **Recovery flow**: `startRecovery()` → `submitProof()` (repeat until threshold) → challenge period → `executeRecovery()`
- **RecoveryIntent**: EIP-712 typed data structure that all proofs are bound to (includes nonce, chainId, deadline for replay protection)
