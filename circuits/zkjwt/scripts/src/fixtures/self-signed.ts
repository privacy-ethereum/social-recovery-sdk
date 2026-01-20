/**
 * Self-signed JWT fixture generator for testing
 */
import {
  generateRsaKeyPair,
  exportPrivateKeyPem,
  exportPublicKeyPem,
} from "../utils/rsa.js";
import {
  createSignedJwt,
  verifyJwt,
  extractJwtInputs,
  JwtPayload,
} from "../utils/jwt.js";
import {
  initBarretenberg,
  computeCommitment,
  frToHex,
} from "../utils/poseidon.js";
import { ZkJwtInputs } from "../utils/prover-toml.js";

export interface SelfSignedFixtureOptions {
  email: string;
  salt: bigint;
  intentHash: bigint;
}

export interface SelfSignedFixture {
  // Generated key pair (for reproducibility/debugging)
  privateKeyPem: string;
  publicKeyPem: string;
  publicKeyJwk: JsonWebKey;

  // JWT
  jwt: string;
  jwtPayload: JwtPayload;

  // Circuit inputs
  inputs: ZkJwtInputs;

  // Expected output (for verification)
  expectedCommitment: string;
}

/**
 * Generate a complete test fixture with a fresh self-signed JWT
 *
 * @param options - Configuration options
 * @returns The complete fixture with all inputs and expected output
 */
export async function generateSelfSignedFixture(
  options: SelfSignedFixtureOptions
): Promise<SelfSignedFixture> {
  const { email, salt, intentHash } = options;

  // Generate RSA key pair
  const keyPair = generateRsaKeyPair();

  // Create JWT payload
  const now = Math.floor(Date.now() / 1000);
  const jwtPayload: JwtPayload = {
    iss: "https://test.example.com",
    sub: "user_12345",
    email,
    email_verified: true,
    iat: now,
    exp: now + 3600, // 1 hour from now
    aud: "test-client-id",
  };

  // Sign the JWT
  const jwt = createSignedJwt(jwtPayload, keyPair.privateKey);

  // Verify the JWT (sanity check)
  verifyJwt(jwt, keyPair.publicKey);

  // Extract circuit inputs from JWT
  const maxDataLength = 900; // Must match circuit's MAX_DATA_LENGTH
  const jwtInputs = extractJwtInputs(jwt, keyPair.publicKeyJwk, maxDataLength);

  // Convert email to byte array
  const emailBytes = Array.from(new TextEncoder().encode(email));

  // Build complete circuit inputs
  const inputs: ZkJwtInputs = {
    data: jwtInputs.data,
    dataLength: jwtInputs.dataLength,
    base64_decode_offset: jwtInputs.base64DecodeOffset,
    redc_params_limbs: jwtInputs.redcParamsLimbs,
    signature_limbs: jwtInputs.signatureLimbs,
    email: emailBytes,
    emailLength: emailBytes.length,
    salt,
    pubkey_modulus_limbs: jwtInputs.pubkeyModulusLimbs,
    intent_hash: intentHash,
  };

  // Compute expected commitment using Poseidon2
  const bb = await initBarretenberg();
  const commitment = computeCommitment(bb, email, salt);
  const expectedCommitment = frToHex(commitment);

  return {
    privateKeyPem: exportPrivateKeyPem(keyPair.privateKey),
    publicKeyPem: exportPublicKeyPem(keyPair.publicKey),
    publicKeyJwk: keyPair.publicKeyJwk,
    jwt,
    jwtPayload,
    inputs,
    expectedCommitment,
  };
}
