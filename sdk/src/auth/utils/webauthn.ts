import { toHex, hexToBytes } from 'viem';
import type { Hex } from 'viem';
import type { P256PublicKey, PasskeyCredential } from '../../types';

/**
 * COSE key type for EC2 (Elliptic Curve)
 */
const COSE_KTY_EC2 = 2;

/**
 * COSE algorithm for ES256 (ECDSA with P-256 and SHA-256)
 */
const COSE_ALG_ES256 = -7;

/**
 * COSE curve identifier for P-256
 */
const COSE_CRV_P256 = 1;

/**
 * Parses a COSE public key to extract P-256 coordinates
 *
 * @param coseKey The COSE-encoded public key from WebAuthn registration
 * @returns The parsed P-256 public key coordinates
 * @throws Error if the key is invalid or not a P-256 key
 */
export function parseCosePublicKey(coseKey: ArrayBuffer): P256PublicKey {
  const bytes = new Uint8Array(coseKey);

  // COSE key is CBOR encoded. For P-256 keys, we expect:
  // Map with keys: 1 (kty), 3 (alg), -1 (crv), -2 (x), -3 (y)

  // Simple CBOR parsing for the specific structure we expect
  // This is a simplified parser that handles the common case
  const decoded = decodeCborMap(bytes);

  // Validate key type
  if (decoded.get(1) !== COSE_KTY_EC2) {
    throw new Error('Invalid COSE key type: expected EC2');
  }

  // Validate algorithm
  if (decoded.get(3) !== COSE_ALG_ES256) {
    throw new Error('Invalid COSE algorithm: expected ES256');
  }

  // Validate curve
  if (decoded.get(-1) !== COSE_CRV_P256) {
    throw new Error('Invalid COSE curve: expected P-256');
  }

  // Extract coordinates
  const xBytes = decoded.get(-2) as Uint8Array;
  const yBytes = decoded.get(-3) as Uint8Array;

  if (!xBytes || !yBytes || xBytes.length !== 32 || yBytes.length !== 32) {
    throw new Error('Invalid COSE key coordinates');
  }

  return {
    x: bytesToBigInt(xBytes),
    y: bytesToBigInt(yBytes),
  };
}

/**
 * Creates a passkey credential (registration)
 * This should be called when setting up a guardian
 *
 * @param rpId Relying Party ID (domain)
 * @param userName User's display name
 * @param challenge Registration challenge (random bytes)
 * @returns The created passkey credential with public key
 */
export async function createPasskeyCredential(
  rpId: string,
  userName: string,
  challenge: Uint8Array
): Promise<PasskeyCredential> {
  if (typeof navigator === 'undefined' || !navigator.credentials) {
    throw new Error('WebAuthn is not supported in this environment');
  }

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: challenge.buffer as ArrayBuffer,
      rp: {
        id: rpId,
        name: rpId,
      },
      user: {
        id: new TextEncoder().encode(userName),
        name: userName,
        displayName: userName,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: COSE_ALG_ES256 }, // ES256 (P-256)
      ],
      authenticatorSelection: {
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
    },
  })) as PublicKeyCredential;

  if (!credential) {
    throw new Error('Failed to create passkey credential');
  }

  const response = credential.response as AuthenticatorAttestationResponse;
  const publicKey = parseCosePublicKey(response.getPublicKey()!);

  return {
    credentialId: toHex(new Uint8Array(credential.rawId)),
    publicKey,
  };
}

/**
 * WebAuthn assertion response
 */
export interface WebAuthnAssertion {
  /** The authenticator data */
  authenticatorData: Uint8Array;
  /** The client data JSON string */
  clientDataJSON: string;
  /** The raw signature bytes */
  signature: Uint8Array;
}

/**
 * Requests a WebAuthn assertion (authentication)
 *
 * @param credentialId The credential ID to use
 * @param challenge The challenge to sign (typically the intentHash)
 * @param rpId Relying Party ID
 * @returns The WebAuthn assertion response
 */
export async function getPasskeyAssertion(
  credentialId: Hex,
  challenge: Uint8Array,
  rpId: string
): Promise<WebAuthnAssertion> {
  if (typeof navigator === 'undefined' || !navigator.credentials) {
    throw new Error('WebAuthn is not supported in this environment');
  }

  const credIdBytes = hexToBytes(credentialId);
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: challenge.buffer as ArrayBuffer,
      rpId,
      allowCredentials: [
        {
          type: 'public-key',
          id: credIdBytes.buffer as ArrayBuffer,
        },
      ],
      userVerification: 'required',
      timeout: 60000,
    },
  })) as PublicKeyCredential;

  if (!credential) {
    throw new Error('Failed to get passkey assertion');
  }

  const response = credential.response as AuthenticatorAssertionResponse;

  return {
    authenticatorData: new Uint8Array(response.authenticatorData),
    clientDataJSON: new TextDecoder().decode(response.clientDataJSON),
    signature: new Uint8Array(response.signature),
  };
}

