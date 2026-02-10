# zkJWT Guardians

zkJWT guardians use an email-based commitment and zero-knowledge proof.

## Identifier

```text
email_hash = Poseidon2(packed_email_fields, email_len)
identifier = Poseidon2(email_hash, salt)
```

This `identifier` is the on-chain guardian value.

## Proof generation in SDK

`ZkJwtAdapter.generateProof(intent, guardianIdentifier)`:

1. Decodes JWT and reads `email`
2. Recomputes commitment and checks it equals `guardianIdentifier`
3. Resolves JWT signing key (injected JWK or fetched Google JWKS)
4. Computes `intent_hash = hashRecoveryIntent(intent) % BN254_SCALAR_FIELD_MODULUS`
5. Generates Noir/UltraHonk proof
6. Encodes `(rawProof, bytes32[18] modulusLimbs)` for `ZkJwtVerifier`

## Circuit/public input binding

On-chain verifier expects public inputs in this order:

- `[0..17]` RSA modulus limbs
- `[18]` reduced intent hash
- `[19]` guardian commitment

## Claim handling notes

- Circuit enforces `email_verified == true`.
- Commitment is intentionally time-independent.
- Current circuit design does not enforce JWT `exp`.
- Input generator now rejects expired/unverified Google tokens by default; use `--allow-insecure-claims` only for explicit debug workflows.
