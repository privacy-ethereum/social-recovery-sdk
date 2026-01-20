/**
 * Poseidon2 hash computation utilities using bb.js
 * Matches the circuit's pack_bytes_to_fields() function and Poseidon2 hashing
 */
import { BarretenbergSync, Fr } from "@aztec/bb.js";

// Constants matching the circuit
const PACKED_EMAIL_FIELDS = 5;
const BYTES_PER_FIELD = 31;

let bbInstance: BarretenbergSync | null = null;

/**
 * Initialize Barretenberg (call once at startup)
 */
export async function initBarretenberg(): Promise<BarretenbergSync> {
  if (!bbInstance) {
    bbInstance = await BarretenbergSync.initSingleton();
  }
  return bbInstance;
}

/**
 * Get the initialized Barretenberg instance
 * @throws Error if not initialized
 */
export function getBarretenberg(): BarretenbergSync {
  if (!bbInstance) {
    throw new Error(
      "Barretenberg not initialized. Call initBarretenberg() first."
    );
  }
  return bbInstance;
}

/**
 * Pack email bytes into Field elements (31 bytes per Field, big-endian)
 * Matches the circuit's pack_bytes_to_fields() function
 *
 * The packing is: field_value = byte[0] * 256^30 + byte[1] * 256^29 + ... + byte[30]
 * For each field, we process 31 bytes starting at field_idx * 31
 *
 * @param email - The email string
 * @returns Array of 5 BigInt field values
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
        // Big-endian: multiply accumulated value by 256 and add new byte
        fieldValue = fieldValue * 256n + BigInt(bytes[byteIdx]);
      }
    }
    result[fieldIdx] = fieldValue;
  }

  return result;
}

/**
 * Compute the email hash: Poseidon2([packed[0..4], email_len], 6)
 *
 * @param bb - The Barretenberg instance
 * @param email - The email string
 * @returns The email hash as a Fr element
 */
export function computeEmailHash(bb: BarretenbergSync, email: string): Fr {
  const packed = packEmailToFields(email);
  const emailLen = BigInt(new TextEncoder().encode(email).length);

  // Build input array: [packed[0], packed[1], packed[2], packed[3], packed[4], email_len]
  const inputs: Fr[] = [
    new Fr(packed[0]),
    new Fr(packed[1]),
    new Fr(packed[2]),
    new Fr(packed[3]),
    new Fr(packed[4]),
    new Fr(emailLen),
  ];

  return bb.poseidon2Hash(inputs);
}

/**
 * Compute the commitment: Poseidon2([email_hash, salt], 2)
 *
 * @param bb - The Barretenberg instance
 * @param email - The email string
 * @param salt - The salt value
 * @returns The commitment as a Fr element
 */
export function computeCommitment(
  bb: BarretenbergSync,
  email: string,
  salt: bigint
): Fr {
  const emailHash = computeEmailHash(bb, email);
  const inputs: Fr[] = [emailHash, new Fr(salt)];

  return bb.poseidon2Hash(inputs);
}

/**
 * Convert a Fr element to a hex string
 */
export function frToHex(fr: Fr): string {
  return fr.toString();
}

/**
 * Convert a Fr element to a BigInt
 */
export function frToBigInt(fr: Fr): bigint {
  const hex = fr.toString();
  return BigInt(hex);
}