/**
 * P-256 signature components
 */
export interface P256Signature {
  r: bigint;
  s: bigint;
}

/**
 * Parses a DER-encoded P-256 signature to r, s components
 *
 * @param derSignature The DER-encoded signature from WebAuthn
 * @returns The r and s values as bigints
 * @throws Error if the signature is malformed
 */
export function parseP256Signature(derSignature: Uint8Array): P256Signature {
  // DER signature format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
  let offset = 0;

  // Check SEQUENCE tag
  if (derSignature[offset++] !== 0x30) {
    throw new Error('Invalid DER signature: expected SEQUENCE');
  }

  // Skip total length (can be 1 or 2 bytes)
  const totalLength = derSignature[offset++];
  if (totalLength > 127) {
    // Long form length
    const lengthBytes = totalLength & 0x7f;
    offset += lengthBytes;
  }

  // Parse r
  if (derSignature[offset++] !== 0x02) {
    throw new Error('Invalid DER signature: expected INTEGER for r');
  }
  const rLength = derSignature[offset++];
  let rStart = offset;
  // Skip leading zero if present (for positive number encoding)
  if (derSignature[rStart] === 0x00) {
    rStart++;
  }
  const rBytes = derSignature.slice(rStart, offset + rLength);
  offset += rLength;

  // Parse s
  if (derSignature[offset++] !== 0x02) {
    throw new Error('Invalid DER signature: expected INTEGER for s');
  }
  const sLength = derSignature[offset++];
  let sStart = offset;
  // Skip leading zero if present
  if (derSignature[sStart] === 0x00) {
    sStart++;
  }
  const sBytes = derSignature.slice(sStart, offset + sLength);

  return {
    r: bytesToBigInt(rBytes),
    s: bytesToBigInt(sBytes),
  };
}

/**
 * Finds the index of a key in clientDataJSON
 * The contract needs exact indices for "challenge" and "type" properties
 *
 * @param clientDataJSON The JSON string
 * @param key The key to find (e.g., "challenge" or "type")
 * @returns The index where the key starts (including the quote)
 * @throws Error if the key is not found
 */
export function findClientDataIndex(clientDataJSON: string, key: string): number {
  const searchPattern = `"${key}"`;
  const index = clientDataJSON.indexOf(searchPattern);

  if (index === -1) {
    throw new Error(`Key "${key}" not found in clientDataJSON`);
  }

  return index;
}

/**
 * Converts a bytes32 challenge to base64url encoding
 * WebAuthn uses base64url encoding for challenges
 *
 * @param challenge The bytes32 challenge (intentHash)
 * @returns Base64url encoded challenge
 */
export function challengeToBase64Url(challenge: Hex): string {
  const bytes = hexToBytes(challenge);
  // Convert to base64
  const base64 = btoa(String.fromCharCode(...bytes));
  // Convert to base64url (replace + with -, / with _, remove =)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Converts base64url to bytes
 *
 * @param base64url The base64url encoded string
 * @returns The decoded bytes
 */
export function base64UrlToBytes(base64url: string): Uint8Array {
  // Convert base64url to base64
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  // Decode
  const binary = atob(padded);
  return new Uint8Array([...binary].map((c) => c.charCodeAt(0)));
}

// ============ Helper Functions ============

/**
 * Converts a byte array to a bigint
 */
function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

/**
 * Simple CBOR map decoder for COSE keys
 * Only handles the specific structure we need for P-256 public keys
 */
function decodeCborMap(bytes: Uint8Array): Map<number, unknown> {
  const result = new Map<number, unknown>();
  let offset = 0;

  // Check for map type (0xa0-0xbf for small maps)
  const majorType = bytes[offset] >> 5;
  if (majorType !== 5) {
    throw new Error('Expected CBOR map');
  }

  const mapLength = bytes[offset] & 0x1f;
  offset++;

  for (let i = 0; i < mapLength; i++) {
    // Decode key (negative or positive integer)
    const keyByte = bytes[offset++];
    let key: number;

    if ((keyByte >> 5) === 0) {
      // Positive integer
      key = keyByte & 0x1f;
    } else if ((keyByte >> 5) === 1) {
      // Negative integer
      key = -1 - (keyByte & 0x1f);
    } else {
      throw new Error('Unexpected CBOR key type');
    }

    // Decode value
    const valueByte = bytes[offset];
    const valueMajorType = valueByte >> 5;

    if (valueMajorType === 0) {
      // Positive integer
      result.set(key, valueByte & 0x1f);
      offset++;
    } else if (valueMajorType === 1) {
      // Negative integer
      result.set(key, -1 - (valueByte & 0x1f));
      offset++;
    } else if (valueMajorType === 2) {
      // Byte string
      const length = valueByte & 0x1f;
      offset++;
      result.set(key, bytes.slice(offset, offset + length));
      offset += length;
    } else {
      throw new Error('Unexpected CBOR value type');
    }
  }

  return result;
}
