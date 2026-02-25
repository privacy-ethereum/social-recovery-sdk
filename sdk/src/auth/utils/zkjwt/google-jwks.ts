export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

function decodeBase64UrlToUtf8(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);

  if (typeof atob === 'function') {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  const bufferCtor = (globalThis as { Buffer?: { from(value: string, encoding: string): Uint8Array } }).Buffer;
  if (bufferCtor) {
    return new TextDecoder().decode(bufferCtor.from(padded, 'base64'));
  }

  throw new Error('No base64 decoder available in this environment');
}

/**
 * Decode the JWT header (first segment) without verification
 */
export function decodeJwtHeader(jwt: string): { alg: string; kid: string } {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format: expected 3 dot-separated segments');
  }
  const headerJson = decodeBase64UrlToUtf8(parts[0]);
  return JSON.parse(headerJson);
}

/**
 * Decode the JWT payload (second segment) without verification
 */
export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format: expected 3 dot-separated segments');
  }
  const payloadJson = decodeBase64UrlToUtf8(parts[1]);
  return JSON.parse(payloadJson);
}

/**
 * Fetch Google's JWKS and return the JWK matching the given kid
 */
export async function fetchGoogleJwk(kid: string): Promise<JsonWebKey> {
  const response = await fetch(GOOGLE_JWKS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch Google JWKS: ${response.status} ${response.statusText}`);
  }

  const jwks: { keys: (JsonWebKey & { kid?: string })[] } = await response.json();

  const match = jwks.keys.find((k) => k.kid === kid);
  if (!match) {
    const availableKids = jwks.keys.map((k) => k.kid).join(', ');
    throw new Error(`No Google JWK found for kid="${kid}". Available kids: ${availableKids}`);
  }

  return match;
}
