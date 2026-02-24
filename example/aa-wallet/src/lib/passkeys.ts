import type { P256PublicKey } from '@pse/social-recovery-sdk';
import { encodePacked, keccak256, toHex, type Hex } from 'viem';

const PASSKEY_STORAGE_KEY = 'aa-wallet-demo-passkeys-v1';

export interface StoredPasskeyCredential {
  id: string;
  label: string;
  rpId: string;
  credentialId: Hex;
  identifier: Hex;
  publicKeyX: string;
  publicKeyY: string;
  createdAt: string;
}

export interface PasskeyMaterial {
  id: string;
  label: string;
  rpId: string;
  credentialId: Hex;
  identifier: Hex;
  publicKey: P256PublicKey;
  createdAt: string;
}

interface EnrollPasskeyInput {
  label?: string;
  rpId?: string;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function readCborLength(bytes: Uint8Array, offset: number, additionalInfo: number): { length: number; offset: number } {
  if (additionalInfo < 24) {
    return { length: additionalInfo, offset };
  }
  if (additionalInfo === 24) {
    if (offset >= bytes.length) throw new Error('Invalid CBOR length');
    return { length: bytes[offset], offset: offset + 1 };
  }
  if (additionalInfo === 25) {
    if (offset + 1 >= bytes.length) throw new Error('Invalid CBOR length');
    return { length: (bytes[offset] << 8) | bytes[offset + 1], offset: offset + 2 };
  }
  if (additionalInfo === 26) {
    if (offset + 3 >= bytes.length) throw new Error('Invalid CBOR length');
    const length =
      (bytes[offset] * 2 ** 24) +
      (bytes[offset + 1] << 16) +
      (bytes[offset + 2] << 8) +
      bytes[offset + 3];
    return { length, offset: offset + 4 };
  }
  throw new Error('Unsupported CBOR length encoding');
}

function readCborInt(bytes: Uint8Array, offset: number): { value: number; offset: number } {
  if (offset >= bytes.length) {
    throw new Error('Unexpected end of CBOR data');
  }

  const head = bytes[offset++];
  const majorType = head >> 5;
  const additionalInfo = head & 0x1f;
  if (majorType !== 0 && majorType !== 1) {
    throw new Error('Expected CBOR integer');
  }

  const { length: magnitude, offset: nextOffset } = readCborLength(bytes, offset, additionalInfo);
  const value = majorType === 0 ? magnitude : -1 - magnitude;
  return { value, offset: nextOffset };
}

function parseP256FromCose(coseKey: Uint8Array): P256PublicKey {
  let offset = 0;
  const head = coseKey[offset++];
  const majorType = head >> 5;
  if (majorType !== 5) {
    throw new Error('Expected CBOR map');
  }

  const { length: mapLength, offset: mapOffset } = readCborLength(coseKey, offset, head & 0x1f);
  offset = mapOffset;

  const entries = new Map<number, unknown>();
  for (let i = 0; i < mapLength; i++) {
    const keyDecoded = readCborInt(coseKey, offset);
    const key = keyDecoded.value;
    offset = keyDecoded.offset;

    if (offset >= coseKey.length) {
      throw new Error('Unexpected end of CBOR map');
    }

    const valueHead = coseKey[offset++];
    const valueMajorType = valueHead >> 5;
    const valueAdditionalInfo = valueHead & 0x1f;

    if (valueMajorType === 0 || valueMajorType === 1) {
      const { length: magnitude, offset: nextOffset } = readCborLength(coseKey, offset, valueAdditionalInfo);
      offset = nextOffset;
      entries.set(key, valueMajorType === 0 ? magnitude : -1 - magnitude);
      continue;
    }

    if (valueMajorType === 2) {
      const { length, offset: valueOffset } = readCborLength(coseKey, offset, valueAdditionalInfo);
      if (valueOffset + length > coseKey.length) {
        throw new Error('Invalid CBOR byte string length');
      }
      entries.set(key, coseKey.slice(valueOffset, valueOffset + length));
      offset = valueOffset + length;
      continue;
    }

    throw new Error('Unsupported COSE value type');
  }

  const keyType = entries.get(1);
  const algorithm = entries.get(3);
  const curve = entries.get(-1);
  const x = entries.get(-2);
  const y = entries.get(-3);

  if (keyType !== 2 || algorithm !== -7 || curve !== 1) {
    throw new Error('COSE key is not EC2/ES256/P-256');
  }
  if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) {
    throw new Error('COSE P-256 key coordinates are invalid');
  }

