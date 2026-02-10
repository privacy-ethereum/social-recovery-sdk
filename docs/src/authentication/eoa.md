# EOA Guardians

EOA guardians sign the EIP-712 `RecoveryIntent`.

## Identifier

Computed as left-padded address:

```ts
identifier = bytes32(uint256(uint160(address)))
```

In SDK this is `EoaAdapter.computeIdentifier(address)`.

## Proof generation

`EoaAdapter.generateProof(intent, guardianIdentifier)`:

1. Checks adapter wallet address matches `guardianIdentifier`
2. Signs typed data using `walletClient.signTypedData`
3. Encodes `(v, r, s)` for contract submission

## On-chain verification

`RecoveryManager` decodes proof as `(uint8 v, bytes32 r, bytes32 s)` and verifies signer via `ecrecover`.
