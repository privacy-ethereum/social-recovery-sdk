# Example Wallet Contracts

Standalone Foundry project for the wallet used by `example/aa-wallet`.

Contracts:

1. `src/ExampleAAWallet.sol`
2. `src/ExampleAAWalletFactory.sol`

This project has no nested git repo (`forge init --no-git` was used).

## Build

```bash
cd example/contracts
FOUNDRY_OFFLINE=true forge build
```

## Test

```bash
cd example/contracts
FOUNDRY_OFFLINE=true forge test
```

## Notes

1. These contracts are demo-focused for local/example usage.
2. Social recovery compatibility is provided by `owner()`, `setOwner(address)`, and `isRecoveryAuthorized(address)` on `ExampleAAWallet`.