  return {
    x: bytesToBigInt(x),
    y: bytesToBigInt(y),
  };
}

function readAsn1Length(bytes: Uint8Array, offset: number): { length: number; offset: number } {
  if (offset >= bytes.length) {
    throw new Error('Invalid DER length');
  }

  const first = bytes[offset++];
  if ((first & 0x80) === 0) {
    return { length: first, offset };
  }

  const numLengthBytes = first & 0x7f;
  if (numLengthBytes === 0 || numLengthBytes > 4 || offset + numLengthBytes > bytes.length) {
    throw new Error('Unsupported DER length encoding');
  }

  let length = 0;
  for (let i = 0; i < numLengthBytes; i++) {
    length = (length << 8) | bytes[offset + i];
  }

  return { length, offset: offset + numLengthBytes };
}

function parseP256FromSpki(spki: Uint8Array): P256PublicKey {
  let offset = 0;

  if (spki[offset++] !== 0x30) {
    throw new Error('Invalid SPKI header');
  }
  const root = readAsn1Length(spki, offset);
  offset = root.offset;

  if (spki[offset++] !== 0x30) {
    throw new Error('Invalid SPKI algorithm sequence');
  }
  const algorithm = readAsn1Length(spki, offset);
  offset = algorithm.offset + algorithm.length;
  if (offset >= spki.length) {
    throw new Error('Invalid SPKI payload');
  }

  if (spki[offset++] !== 0x03) {
    throw new Error('Invalid SPKI bit string');
  }
  const bitString = readAsn1Length(spki, offset);
  offset = bitString.offset;
  if (bitString.length < 1 || offset + bitString.length > spki.length) {
    throw new Error('Invalid SPKI bit string length');
  }

  const unusedBits = spki[offset++];
  if (unusedBits !== 0) {
    throw new Error('Unsupported SPKI bit string encoding');
  }

  const point = spki.slice(offset, offset + bitString.length - 1);
  if (point.length !== 65 || point[0] !== 0x04) {
    throw new Error('Expected uncompressed P-256 public key');
  }

  return {
    x: bytesToBigInt(point.slice(1, 33)),
    y: bytesToBigInt(point.slice(33, 65)),
  };
}

function parseP256PublicKey(rawPublicKey: ArrayBuffer): P256PublicKey {
  const bytes = new Uint8Array(rawPublicKey);
  if (bytes.length === 0) {
    throw new Error('Public key is empty');
  }

  if ((bytes[0] >> 5) === 5) {
    return parseP256FromCose(bytes);
  }

  if (bytes[0] === 0x30) {
    return parseP256FromSpki(bytes);
  }

  if (bytes[0] === 0x04 && bytes.length === 65) {
    return {
      x: bytesToBigInt(bytes.slice(1, 33)),
      y: bytesToBigInt(bytes.slice(33, 65)),
    };
  }

  throw new Error('Unsupported WebAuthn public key format');
}

async function createLocalPasskeyCredential(
  rpId: string,
  userName: string,
  challenge: Uint8Array,
): Promise<{ credentialId: Hex; publicKey: P256PublicKey }> {
  if (typeof navigator === 'undefined' || !navigator.credentials) {
    throw new Error('WebAuthn is not supported in this environment');
  }

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: toArrayBuffer(challenge),
      rp: {
        id: rpId,
        name: rpId,
      },
      user: {
        id: toArrayBuffer(new TextEncoder().encode(userName)),
        name: userName,
        displayName: userName,
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: {
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('Failed to create passkey credential');
  }

  const response = credential.response as AuthenticatorAttestationResponse & {
    getPublicKey?: () => ArrayBuffer | null;
  };
  const publicKeyBuffer = response.getPublicKey?.();
  if (!publicKeyBuffer) {
    throw new Error('Authenticator did not return public key material');
  }

  return {
    credentialId: toHex(new Uint8Array(credential.rawId)),
    publicKey: parseP256PublicKey(publicKeyBuffer),
  };
}

function isHex(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value);
}

