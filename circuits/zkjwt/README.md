# zkJWT Circuit

Noir circuit for zkJWT guardian authentication. Verifies JWT signatures and outputs a commitment hiding the guardian's email.

## Quick Start

```bash
# Generate test inputs (self-signed JWT)
cd scripts && npm install && npm run generate

# Execute circuit (generates witness)
cd .. && nargo execute

# Generate proof and verification key
bb prove -b ./target/zkjwt.json -w ./target/zkjwt.gz --write_vk -o target -t evm

# Verify proof
bb verify -p ./target/proof -k ./target/vk
```

**Note:** Ensure `bb` version is compatible with your `nargo` version. Run `bbup` to auto-install the correct version.

## Directory Structure

```
zkjwt/
├── src/main.nr          # Main circuit
├── Nargo.toml           # Circuit dependencies (noir-jwt, poseidon)
├── Prover.toml          # Circuit inputs (generated)
├── target/              # Generated artifacts (proof, public_inputs, vk, vk_hash, etc.)
└── scripts/             # TypeScript input generators
    ├── src/
    │   ├── generate-prover.ts        # CLI entry point
    │   ├── utils/                    # RSA, JWT, Poseidon, TOML utilities
    │   │   ├── rsa.ts               # RSA key parsing and modulus extraction
    │   │   ├── jwt.ts               # JWT encoding and signature utilities
    │   │   ├── poseidon.ts          # Poseidon hash for commitment computation
    │   │   ├── prover-toml.ts       # Prover.toml generation
    │   │   └── google-jwks.ts       # Google JWKS fetch + JWT decode helpers
    │   └── fixtures/
    │       ├── self-signed.ts        # Self-signed JWT generator
    │       └── google-signed.ts      # Google-signed JWT fixture
    └── package.json
```

## Scripts Usage

```bash
cd scripts

# Default (alice@test.com, salt=12345)
npm run generate

# Custom values
npm run generate -- --email="bob@example.com" --salt=54321 --intent-hash=42
```

Output: Writes `../Prover.toml` and prints expected commitment.

## Testing with Google-Signed JWT

You can generate `Prover.toml` from a real Google-signed JWT to test the circuit against production keys.

### 1. Obtain a Google `id_token`

1. Go to [Google OAuth Playground](https://developers.google.com/oauthplayground/)
2. In **Step 1**, select **Google OAuth2 API v2** → `email` and `openid` scopes
3. Click **Authorize APIs** and sign in with your Google account
4. In **Step 2**, click **Exchange authorization code for tokens**
5. Copy the `id_token` from the response

### 2. Generate Prover.toml

```bash
cd scripts

npm run generate:google -- --jwt="<paste id_token here>" --salt=12345 --intent-hash=1
```

### 3. Prove and verify

```bash
cd ..
nargo execute
bb prove -b ./target/zkjwt.json -w ./target/zkjwt.gz --write_vk -o target -t evm
bb verify -p ./target/proof -k ./target/vk
```

**Notes:**
- By default, the generator now rejects expired tokens and `email_verified !== true` to avoid opaque constraint failures.
- If you intentionally want unsafe debug fixtures, pass `--allow-insecure-claims`.
- The JWT must contain an `email` claim. This requires the `email` scope during OAuth authorization.

## Circuit I/O

**Public Inputs:**
- `pubkey_modulus_limbs` - RSA public key (identifies signing key)
- `intent_hash` - Binds proof to specific RecoveryIntent (must be non-zero). This is a Noir `Field` element (BN254 scalar field, ~254 bits). When using a real EIP-712 hash (256-bit keccak256), it **must be reduced modulo the BN254 scalar field modulus** (`p = 21888242871839275222246405745257275088548364400416034343698204186575808495617`) before being passed to the circuit. The same reduction is applied by `ZkJwtVerifier.sol` on-chain.

**Output:**
- `commitment` - `Poseidon2(email_hash, salt)` identifying the guardian

## Notes for Future Work

- **SDK integration**: The `scripts/src/utils/` modules can be adapted for the SDK's `ZkJwtAdapter`.
- **Commitment pre-computation**: `poseidon.ts` shows how to compute commitments off-chain for guardian registration.
