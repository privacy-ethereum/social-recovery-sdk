/**
 * Google-signed JWT fixture generator
 *
 * Uses a real Google-signed JWT (e.g. from OAuth Playground) to produce
 * circuit inputs. Fetches Google's public key via JWKS.
 */
import {
  decodeJwtHeader,
  decodeJwtPayload,
  fetchGoogleJwk,
} from "../utils/google-jwks.js";
import { extractJwtInputs } from "../utils/jwt.js";
import {
  initBarretenberg,
  computeCommitment,
  frToHex,
} from "../utils/poseidon.js";
import { ZkJwtInputs } from "../utils/prover-toml.js";

export interface GoogleSignedFixtureOptions {
  jwt: string;
  salt: bigint;
  intentHash: bigint;
  /**
   * Allows generation to continue with invalid claims (debug-only).
   * Disabled by default to avoid opaque downstream circuit failures.
   */
  allowInsecureClaims?: boolean;
}

export interface GoogleSignedFixture {
  jwt: string;
  email: string;
  kid: string;
  inputs: ZkJwtInputs;
  expectedCommitment: string;
}

/**
 * Generate a circuit fixture from a real Google-signed JWT
 *
 * @param options - JWT string plus salt and intentHash
 * @returns Fixture with circuit inputs and expected commitment
 */
export async function generateGoogleSignedFixture(
  options: GoogleSignedFixtureOptions
): Promise<GoogleSignedFixture> {
  const { jwt, salt, intentHash, allowInsecureClaims = false } = options;

  // 1. Decode header to get kid
  const header = decodeJwtHeader(jwt);
  console.log(`  JWT alg: ${header.alg}, kid: ${header.kid}`);

  // 2. Fetch Google's public key
  console.log("  Fetching Google JWKS...");
  const jwk = await fetchGoogleJwk(header.kid);
  console.log("  Google public key fetched successfully.");

  // 3. Decode payload and extract email
  const payload = decodeJwtPayload(jwt);
  const email = payload.email as string | undefined;
  if (!email) {
    throw new Error(
      "JWT payload does not contain an 'email' claim. " +
        "Make sure you requested the 'email' scope in OAuth."
    );
  }

  if (payload.email_verified !== true) {
    if (!allowInsecureClaims) {
      throw new Error(
        "JWT payload has email_verified !== true. " +
          "Use a verified Google token or pass --allow-insecure-claims for explicit debug mode."
      );
    }
    console.warn("  ⚠ Warning: email_verified is not true in this JWT (allow-insecure-claims enabled).");
  }

  const exp = payload.exp as number | undefined;
  if (exp && exp < Math.floor(Date.now() / 1000)) {
    if (!allowInsecureClaims) {
      throw new Error(
        "JWT is expired. Use a fresh Google id_token or pass --allow-insecure-claims for explicit debug mode."
      );
    }
    console.warn("  ⚠ Warning: JWT is expired (allow-insecure-claims enabled).");
  }

  // 4. Extract circuit inputs (reuse existing utility)
  const maxDataLength = 900;
  const jwtInputs = extractJwtInputs(jwt, jwk, maxDataLength);

  // 5. Build ZkJwtInputs
  const emailBytes = Array.from(new TextEncoder().encode(email));

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

  // 6. Compute expected commitment
  const bb = await initBarretenberg();
  const commitment = computeCommitment(bb, email, salt);
  const expectedCommitment = frToHex(commitment);

  return {
    jwt,
    email,
    kid: header.kid,
    inputs,
    expectedCommitment,
  };
}
