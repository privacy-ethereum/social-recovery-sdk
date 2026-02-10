# Testing Guide

## Contracts

```bash
cd contracts
forge test --offline
```

If your Foundry environment is stable without external signature lookup issues, `forge test` is also fine.

## SDK unit/integration

```bash
cd sdk
npm test
```

## SDK end-to-end

```bash
cd sdk
npm run test:e2e
```

This script runs local Anvil + contract deploy + full flow tests.

## Circuit tests

```bash
cd circuits/zkjwt
nargo test
```

## Suggested CI order

1. Contracts tests
2. SDK build + unit/integration tests
3. Circuit tests
4. SDK e2e tests
