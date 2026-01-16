# Noir-JWT Library - Technical Specification

This document provides a comprehensive explanation of the `noir-jwt` library, a Noir circuit implementation for zero-knowledge JWT verification.

## Overview

**noir-jwt** is a Noir library that enables zero-knowledge proof verification of JSON Web Tokens (JWTs). It allows a prover to demonstrate possession of a valid JWT signed by a trusted issuer without revealing the entire token contents.

**Current Version:** 0.5.1
**Supported Algorithms:** RS256 (RSA 2048-bit with SHA-256) only
**Repository:** https://github.com/zkemail/noir-jwt

---

## JWT Background

A JWT consists of three base64url-encoded parts separated by dots:

```
JWT = base64url(header).base64url(payload).base64url(signature)
```

**Example:**
```
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJlbWFpbCI6InVzZXJAZ21haWwuY29tIn0.SIGNATURE
```

- **Header:** Contains algorithm (`alg: "RS256"`) and token type (`typ: "JWT"`)
- **Payload:** Contains claims as JSON key-value pairs (e.g., `iss`, `sub`, `email`, `iat`, `exp`)
- **Signature:** RSA-SHA256 signature over `base64url(header).base64url(payload)`

---

## Library Architecture

### File Structure

```
noir-jwt/
├── src/
│   ├── lib.nr           # Main JWT circuit implementation
│   └── partial_hash.nr  # SHA-256 partial hashing utilities
├── js/
│   └── src/
│       ├── generate-inputs.ts  # TypeScript input generator
│       └── partial-sha.ts      # JS SHA-256 block compression
├── Nargo.toml           # Package configuration
└── README.md
```

### Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `rsa` | v0.9.1 | RSA signature verification (from zkpassport/noir_rsa) |
| `sha256` | v0.2.1 | SHA-256 hashing |
| `base64` | v0.4.2 | Base64 URL decoding |
| `string_search` | v0.3.3 | String matching for claim extraction |
| `bignum` | v0.8.0 | Big integer operations for RSA |
| `nodash` | v0.42.0 | String to u64 conversion |

---

## Core Data Structure

```noir
pub struct JWT<let MAX_DATA_LENGTH: u32> {
    data: BoundedVec<u8, MAX_DATA_LENGTH>,     // Signed JWT data (header.payload as ASCII bytes)
    pubkey_modulus_limbs: [u128; 18],          // RSA public key modulus (2048 bits in 18 limbs)
    redc_params_limbs: [u128; 18],             // REDC parameters for bignum library
    signature_limbs: [u128; 18],               // RSA signature (2048 bits in 18 limbs)
    partial_hash: [u32; 8],                    // Intermediate SHA-256 state (if using partial hash)
    full_data_length: u32,                     // Total length of signed data
    base64_decode_offset: u32,                 // Offset for base64 decoding optimization
    is_partial_hash: bool,                     // Whether partial hash mode is enabled
}
```

### Limb Representation

Large integers (2048-bit RSA values) are split into 18 limbs of ~120 bits each:
- **pubkey_modulus_limbs:** RSA public key modulus N
- **redc_params_limbs:** Precomputed reduction parameters for Montgomery multiplication
- **signature_limbs:** The JWT signature

---

## Initialization Methods

### 1. Standard Initialization (`init`)

For full JWT verification where the entire signed data is hashed in-circuit:

```noir
pub fn init(
    data: BoundedVec<u8, MAX_DATA_LENGTH>,       // Signed data (header.payload)
    base64_decode_offset: u32,                    // Offset to start base64 decoding
    pubkey_modulus_limbs: [u128; 18],
    redc_params_limbs: [u128; 18],
    signature_limbs: [u128; 18],
) -> JWT<MAX_DATA_LENGTH>
```

### 2. Partial Hash Initialization (`init_with_partial_hash`)

For optimized verification where part of the SHA-256 is precomputed outside the circuit:

```noir
pub fn init_with_partial_hash(
    partial_data: BoundedVec<u8, MAX_DATA_LENGTH>,  // Data after partial hash cutoff
    partial_hash: [u32; 8],                          // Intermediate SHA-256 state
    full_data_length: u32,                           // Total length before partial hash
    base64_decode_offset: u32,                       // 1, 2, or 3 for alignment
    pubkey_modulus_limbs: [u128; 18],
    redc_params_limbs: [u128; 18],
    signature_limbs: [u128; 18],
) -> JWT<MAX_DATA_LENGTH>
```

---

## Signature Verification

The `verify()` method performs RSA-SHA256 signature verification:

