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
  const { jwt, salt, intentHash } = options;

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
    console.warn("  ⚠ Warning: email_verified is not true in this JWT.");
  }

  const exp = payload.exp as number | undefined;
  if (exp && exp < Math.floor(Date.now() / 1000)) {
    console.warn(
      "  ⚠ Warning: JWT is expired. The circuit does not check expiry, so this is OK for testing."
    );
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
