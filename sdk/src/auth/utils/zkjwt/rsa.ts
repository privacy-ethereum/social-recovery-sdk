import crypto, { type KeyObject } from 'crypto';

export interface RsaKeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicKeyJwk: JsonWebKey;
}

/**
 * Generate a fresh RSA 2048-bit key pair
 */
export function generateRsaKeyPair(): RsaKeyPair {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 65537,
  });

  const publicKeyJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;

  return { privateKey, publicKey, publicKeyJwk };
}

/**
 * Split a BigInt into fixed-size chunks (limbs)
 * Splits into 18 limbs of 120 bits each by default
 */
export function splitBigIntToLimbs(
  bigInt: bigint,
  chunkSize: number = 120,
  numChunks: number = 18,
): bigint[] {
  const chunks: bigint[] = [];
  const mask = (1n << BigInt(chunkSize)) - 1n;

  for (let i = 0; i < numChunks; i++) {
    const chunk = (bigInt >> (BigInt(i) * BigInt(chunkSize))) & mask;
    chunks.push(chunk);
  }

  return chunks;
}

/**
 * Compute Montgomery reduction parameters for the bignum library
 * Formula: (1 << (2 * 2048 + 4)) / modulus
 */
export function computeRedcParams(modulus: bigint): bigint {
  return (1n << (2n * 2048n + 4n)) / modulus;
}

/**
 * Extract the modulus from a JWK public key
 */
export function extractModulusFromJwk(jwk: JsonWebKey): bigint {
  if (!jwk.n) {
    throw new Error('JWK does not contain modulus (n)');
  }

  const base64 = jwk.n.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Buffer.from(base64, 'base64');
  return BigInt('0x' + bytes.toString('hex'));
}

/**
 * Export a KeyObject to PEM format (private key)
 */
export function exportPrivateKeyPem(privateKey: KeyObject): string {
  return privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
}

/**
 * Export a KeyObject to PEM format (public key)
 */
export function exportPublicKeyPem(publicKey: KeyObject): string {
  return publicKey.export({ type: 'spki', format: 'pem' }) as string;
}
