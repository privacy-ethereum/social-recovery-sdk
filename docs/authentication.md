# Authentication Methods

The SDK supports three authentication methods for guardians, each with different tradeoffs.

## Comparison

| Method | Privacy | UX | Setup Complexity | Gas Cost |
|--------|---------|----|--------------------|----------|
| EOA | Low (address revealed) | Requires wallet | Simple | Lowest |
| Passkey | Medium (pubkey revealed) | Biometric/PIN | Medium | Medium |
| zkJWT | High (email hidden) | OAuth familiar | Complex | Highest |

## EOA (Externally Owned Account)

Traditional Ethereum signatures using ECDSA.

### Setup
```typescript
// Guardian provides their Ethereum address
const guardian = {
  type: GuardianType.EOA,
  identifier: ethers.utils.hexZeroPad(guardianAddress, 32)
};
```

### Proof Generation
```typescript
// Guardian signs EIP-712 typed data
const domain = {
  name: "SocialRecovery",
  version: "1",
  chainId: chainId,
  verifyingContract: recoveryManagerAddress
};

const types = {
  RecoveryIntent: [
    { name: "wallet", type: "address" },
    { name: "newOwner", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "chainId", type: "uint256" },
    { name: "recoveryManager", type: "address" }
  ]
};

const signature = await signer._signTypedData(domain, types, intent);
```

### Verification (On-Chain)
```solidity
// ecrecover extracts signer address
address signer = ECDSA.recover(intentHash, signature);
require(signer == guardian.identifier, "Invalid signature");
```

## Passkey (WebAuthn / P-256)

Browser-native passwordless authentication using platform authenticators.

### Setup
```typescript
// Guardian creates a passkey
const credential = await navigator.credentials.create({
  publicKey: {
    challenge: randomBytes(32),
    rp: { name: "Social Recovery" },
    user: { id: userId, name: userEmail, displayName: userName },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256 (P-256)
    authenticatorSelection: { userVerification: "required" }
  }
});

// Extract public key coordinates
const { x: pubKeyX, y: pubKeyY } = extractP256PublicKey(credential);

// Store hash as identifier
const guardian = {
  type: GuardianType.Passkey,
  identifier: keccak256(concat(pubKeyX, pubKeyY))
};
```

### Proof Generation
```typescript
// Guardian authenticates with their device
const assertion = await navigator.credentials.get({
  publicKey: {
    challenge: intentHash, // Recovery intent hash as challenge
    allowCredentials: [{ type: "public-key", id: credentialId }],
    userVerification: "required"
  }
});

const proof = {
  authenticatorData: assertion.response.authenticatorData,
  clientDataJSON: assertion.response.clientDataJSON,
  signature: assertion.response.signature,
  pubKeyX,
  pubKeyY
};
```

### Verification (On-Chain)
```solidity
// 1. Hash public key and compare to stored identifier
bytes32 pubKeyHash = keccak256(abi.encodePacked(pubKeyX, pubKeyY));
require(pubKeyHash == guardian.identifier, "Unknown passkey");

// 2. Verify P-256 signature
// Uses RIP-7212 precompile (0x100) if available, fallback otherwise
bool valid = P256Verifier.verify(messageHash, r, s, pubKeyX, pubKeyY);
```

## zkJWT (Zero-Knowledge JWT)

OAuth-based authentication with privacy — email never revealed on-chain.

### Setup
```typescript
// Owner enters guardian's email and generates salt
const guardianEmail = "guardian@example.com";
const salt = randomField();

// Compute Poseidon2 commitment (SNARK-friendly hash)
// email_hash = Poseidon2(packed_email_fields, email_len)
// commitment = Poseidon2(email_hash, salt)
const commitment = computeEmailCommitment(guardianEmail, salt);

const guardian = {
  type: GuardianType.ZkJWT,
  identifier: commitment
};

// Owner must share salt with guardian out-of-band (email, Signal, etc.)
// Guardian stores: { email, salt, walletAddress }
```

### Proof Generation
```typescript
// 1. Guardian authenticates with OAuth provider (Google)
const jwt = await oauthFlow.getIdToken();

// 2. Generate ZK proof using Noir circuit
const proof = await generateZkProof({
  // Private inputs
  jwt,
  email: guardianEmail,
  salt,

  // Public inputs
  commitment,          // Must match stored identifier
  intentHash,          // Binds proof to this recovery
  googlePublicKey      // For JWT signature verification
});
```

### What the Circuit Proves
1. "I have a valid JWT signed by Google" (verified via RSA public key)
2. "The JWT's `email_verified` claim is `true`"
3. "The JWT contains email X matching my private input"
4. "`Poseidon2(Poseidon2(email), salt) == commitment`"

Without revealing: the email address or the JWT contents. The `intent_hash` public input binds the proof to a specific recovery session.

### Verification (On-Chain)
```solidity
// Noir verifier checks the ZK proof
// Public inputs: RSA pubkey modulus (18 limbs), intent_hash
// Return value: commitment
Field returnedCommitment = zkJwtVerifier.verify(
  proof,
  pubkeyModulusLimbs,  // Identifies Google signing key
  intentHash           // Binds to recovery session
);
require(returnedCommitment == guardian.identifier, "Invalid commitment");
```

## Choosing an Auth Method

**Use EOA when:**
- Guardian is technically sophisticated
- Guardian already has an Ethereum wallet
- Simplicity is prioritized over privacy

**Use Passkey when:**
- Guardian is non-technical
- Mobile/biometric auth preferred
- Moderate privacy acceptable

**Use zkJWT when:**
- Privacy is critical
- Guardian only has email (Google account)
- Willing to accept higher complexity and gas costs