```noir
pub fn verify(mut self) {
    let mut data_hash: [u8; 32] = [0; 32];

    if (!self.is_partial_hash) {
        // Full SHA-256 hash of signed data
        data_hash = sha256_var(self.data.storage(), self.data.len() as u64);
    } else {
        // Complete SHA-256 from partial state
        data_hash = partial_sha256_var_end(
            self.partial_hash,
            self.data.storage(),
            self.data.len() as u64,
            self.full_data_length as u64,
        );
    }

    // RSA verification with PKCS#1 v1.5 padding
    let params: BigNumParams<18, 2048> =
        BigNumParams::new(false, self.pubkey_modulus_limbs, self.redc_params_limbs);
    let signature = RuntimeBigNum { params, limbs: self.signature_limbs };

    // Public exponent is hardcoded to 65537 (standard RSA)
    assert(verify_sha256_pkcs1v15(data_hash, signature, 65537));
}
```

---

## Claim Extraction Methods

### String Claims

```noir
// Extract string claim value
pub fn get_claim_string<let KEY_LENGTH: u32, let MAX_VALUE_LENGTH: u32>(
    self,
    claim_key: [u8; KEY_LENGTH],
) -> BoundedVec<u8, MAX_VALUE_LENGTH>

// Assert string claim matches expected value
pub fn assert_claim_string<let KEY_LENGTH: u32, let MAX_VALUE_LENGTH: u32>(
    self,
    claim_key: [u8; KEY_LENGTH],
    claim_value: BoundedVec<u8, MAX_VALUE_LENGTH>,
)
```

**Example:**
```noir
let email: BoundedVec<u8, 100> = jwt.get_claim_string("email".as_bytes());
// For "email": "alice@test.com", returns "alice@test.com"
```

### Number Claims (u64)

```noir
pub fn get_claim_number<let KEY_LENGTH: u32>(self, claim_key: [u8; KEY_LENGTH]) -> u64

pub fn assert_claim_number<let KEY_LENGTH: u32>(
    self,
    claim_key: [u8; KEY_LENGTH],
    claim_value: u64,
)
```

**Example:**
```noir
let iat: u64 = jwt.get_claim_number("iat".as_bytes());
// For "iat": 1737642217, returns 1737642217
```

### Boolean Claims

```noir
pub fn get_claim_bool<let KEY_LENGTH: u32>(self, claim_key: [u8; KEY_LENGTH]) -> bool

pub fn assert_claim_bool<let KEY_LENGTH: u32>(
    self,
    claim_key: [u8; KEY_LENGTH],
    claim_value: bool,
)
```

**Example:**
```noir
let verified: bool = jwt.get_claim_bool("email_verified".as_bytes());
// For "email_verified": true, returns true
```

---

## Internal Claim Extraction Flow

1. **Base64 Decode Payload:**
   - Apply `base64_decode_offset` to skip header/irrelevant bytes
   - Decode remaining base64 to get JSON payload

2. **Search for Claim Key:**
   - Wrap key in quotes: `"key"`
   - Use `string_search` library to find position in payload

3. **Extract Value:**
   - Use unconstrained function for value extraction (optimization)
   - Verify extracted value exists at correct position
   - Check proper JSON structure (colon, quotes for strings, terminators)

4. **Verify Terminators:**
   - Assert value is followed by `,` (comma) or `}` (closing brace)

---

## Partial SHA-256 Optimization

SHA-256 operates on 64-byte blocks. The partial hash feature allows pre-computing hash blocks outside the circuit:

### How It Works

1. **Outside Circuit (JS SDK):**
   - Hash complete 64-byte blocks up to a boundary before the claim of interest
   - Return intermediate hash state (8 u32 words) and remaining data

2. **Inside Circuit:**
   - Continue hashing from the intermediate state
   - Finalize hash with padding and length
   - Verify RSA signature

### Constraint Savings

- **Full SHA-256:** ~90,000+ constraints for typical JWT
- **Partial SHA-256:** ~20,000+ constraints (only hash finalization)

### Base64 Decode Offset for Partial Hash

When using partial hash, the remaining data may not align with base64 boundaries. The `base64_decode_offset` should be 1, 2, or 3 to make the data decodable:

```
offset = 4 - (payloadBytesInShaPrecompute % 4)
```

---

## Public vs Private Inputs

### Typical Public Inputs
- `pubkey_modulus_limbs` - RSA public key (identifies the issuer)
- Asserted claim values (what the prover is claiming)

### Typical Private Inputs
- `data` / `partial_data` - The actual JWT signed data
- `signature_limbs` - RSA signature
- `redc_params_limbs` - Derived from pubkey (can be computed)
- `partial_hash` - Intermediate hash state (if using partial hash)
- `base64_decode_offset` - Optimization parameter

---

## JavaScript SDK

