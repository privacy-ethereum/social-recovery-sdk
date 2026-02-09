import { Noir } from '@noir-lang/noir_js';
import { UltraHonkBackend } from '@aztec/bb.js';

// The circuit artifact is loaded lazily to avoid bundling the 1.3MB JSON at import time
let circuitArtifact: any = null;

async function loadCircuitArtifact(): Promise<any> {
  if (!circuitArtifact) {
    // Dynamic import to keep the large artifact out of the initial bundle
    const module = await import('./zkjwt-circuit.json');
    circuitArtifact = module.default ?? module;
  }
  return circuitArtifact;
}

/// BN254 scalar field modulus — intent hashes must be reduced mod this value
/// to fit in a Noir Field element (same constant used in ZkJwtVerifier.sol)
export const BN254_SCALAR_FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export interface ZkJwtCircuitInputs {
  data: number[];
  dataLength: number;
  base64_decode_offset: number;
  redc_params_limbs: bigint[];
  signature_limbs: bigint[];
  email: number[];
  emailLength: number;
  salt: bigint;
  pubkey_modulus_limbs: bigint[];
  intent_hash: bigint;
}

export interface ZkJwtProofResult {
  rawProof: Uint8Array;
  publicInputs: string[];
}

/**
 * Generate a zkJWT proof using the Noir circuit
 *
 * @param inputs - The circuit inputs
 * @returns The generated proof and public inputs
 */
export async function generateZkJwtProof(inputs: ZkJwtCircuitInputs): Promise<ZkJwtProofResult> {
  const artifact = await loadCircuitArtifact();

  // Pad data array to 900 bytes (circuit's MAX_DATA_LENGTH)
  const paddedData = new Array(900).fill(0);
  for (let i = 0; i < inputs.data.length && i < 900; i++) {
    paddedData[i] = inputs.data[i];
  }

  // Pad email array to 128 bytes (circuit's MAX_EMAIL_LENGTH)
  const paddedEmail = new Array(128).fill(0);
  for (let i = 0; i < inputs.email.length && i < 128; i++) {
    paddedEmail[i] = inputs.email[i];
  }

  // Format inputs for noir_js
  // BoundedVec inputs must be { storage: [...], len: "N" } to match the compiled ABI
  const formattedInputs = {
    data: { storage: paddedData, len: inputs.dataLength },
    base64_decode_offset: inputs.base64_decode_offset,
    signature_limbs: inputs.signature_limbs.map(String),
    pubkey_modulus_limbs: inputs.pubkey_modulus_limbs.map(String),
    redc_params_limbs: inputs.redc_params_limbs.map(String),
    email: { storage: paddedEmail, len: inputs.emailLength },
    salt: String(inputs.salt),
    intent_hash: String(inputs.intent_hash),
  };

  // Execute circuit to generate witness
  const noir = new Noir(artifact);
  let witness: Uint8Array;
  try {
    const result = await noir.execute(formattedInputs as any);
    witness = result.witness;
  } catch (error) {
    throw new Error(
      `noir.execute failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Generate proof using UltraHonk backend
  const backend = new UltraHonkBackend(artifact.bytecode);
  let proof: Uint8Array;
  let publicInputs: string[];
  try {
    const result = await backend.generateProof(witness);
    proof = result.proof;
    publicInputs = result.publicInputs;
  } catch (error) {
    throw new Error(
      `backend.generateProof failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return { rawProof: proof, publicInputs };
}
