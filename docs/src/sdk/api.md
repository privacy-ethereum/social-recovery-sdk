# SDK API Reference

## `RecoveryClient`

Configuration:

- `publicClient` (required)
- `walletClient` (required for writes)
- `factoryAddress` (for deployments)
- `recoveryManagerAddress` (for recovery flows)

Deployment:

- `deployRecoveryManager(policy): Promise<Address>`

Recovery tx methods:

- `startRecovery({ intent, guardianIndex, proof })`
- `submitProof({ guardianIndex, proof })`
- `executeRecovery()`
- `cancelRecovery()`
- `clearExpiredRecovery()`
- `updatePolicy({ guardians, threshold, challengePeriod })`

Read/query methods:

- `getSession()`
- `isRecoveryActive()`
- `getPolicy()`
- `getNonce()`
- `isReadyToExecute()`

Utility:

- `setRecoveryManager(address)`
- `getAuthManager()`

### Validation behaviors in `startRecovery`

Before tx submission, SDK checks:

- Intent addresses are non-zero
- `intent.recoveryManager` equals client RecoveryManager
- `intent.deadline > now + challengePeriod`
- For passkey proofs: required P-256 verifier bytecode exists

## `PolicyBuilder`

- `setWallet(address)`
- `addEoaGuardian(address)`
- `addPasskeyGuardian({x,y})`
- `addZkJwtGuardian(commitment)`
- `setThreshold(number|bigint)`
- `setChallengePeriod(number|bigint)`
- `build(): RecoveryPolicy`

`build()` rejects invalid policies (zero wallet, zero guardians, zero threshold, threshold > guardian count, duplicate/zero identifiers).

## `AuthManager`

- `registerAdapter(adapter)`
- `generateProof(guardianType, intent, guardianIdentifier)`
- `computeIdentifier(guardianType, credentials)`
- `getAdapter(...)`, `hasAdapter(...)`

## Adapters

- `EoaAdapter`
- `PasskeyAdapter`
- `ZkJwtAdapter`

All adapters implement:

- `computeIdentifier(credentials)`
- `generateProof(intent, guardianIdentifier)`

## EIP-712 helpers

- `hashRecoveryIntent(intent)`
- `createRecoveryIntent(params)`
- `isValidIntent(intent, options)`

`createRecoveryIntent` supports `challengePeriodSeconds` to enforce safe deadlines.
