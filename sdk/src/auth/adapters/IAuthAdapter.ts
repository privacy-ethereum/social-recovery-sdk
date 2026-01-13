import type { Hex } from 'viem';
import type { GuardianType, GuardianProof, RecoveryIntent } from '../../types';

/**
 * Result of generating a proof
 */
export interface ProofResult {
  /** Whether the proof generation was successful */
  success: boolean;
  /** The generated proof (if successful) */
  proof?: GuardianProof;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Base interface for all authentication adapters
 * Each guardian type (EOA, Passkey, ZkJWT) has its own adapter implementation
 */
export interface IAuthAdapter {
  /**
   * The guardian type this adapter handles
   */
  readonly guardianType: GuardianType;

  /**
   * Generates a proof for the given recovery intent
   * @param intent The recovery intent to prove
   * @param guardianIdentifier The guardian's identifier (must match adapter's credentials)
   * @returns The generated proof or error
   */
  generateProof(intent: RecoveryIntent, guardianIdentifier: Hex): Promise<ProofResult>;

  /**
   * Computes the guardian identifier for this adapter type
   * @param credentials Adapter-specific credentials
   * @returns The computed guardian identifier (bytes32)
   */
  computeIdentifier(credentials: unknown): Hex;
}