function createRecordId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `passkey-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeStoredPasskey(value: unknown): StoredPasskeyCredential | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<StoredPasskeyCredential>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.label !== 'string' ||
    typeof candidate.rpId !== 'string' ||
    !isHex(candidate.credentialId) ||
    !isHex(candidate.identifier) ||
    typeof candidate.publicKeyX !== 'string' ||
    typeof candidate.publicKeyY !== 'string' ||
    typeof candidate.createdAt !== 'string'
  ) {
    return null;
  }

  try {
    BigInt(candidate.publicKeyX);
    BigInt(candidate.publicKeyY);
  } catch {
    return null;
  }

  return {
    id: candidate.id,
    label: candidate.label,
    rpId: candidate.rpId,
    credentialId: candidate.credentialId,
    identifier: candidate.identifier,
    publicKeyX: candidate.publicKeyX,
    publicKeyY: candidate.publicKeyY,
    createdAt: candidate.createdAt,
  };
}

function toPasskeyMaterial(entry: StoredPasskeyCredential): PasskeyMaterial {
  return {
    id: entry.id,
    label: entry.label,
    rpId: entry.rpId,
    credentialId: entry.credentialId,
    identifier: entry.identifier,
    publicKey: {
      x: BigInt(entry.publicKeyX),
      y: BigInt(entry.publicKeyY),
    },
    createdAt: entry.createdAt,
  };
}

function saveStoredPasskeys(passkeys: StoredPasskeyCredential[]) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(PASSKEY_STORAGE_KEY, JSON.stringify(passkeys));
}

export function computePasskeyIdentifier(publicKey: P256PublicKey): Hex {
  return keccak256(encodePacked(['uint256', 'uint256'], [publicKey.x, publicKey.y]));
}

export function getDefaultRpId(): string {
  if (typeof window === 'undefined') {
    return 'localhost';
  }
  const hostname = window.location.hostname.trim();
  if (hostname === '0.0.0.0' || hostname === '[::]') {
    return 'localhost';
  }
  return hostname.length > 0 ? hostname : 'localhost';
}

export function loadStoredPasskeys(): StoredPasskeyCredential[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(PASSKEY_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const valid = parsed
      .map((entry) => normalizeStoredPasskey(entry))
      .filter((entry): entry is StoredPasskeyCredential => entry !== null);

    return valid;
  } catch {
    return [];
  }
}

export function listPasskeys(): PasskeyMaterial[] {
  return loadStoredPasskeys().map(toPasskeyMaterial);
}

export function findPasskeyByIdentifier(identifier: Hex): PasskeyMaterial | null {
  const match = loadStoredPasskeys().find(
    (entry) => entry.identifier.toLowerCase() === identifier.toLowerCase(),
  );
  return match ? toPasskeyMaterial(match) : null;
}

export function getPasskeyById(passkeyId: string): PasskeyMaterial | null {
  const match = loadStoredPasskeys().find((entry) => entry.id === passkeyId);
  return match ? toPasskeyMaterial(match) : null;
}

export async function enrollPasskey(input?: EnrollPasskeyInput): Promise<PasskeyMaterial> {
  if (typeof window === 'undefined') {
    throw new Error('Passkey enrollment requires a browser context.');
  }

  const rpId = input?.rpId?.trim() || getDefaultRpId();
  const label =
    input?.label?.trim() || `Passkey ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);

  const credential = await createLocalPasskeyCredential(rpId, `guardian-${Date.now().toString(36)}`, challenge);
  const identifier = computePasskeyIdentifier(credential.publicKey);

  const all = loadStoredPasskeys();
  const existingIndex = all.findIndex((entry) => entry.identifier.toLowerCase() === identifier.toLowerCase());

  const record: StoredPasskeyCredential = {
    id: existingIndex >= 0 ? all[existingIndex].id : createRecordId(),
    label,
    rpId,
    credentialId: credential.credentialId,
    identifier,
    publicKeyX: credential.publicKey.x.toString(),
    publicKeyY: credential.publicKey.y.toString(),
    createdAt: existingIndex >= 0 ? all[existingIndex].createdAt : new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    all[existingIndex] = record;
  } else {
    all.unshift(record);
  }

  saveStoredPasskeys(all);
  return toPasskeyMaterial(record);
}
