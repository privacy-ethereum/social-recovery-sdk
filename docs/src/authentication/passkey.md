# Passkey Guardians

Passkey guardians prove control of a WebAuthn credential (P-256 key).

## Identifier

```ts
identifier = keccak256(abi.encodePacked(pubKeyX, pubKeyY))
```

`PasskeyAdapter.computeIdentifier(publicKey)` computes this.

## Proof generation

`PasskeyAdapter.generateProof(intent, guardianIdentifier)`:

1. Validates identifier matches configured public key.
2. Uses `hashRecoveryIntent(intent)` as WebAuthn challenge.
3. Requests assertion (`navigator.credentials.get`).
4. Parses DER signature and encodes proof payload expected by `PasskeyVerifier`.

## Runtime dependency

Passkey verification depends on the deterministic `p256-verifier` deployment at:

`0xc2b78104907F722DABAc4C69f826a522B2754De4`

`RecoveryClient` checks code exists at this address before sending passkey proof txs.

If missing, passkey start/submit operations fail early with a descriptive error.
