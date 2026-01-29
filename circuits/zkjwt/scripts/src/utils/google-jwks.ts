/**
 * Google JWKS utilities for fetching public keys and decoding JWTs
 */

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

/**
 * Decode the JWT header (first segment) without verification
 *
 * @param jwt - The raw JWT string
 * @returns Parsed header with alg and kid fields
 */
export function decodeJwtHeader(jwt: string): { alg: string; kid: string } {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format: expected 3 dot-separated segments");
  }
  const headerJson = Buffer.from(parts[0], "base64url").toString("utf-8");
  return JSON.parse(headerJson);
}

/**
 * Decode the JWT payload (second segment) without verification
 *
 * @param jwt - The raw JWT string
 * @returns Parsed claims object
 */
export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format: expected 3 dot-separated segments");
  }
  const payloadJson = Buffer.from(parts[1], "base64url").toString("utf-8");
  return JSON.parse(payloadJson);
}

/**
 * Fetch Google's JWKS and return the JWK matching the given kid
 *
 * @param kid - The key ID from the JWT header
 * @returns The matching JsonWebKey
 * @throws If no key matches the kid
 */
export async function fetchGoogleJwk(kid: string): Promise<JsonWebKey> {
  const response = await fetch(GOOGLE_JWKS_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Google JWKS: ${response.status} ${response.statusText}`
    );
  }

  const jwks: { keys: (JsonWebKey & { kid?: string })[] } =
    await response.json();

  const match = jwks.keys.find((k) => k.kid === kid);
  if (!match) {
    const availableKids = jwks.keys.map((k) => k.kid).join(", ");
    throw new Error(
      `No Google JWK found for kid="${kid}". Available kids: ${availableKids}`
    );
  }

  return match;
}
