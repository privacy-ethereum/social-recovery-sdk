# Example: Standalone AA Wallet Integration

This `example/` workspace demonstrates how to use this SDK and contract stack from a **separate standalone project**.

It contains:

1. `example/contracts` - standalone Foundry project with the demo wallet contracts
2. `example/aa-wallet` - web app that integrates the SDK and runs recovery flows

## Phase Status

1. Phase 1 (Wallet + EOA recovery): ✅ completed
2. Phase 2 (Passkey in app flow): ✅ completed
3. Phase 3 (zkJWT in app flow): pending

## How it works (high level)

1. The web app deploys and uses a demo wallet (`ExampleAAWallet`) from `example/contracts`.
2. The app deploys and uses the SDK recovery contracts (factory + manager implementation + verifiers).
3. Recovery is configured via wallet settings (guardians/threshold/challenge period).
4. Recovery can be executed from a wallet-address-first flow in `Recover`.

Current implemented guardian flow:

1. EOA guardians
2. Passkey guardians (WebAuthn)

Passkey note:

1. Passkeys are enrolled locally in your browser and stored in browser local storage for this demo app.
2. To submit passkey proofs, use the same browser/device where the passkey guardian was enrolled.

## Prerequisites

1. Node.js 20+
2. npm
3. Foundry (`forge`, `anvil`)
4. `jq` and `cast`
5. Browser with WebAuthn/passkey support (Chrome/Safari/Edge recent versions)

## Run locally (Anvil)

```bash
cd example/aa-wallet
npm install
npm run local:up
```

What `local:up` does:

1. starts Anvil
2. builds SDK contracts in `contracts/`
3. builds standalone example wallet contracts in `example/contracts/`
4. deploys SDK contracts + example wallet factory
5. writes deployed addresses to `example/aa-wallet/src/config/local-addresses.json`
6. starts the web app

Stop local services:

```bash
cd example/aa-wallet
npm run local:down
```

## SDK contract deployment references

If you want to deploy SDK contracts separately (outside local helper scripts), see:

1. `docs/src/contracts/deployment.md`
2. `contracts/scripts/deploy.sh`

## Standalone wallet contracts

Build/test wallet contracts directly:

```bash
cd example/contracts
FOUNDRY_OFFLINE=true forge build
FOUNDRY_OFFLINE=true forge test
```
