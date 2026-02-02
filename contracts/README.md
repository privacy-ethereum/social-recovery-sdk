# Contracts

Solidity smart contracts for social recovery. Manages guardian policies, recovery sessions, and on-chain proof verification.

## Quick Start

```bash
forge install && forge build && forge test
```

## Directory Structure

```
contracts/
├── src/
│   ├── RecoveryManager.sol              # Core contract (one per wallet)
│   ├── RecoveryManagerFactory.sol       # Deploys RecoveryManager proxies (EIP-1167)
│   ├── interfaces/
│   │   ├── IRecoveryManager.sol         # RecoveryManager interface (events, errors, functions)
│   │   ├── IVerifier.sol                # Common verifier interface
│   │   └── IWallet.sol                  # Wallet integration interface
│   ├── libraries/
│   │   ├── GuardianLib.sol              # Guardian types and identifier computation
│   │   └── EIP712Lib.sol                # EIP-712 typed data hashing for RecoveryIntent
│   └── verifiers/
│       ├── PasskeyVerifier.sol          # WebAuthn/P-256 signature verification
│       ├── ZkJwtVerifier.sol            # Wraps HonkVerifier, implements IVerifier
│       └── HonkVerifier.sol             # Auto-generated Noir proof verifier
└── test/
    ├── RecoveryManager.t.sol            # RecoveryManager tests (~63 tests)
    ├── RecoveryManagerFactory.t.sol      # Factory tests (~10 tests)
    ├── ZkJwtVerifier.t.sol              # ZkJwtVerifier tests (~8 tests)
    ├── PasskeyVerifier.t.sol            # PasskeyVerifier tests
    ├── EIP712Lib.t.sol                  # EIP-712 library tests
    └── GuardianLib.t.sol                # Guardian library tests
```

## Architecture

```
Wallet
  │ authorized to execute
  ▼
RecoveryManager (one per wallet, EIP-1167 proxy)
  │ delegates proof verification
  ├── EOA: ecrecover (built-in)
  ├── PasskeyVerifier (shared singleton)
  └── ZkJwtVerifier → HonkVerifier (shared singletons)
```

## Regenerating HonkVerifier.sol

If the Noir circuit changes, regenerate the Solidity verifier:

```bash
# Build circuit
cd ../circuits/zkjwt && nargo build

# Generate EVM-targeted verification key
bb write_vk -b target/zkjwt.json -o /tmp/zkjwt-vk-evm -t evm

# Generate Solidity verifier
bb write_solidity_verifier -k /tmp/zkjwt-vk-evm/vk -o ../contracts/src/verifiers/HonkVerifier.sol -t evm
```

After regeneration, rename the generated `interface IVerifier` to `interface IZKVerifier` and update `BaseZKHonkVerifier is IVerifier` to `BaseZKHonkVerifier is IZKVerifier` to avoid collision with `interfaces/IVerifier.sol`.

## Deployment Order

1. Deploy shared verifiers (`PasskeyVerifier`, `ZkJwtVerifier` + `HonkVerifier`)
2. Deploy `RecoveryManager` implementation
3. Deploy `RecoveryManagerFactory` (with impl + verifier addresses)
4. Per wallet: call factory to deploy a `RecoveryManager` proxy
