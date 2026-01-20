# zkJWT Circuit

Noir circuit for zkJWT guardian authentication. Verifies JWT signatures and outputs a commitment hiding the guardian's email.

## Quick Start

```bash
# Generate test inputs (self-signed JWT)
cd scripts && npm install && npm run generate

# Run circuit
cd .. && nargo execute
```

## Directory Structure

```
zkjwt/
├── src/main.nr          # Main circuit
├── Nargo.toml           # Circuit dependencies (noir-jwt, poseidon)
├── Prover.toml          # Circuit inputs (generated)
└── scripts/             # TypeScript input generators
    ├── src/
    │   ├── generate-prover.ts      # CLI entry point
    │   ├── utils/                  # RSA, JWT, Poseidon, TOML utilities
    │   └── fixtures/self-signed.ts # Self-signed JWT generator
    └── package.json
```

## Scripts Usage

```bash
cd scripts

# Default (alice@test.com, salt=12345)
npm run generate

# Custom values
npm run generate -- --email="bob@example.com" --salt=54321 --intent-hash=123
```

Output: Writes `../Prover.toml` and prints expected commitment.

## Circuit I/O

**Public Inputs:**
- `pubkey_modulus_limbs` - RSA public key (identifies signing key)
- `_intent_hash` - Binds proof to specific RecoveryIntent (use 0 for testing)

**Output:**
- `commitment` - `Poseidon2(email_hash, salt)` identifying the guardian

## Notes for Future Work

- **Google JWT integration**: Replace self-signed fixture with real Google OAuth flow. Key difference: must fetch Google's JWKS for public key.
- **SDK integration**: The `scripts/src/utils/` modules can be adapted for the SDK's `ZkJwtAdapter`.
- **Commitment pre-computation**: `poseidon.ts` shows how to compute commitments off-chain for guardian registration.
