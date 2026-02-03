import { encodeAbiParameters, pad, toHex } from 'viem';
import type { Hex } from 'viem';
import type { IAuthAdapter, ProofResult } from './IAuthAdapter';
import { GuardianType, type RecoveryIntent } from '../../types';
import { hashRecoveryIntent } from '../utils/eip712';
import {
  initBarretenberg,
  getBarretenberg,
  computeCommitment,
  frToHex,
} from '../utils/zkjwt/poseidon';
import { extractJwtInputs } from '../utils/zkjwt/jwt';
import { decodeJwtHeader, decodeJwtPayload, fetchGoogleJwk } from '../utils/zkjwt/google-jwks';
import { generateZkJwtProof, BN254_SCALAR_FIELD_MODULUS, type ZkJwtCircuitInputs } from '../utils/zkjwt/circuit';

export interface ZkJwtAdapterConfig {
  jwt: string;
  salt: bigint;
}

/**
 * Compute a zkJWT guardian identifier (async version)
 * Returns Poseidon2(email_hash, salt) as bytes32 hex
 */
export async function computeZkJwtIdentifier(email: string, salt: bigint): Promise<Hex> {
  const bb = await initBarretenberg();
  const commitment = computeCommitment(bb, email, salt);
  return frToHex(commitment) as Hex;
}

export class ZkJwtAdapter implements IAuthAdapter {
  readonly guardianType: GuardianType = GuardianType.ZkJWT;

  private readonly config: ZkJwtAdapterConfig;

  constructor(config: ZkJwtAdapterConfig) {
    this.config = config;
  }

  /**
   * Computes the guardian identifier from email and salt.
   * This method is synchronous — it throws if initBarretenberg() has not been called.
   * For a standalone async version, use the exported computeZkJwtIdentifier() function.
   */
  computeIdentifier(credentials: { email: string; salt: bigint }): Hex {
    const bb = getBarretenberg();
    const commitment = computeCommitment(bb, credentials.email, credentials.salt);
    return frToHex(commitment) as Hex;
  }

  /**
   * Generates a zkJWT proof for the given recovery intent
   */
  async generateProof(intent: RecoveryIntent, guardianIdentifier: Hex): Promise<ProofResult> {
    try {
      // Initialize Barretenberg
      await initBarretenberg();

      // Decode JWT to extract email and kid
      const { kid } = decodeJwtHeader(this.config.jwt);
      const payload = decodeJwtPayload(this.config.jwt);
      const email = payload.email as string;
      if (!email) {
        return { success: false, error: 'JWT does not contain an email claim' };
      }

      // Validate identifier matches
      const computedIdentifier = this.computeIdentifier({
        email,
        salt: this.config.salt,
      });
      if (computedIdentifier.toLowerCase() !== guardianIdentifier.toLowerCase()) {
        return {
          success: false,
          error: 'Guardian identifier does not match JWT email + salt commitment',
        };
      }

      // Fetch the public key for this JWT
      const jwk = await fetchGoogleJwk(kid);

      // Extract JWT circuit inputs
      const jwtInputs = extractJwtInputs(this.config.jwt, jwk);

      // Prepare email bytes and validate length against circuit limit
      const MAX_EMAIL_LENGTH = 128;
      const emailBytes = Array.from(new TextEncoder().encode(email));
      if (emailBytes.length > MAX_EMAIL_LENGTH) {
        return {
          success: false,
          error: `Email exceeds maximum length of ${MAX_EMAIL_LENGTH} bytes (got ${emailBytes.length})`,
        };
      }

      // Compute intent hash and reduce to BN254 scalar field
      // (keccak256 is 256-bit but Noir Field is ~254-bit; must match ZkJwtVerifier.sol)
      const intentHash = hashRecoveryIntent(intent);
      const intentHashBigInt = BigInt(intentHash) % BN254_SCALAR_FIELD_MODULUS;

      // Build circuit inputs
      const circuitInputs: ZkJwtCircuitInputs = {
        data: [...jwtInputs.data],
        dataLength: jwtInputs.dataLength,
        base64_decode_offset: jwtInputs.base64DecodeOffset,
        redc_params_limbs: jwtInputs.redcParamsLimbs,
        signature_limbs: jwtInputs.signatureLimbs,
        email: emailBytes,
        emailLength: emailBytes.length,
        salt: this.config.salt,
        pubkey_modulus_limbs: jwtInputs.pubkeyModulusLimbs,
        intent_hash: intentHashBigInt,
      };

      // Generate ZK proof
      const { rawProof } = await generateZkJwtProof(circuitInputs);

      // Format pubkey modulus limbs as bytes32[18] for the contract
      const modulusLimbs = jwtInputs.pubkeyModulusLimbs.map(
        (limb) => pad(toHex(limb), { size: 32 }),
      ) as [Hex, Hex, Hex, Hex, Hex, Hex, Hex, Hex, Hex, Hex, Hex, Hex, Hex, Hex, Hex, Hex, Hex, Hex];

      // ABI-encode for ZkJwtVerifier.verify()
      // Must match: abi.decode(proof, (bytes, bytes32[18]))
      const encodedProof = encodeAbiParameters(
        [{ type: 'bytes' }, { type: 'bytes32[18]' }],
        [toHex(rawProof), modulusLimbs],
      );

      return {
        success: true,
        proof: {
          guardianIdentifier,
          guardianType: this.guardianType,
          proof: encodedProof,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error generating zkJWT proof',
      };
    }
  }
}
