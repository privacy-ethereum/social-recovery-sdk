import { splitBigIntToLimbs, computeRedcParams, extractModulusFromJwk } from './rsa';

export interface JwtInputs {
  data: number[];
  dataLength: number;
  base64DecodeOffset: number;
  signatureLimbs: bigint[];
  pubkeyModulusLimbs: bigint[];
  redcParamsLimbs: bigint[];
}

function decodeBase64UrlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);

  if (typeof atob === 'function') {
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }

  const bufferCtor = (globalThis as { Buffer?: { from(value: string, encoding: string): Uint8Array } }).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(padded, 'base64');
  }

  throw new Error('No base64 decoder available in this environment');
}

/**
 * Extract circuit inputs from a JWT
 *
 * @param jwt - The JWT string
 * @param publicKeyJwk - The public key in JWK format
 * @param maxDataLength - Maximum length for the data array (default 900)
 * @returns The circuit inputs
 */
export function extractJwtInputs(
  jwt: string,
  publicKeyJwk: JsonWebKey,
  maxDataLength: number = 900,
): JwtInputs {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [headerB64] = parts;
  const signatureBase64Url = parts[2];

  // Extract signed data as byte array (header.payload)
  const signedDataString = parts.slice(0, 2).join('.');
  const signedData = new TextEncoder().encode(signedDataString);

  if (signedData.length > maxDataLength) {
    throw new Error(
      `Signed data length (${signedData.length}) exceeds maxDataLength (${maxDataLength})`,
    );
  }

  // Pad signed data to maxDataLength
  const signedDataPadded = new Uint8Array(maxDataLength);
  signedDataPadded.set(signedData);

  // Extract signature as BigInt
  const signatureBytes = decodeBase64UrlToBytes(signatureBase64Url);
  const signatureHex = Array.from(signatureBytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const signatureBigInt = BigInt(`0x${signatureHex || '0'}`);

  // Extract pubkey modulus as BigInt
  const pubkeyBigInt = extractModulusFromJwk(publicKeyJwk);

  // Compute REDC params
  const redcParam = computeRedcParams(pubkeyBigInt);

  // Compute base64 decode offset (index of payload start, after the first '.')
  const base64DecodeOffset = headerB64.length + 1;

  return {
    data: Array.from(signedDataPadded),
    dataLength: signedData.length,
    base64DecodeOffset,
    signatureLimbs: splitBigIntToLimbs(signatureBigInt),
    pubkeyModulusLimbs: splitBigIntToLimbs(pubkeyBigInt),
    redcParamsLimbs: splitBigIntToLimbs(redcParam),
  };
}
