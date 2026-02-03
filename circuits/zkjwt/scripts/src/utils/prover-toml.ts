/**
 * Prover.toml serialization utilities
 *
 * Noir Prover.toml format:
 * - BoundedVec<T, N>: TOML table with "storage" array and "len" field
 *   [field_name]
 *   storage = [...]
 *   len = "N"
 * - [u128; 18]: array of string values (large numbers as strings)
 * - u32: string value
 * - Field: string value
 */
import fs from "fs";
import path from "path";

export interface ZkJwtInputs {
  // Private inputs
  data: number[];
  dataLength: number;
  base64_decode_offset: number;
  redc_params_limbs: bigint[];
  signature_limbs: bigint[];
  email: number[];
  emailLength: number;
  salt: bigint;
  // Public inputs
  pubkey_modulus_limbs: bigint[];
  /** Must be a valid BN254 scalar field element (< 2^254 approx).
   *  When using a real EIP-712 hash (256-bit), reduce modulo the BN254 scalar
   *  field modulus first: intentHash % 21888242871839275222246405745257275088548364400416034343698204186575808495617n */
  intent_hash: bigint;
}

/**
 * Serialize a number array to TOML array format (integers without quotes for u8)
 */
function serializeU8Array(arr: number[]): string {
  return "[" + arr.join(", ") + "]";
}

/**
 * Serialize a bigint array to TOML array format
 * For [u128; 18]: ["484791102317025465533947056954494751", ...]
 */
function serializeBigIntArray(arr: bigint[]): string {
  return "[" + arr.map((n) => `"${n.toString()}"`).join(", ") + "]";
}

/**
 * Serialize all inputs to Prover.toml format
 *
 * @param inputs - The circuit inputs
 * @param maxDataLength - Maximum length for data BoundedVec (900 for zkjwt)
 * @param maxEmailLength - Maximum length for email BoundedVec (128 for zkjwt)
 * @returns The Prover.toml content as a string
 */
export function serializeToProverToml(
  inputs: ZkJwtInputs,
  maxDataLength: number = 900,
  maxEmailLength: number = 128
): string {
  // Pad data to maxDataLength
  const paddedData = [...inputs.data];
  while (paddedData.length < maxDataLength) {
    paddedData.push(0);
  }

  // Pad email to maxEmailLength
  const paddedEmail = [...inputs.email];
  while (paddedEmail.length < maxEmailLength) {
    paddedEmail.push(0);
  }

  const lines: string[] = [];

  // Simple scalar inputs first
  lines.push("# Scalar inputs");
  lines.push(`base64_decode_offset = "${inputs.base64_decode_offset}"`);
  lines.push(`salt = "${inputs.salt.toString()}"`);
  lines.push(`intent_hash = "${inputs.intent_hash.toString()}"`);
  lines.push("");

  // Array inputs
  lines.push("# Array inputs");
  lines.push(`redc_params_limbs = ${serializeBigIntArray(inputs.redc_params_limbs)}`);
  lines.push(`signature_limbs = ${serializeBigIntArray(inputs.signature_limbs)}`);
  lines.push(`pubkey_modulus_limbs = ${serializeBigIntArray(inputs.pubkey_modulus_limbs)}`);
  lines.push("");

  // BoundedVec inputs - must be TOML tables with storage and len
  lines.push("# BoundedVec inputs");
  lines.push("[data]");
  lines.push(`storage = ${serializeU8Array(paddedData)}`);
  lines.push(`len = "${inputs.dataLength}"`);
  lines.push("");

  lines.push("[email]");
  lines.push(`storage = ${serializeU8Array(paddedEmail)}`);
  lines.push(`len = "${inputs.emailLength}"`);

  return lines.join("\n");
}

/**
 * Write Prover.toml to disk
 *
 * @param content - The Prover.toml content
 * @param outputPath - The output path (relative or absolute)
 */
export function writeProverToml(content: string, outputPath: string): void {
  const resolvedPath = path.resolve(outputPath);
  fs.writeFileSync(resolvedPath, content, "utf-8");
}
