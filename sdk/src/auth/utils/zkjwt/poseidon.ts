import { BackendType, BarretenbergSync } from '@aztec/bb.js';

export const PACKED_EMAIL_FIELDS = 5;
export const BYTES_PER_FIELD = 31;

let bbInstance: BarretenbergSync | null = null;

function bigintToFieldBytes(value: bigint): Uint8Array {
  if (value < 0n) {
    throw new Error('Field elements must be non-negative');
  }

  let hex = value.toString(16);
  if (hex.length > 64) {
    throw new Error('Field element does not fit in 32 bytes');
  }
  if (hex.length % 2 !== 0) {
    hex = `0${hex}`;
  }

  const bytes = new Uint8Array(32);
  const byteLength = hex.length / 2;
  const start = 32 - byteLength;
  for (let i = 0; i < byteLength; i++) {
    const byteHex = hex.slice(i * 2, i * 2 + 2);
    bytes[start + i] = Number.parseInt(byteHex, 16);
  }
  return bytes;
}

function fieldBytesToBigInt(field: Uint8Array): bigint {
  let value = 0n;
  for (const byte of field) {
    value = (value << 8n) + BigInt(byte);
  }
  return value;
}

/**
 * Initialize Barretenberg (call once at startup)
 */
export async function initBarretenberg(): Promise<BarretenbergSync> {
  if (!bbInstance) {
    bbInstance = await BarretenbergSync.initSingleton({
      backend: BackendType.Wasm,
      threads: 1,
    });
  }
  return bbInstance;
}

/**
 * Get the initialized Barretenberg instance
 * @throws Error if not initialized
 */
export function getBarretenberg(): BarretenbergSync {
  if (!bbInstance) {
    throw new Error('Barretenberg not initialized. Call initBarretenberg() first.');
  }
  return bbInstance;
}

/**
 * Pack email bytes into Field elements (31 bytes per Field, big-endian)
 * Matches the circuit's pack_bytes_to_fields() function
 */
export function packEmailToFields(email: string): bigint[] {
  const bytes = new TextEncoder().encode(email);
  const result: bigint[] = new Array(PACKED_EMAIL_FIELDS).fill(0n);

  for (let fieldIdx = 0; fieldIdx < PACKED_EMAIL_FIELDS; fieldIdx++) {
    let fieldValue = 0n;
    const startByte = fieldIdx * BYTES_PER_FIELD;

    for (let byteOffset = 0; byteOffset < BYTES_PER_FIELD; byteOffset++) {
      const byteIdx = startByte + byteOffset;
      if (byteIdx < bytes.length) {
        fieldValue = fieldValue * 256n + BigInt(bytes[byteIdx]);
      }
    }
    result[fieldIdx] = fieldValue;
  }

  return result;
}

/**
 * Compute the email hash: Poseidon2([packed[0..4], email_len], 6)
 */
export function computeEmailHash(bb: BarretenbergSync, email: string): bigint {
  const packed = packEmailToFields(email);
  const emailLen = BigInt(new TextEncoder().encode(email).length);

  const inputs: bigint[] = [
    packed[0],
    packed[1],
    packed[2],
    packed[3],
    packed[4],
    emailLen,
  ];

  const result = bb.poseidon2Hash({
    inputs: inputs.map(bigintToFieldBytes),
  });
  return fieldBytesToBigInt(result.hash);
}

/**
 * Compute the commitment: Poseidon2([email_hash, salt], 2)
 */
export function computeCommitment(bb: BarretenbergSync, email: string, salt: bigint): bigint {
  const emailHash = computeEmailHash(bb, email);
  const result = bb.poseidon2Hash({
    inputs: [emailHash, salt].map(bigintToFieldBytes),
  });
  return fieldBytesToBigInt(result.hash);
}

/**
 * Convert a Fr element to a hex string
 */
export function frToHex(fr: bigint): string {
  return `0x${fr.toString(16).padStart(64, '0')}`;
}

/**
 * Convert a Fr element to a BigInt
 */
export function frToBigInt(fr: bigint): bigint {
  return fr;
}
