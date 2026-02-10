# Core Concepts

## Guardian

A guardian is an identity that can approve recovery. Each guardian has:

- `guardianType` (`EOA`, `Passkey`, `ZkJWT`)
- `identifier` (`bytes32`)

Identifier formats:

- `EOA`: `bytes32(uint256(uint160(address)))`
- `Passkey`: `keccak256(pubKeyX || pubKeyY)`
- `ZkJWT`: `Poseidon2(email_hash, salt)`

## Recovery policy

A policy is configured per wallet and includes:

- `guardians[]`
- `threshold` (`N` of `M`)
- `challengePeriod` (seconds)

## Recovery intent

Guardians sign/prove over an EIP-712 `RecoveryIntent`:

- `wallet`
- `newOwner`
- `nonce`
- `deadline`
- `chainId`
- `recoveryManager`

This prevents replay across nonce/chain/contract and binds proofs to a specific ownership change.

## Recovery session

Only one active session per wallet is allowed. Session state tracks:

- `intentHash`
- `newOwner`
- `deadline`
- `thresholdMetAt`
- `approvalCount`

## Nonce and replay safety

`nonce` increments when a session is completed/canceled/cleared and when policy updates occur. Old proofs become invalid.

## Challenge period

After threshold is met, execution is delayed by `challengePeriod`. This gives the owner time to cancel malicious recovery.
