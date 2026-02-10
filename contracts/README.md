# Contracts

Solidity smart contracts for social recovery. Manages guardian policies, recovery sessions, and on-chain proof verification.

## Quick Start

```bash
forge install && forge build && forge test
```

## Deployment (Sepolia / EVM Chains)

`HonkVerifier` exceeds EIP-170 with default compiler settings. Use the size-optimized deploy profile:

```bash
FOUNDRY_PROFILE=deploy forge build
```

Automated deployment script:

```bash
cd contracts
CHAIN="sepolia" RPC_URL="$SEPOLIA_RPC_URL" PRIVATE_KEY="$DEPLOYER_PRIVATE_KEY" ETHERSCAN_API_KEY="$ETHERSCAN_API_KEY" ./scripts/deploy.sh
```

`PasskeyVerifier` depends on the P-256 verifier contract at the deterministic address
`0xc2b78104907F722DABAc4C69f826a522B2754De4`. The deploy script now checks that
bytecode exists there and fails fast if missing, with instructions to deploy it first
via `lib/p256-verifier/script/deploy.sh`.

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
│   ├── mocks/
│   │   ├── MockRecoveryWallet.sol       # Minimal wallet used by SDK e2e tests
│   │   └── P256VerifierStub.sol         # Local Anvil stub for EIP-7212 verifier predeploy
│   └── verifiers/
│       ├── PasskeyVerifier.sol          # WebAuthn/P-256 signature verification
│       ├── ZkJwtVerifier.sol            # Wraps HonkVerifier, implements IVerifier
│       └── HonkVerifier.sol             # Auto-generated Noir proof verifier
├── scripts/
│   └── deploy.sh                        # Deploy script for verifier stack + factory
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