### Installation

```bash
npm install noir-jwt
```

### Input Generation

```typescript
import { generateInputs } from 'noir-jwt';

const inputs = await generateInputs({
  jwt: "eyJhbGciOi...",           // Full JWT string
  pubkey: jsonWebKey,             // RSA public key in JWK format
  maxSignedDataLength: 900,       // Must match circuit parameter
  shaPrecomputeTillKeys: ["email"] // Optional: claims for partial hash
});
```

### Output Structure

```typescript
interface JWTCircuitInputs {
  // Without partial hash:
  data?: { storage: number[]; len: number };

  // With partial hash:
  partial_data?: { storage: number[]; len: number };
  partial_hash?: number[];        // [u32; 8]
  full_data_length?: number;

  // Always present:
  base64_decode_offset: number;
  pubkey_modulus_limbs: string[]; // [Field; 18]
  redc_params_limbs: string[];    // [Field; 18]
  signature_limbs: string[];      // [Field; 18]
}
```

---

## Real-World JWT Compatibility

### Google OAuth JWT Example

```json
{
  "header": {
    "alg": "RS256",
    "typ": "JWT",
    "kid": "abc123..."
  },
  "payload": {
    "iss": "https://accounts.google.com",
    "sub": "110169547456...",
    "email": "user@gmail.com",
    "email_verified": true,
    "iat": 1234567890,
    "exp": 1234571490
  }
}
```

### Compatible Providers
- Google (accounts.google.com)
- Auth0
- Okta
- Any provider using RS256 with 2048-bit keys

---

## Limitations and Constraints

### Algorithm Support
- **Only RS256** (RSA 2048-bit with SHA-256)
- Fixed public exponent: 65537
- No support for HS256, RS384, RS512, ES256, etc.

### Claim Extraction
- **Claim keys must be known at compile time** (no runtime key selection)
- No support for nested JSON objects or arrays
- Claims must be at the root level of the payload JSON
- Values must be terminated by `,` or `}`

### Data Size
- `MAX_DATA_LENGTH` parameter limits JWT size
- Typical values: 512-900 bytes for signed data
- Partial hash allows larger JWTs with same constraint count

### JSON Structure Requirements
- Standard JSON format (no trailing commas, etc.)
- String values must be quoted
- Number values must be unquoted integers (up to u64)
- Boolean values: exactly `true` or `false`

---

## Usage Example: Email Verification Circuit

For your use case (proving email ownership with provider as public input):

```noir
use jwt::JWT;

global MAX_DATA_LENGTH: u32 = 900;
global MAX_EMAIL_LENGTH: u32 = 100;
global MAX_PROVIDER_LENGTH: u32 = 50;

fn main(
    // Private inputs
    data: BoundedVec<u8, MAX_DATA_LENGTH>,
    base64_decode_offset: u32,
    redc_params_limbs: [Field; 18],
    signature_limbs: [Field; 18],

    // Public inputs
    pubkey_modulus_limbs: pub [Field; 18],  // Identifies provider
    email_domain: pub BoundedVec<u8, MAX_PROVIDER_LENGTH>,  // e.g., "gmail.com"
) {
    let jwt: JWT<MAX_DATA_LENGTH> = JWT::init(
        data,
        base64_decode_offset,
        pubkey_modulus_limbs,
        redc_params_limbs,
        signature_limbs,
    );

    // Verify the JWT signature
    jwt.verify();

    // Extract the email claim
    let email: BoundedVec<u8, MAX_EMAIL_LENGTH> = jwt.get_claim_string("email".as_bytes());

    // Verify email domain matches (you'd implement domain extraction logic)
    // This keeps the username private while proving the domain
}
```

---

## Test Data Reference

The library includes test data with the following payload:

```json
{
  "iss": "http://test.com",
  "sub": "ABCD123123",
  "email_verified": true,
  "nonce": "123123123",
  "email": "alice@test.com",
  "iat": 1737642217,
  "aud": "123123123.456456456",
  "exp": 1799999999
}
```

---

## Summary Table

| Feature | Details |
|---------|---------|
| **Algorithm** | RS256 (RSA-2048-SHA256) only |
| **Key Size** | 2048 bits fixed |
| **Limb Representation** | 18 limbs of ~120 bits each |
| **SHA-256 Mode** | Full or partial (precomputed blocks) |
| **Claim Types** | String, Number (u64), Boolean |
| **Claim Keys** | Compile-time constants only |
| **Max JWT Size** | Configurable via `MAX_DATA_LENGTH` |
| **Constraint Reduction** | Partial SHA + base64 offset optimization |
| **Provider Compatibility** | Google, Auth0, Okta, any RS256 issuer |
