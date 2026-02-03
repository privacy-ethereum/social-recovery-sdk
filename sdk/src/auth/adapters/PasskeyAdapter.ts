import { encodeAbiParameters, keccak256, encodePacked, toHex, hexToBytes } from 'viem';
import type { Hex } from 'viem';
import type { IAuthAdapter, ProofResult } from './IAuthAdapter';
import { GuardianType, type RecoveryIntent, type P256PublicKey } from '../../types';
import { hashRecoveryIntent } from '../utils/eip712';
import {
  getPasskeyAssertion,
  parseP256Signature,
  findClientDataIndex,
} from '../utils/webauthn';

/**
 * Configuration for the PasskeyAdapter
 */
export interface PasskeyAdapterConfig {
  /** Relying Party ID (domain) */
  rpId: string;
  /** The WebAuthn credential ID */
  credentialId: Hex;
  /** The P-256 public key coordinates */
  publicKey: P256PublicKey;
}

/**
 * Adapter for generating passkey (WebAuthn) proofs
 * Used by guardians who authenticate via passkeys
 */
export class PasskeyAdapter implements IAuthAdapter {
  readonly guardianType: GuardianType = GuardianType.Passkey;

  private readonly config: PasskeyAdapterConfig;

  constructor(config: PasskeyAdapterConfig) {
    this.config = config;
  }

  /**
   * Computes the guardian identifier from P-256 public key
   * @param publicKey The P-256 public key coordinates
   * @returns keccak256(pubKeyX || pubKeyY)
   */
  computeIdentifier(publicKey: P256PublicKey): Hex {
    return keccak256(encodePacked(['uint256', 'uint256'], [publicKey.x, publicKey.y]));
  }

  /**
   * Generates a passkey proof for the given recovery intent
   *
   * @param intent The recovery intent to prove
   * @param guardianIdentifier The expected guardian identifier (for validation)
   * @returns The generated proof or error
   */
  async generateProof(intent: RecoveryIntent, guardianIdentifier: Hex): Promise<ProofResult> {
    try {
      // Validate that the guardian identifier matches our public key
      const computedIdentifier = this.computeIdentifier(this.config.publicKey);
      if (computedIdentifier.toLowerCase() !== guardianIdentifier.toLowerCase()) {
        return {
          success: false,
          error: 'Guardian identifier does not match adapter public key',
        };
      }

      // Compute the intent hash (this is the challenge for WebAuthn)
      const intentHash = hashRecoveryIntent(intent);

      // Request WebAuthn assertion
      // The challenge is the raw bytes of the intentHash
      const assertion = await getPasskeyAssertion(
        this.config.credentialId,
        hexToBytes(intentHash),
        this.config.rpId
      );

      // Parse the signature
      const { r, s } = parseP256Signature(assertion.signature);

      // Find indices in clientDataJSON
      const challengeIndex = findClientDataIndex(assertion.clientDataJSON, 'challenge');
      const typeIndex = findClientDataIndex(assertion.clientDataJSON, 'type');

      // ABI-encode the proof for contract submission
      // Must match the decoding in PasskeyVerifier.sol
      const encodedProof = encodeAbiParameters(
        [
          { type: 'bytes' }, // authenticatorData
          { type: 'string' }, // clientDataJSON
          { type: 'uint256' }, // challengeLocation
          { type: 'uint256' }, // responseTypeLocation
          { type: 'uint256' }, // r
          { type: 'uint256' }, // s
          { type: 'uint256' }, // pubKeyX
          { type: 'uint256' }, // pubKeyY
        ],
        [
          toHex(assertion.authenticatorData),
          assertion.clientDataJSON,
          BigInt(challengeIndex),
          BigInt(typeIndex),
          r,
          s,
          this.config.publicKey.x,
          this.config.publicKey.y,
        ]
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
        error: error instanceof Error ? error.message : 'Unknown error generating passkey proof',
      };
    }
  }

  /**
   * Returns the configured public key
   */
  getPublicKey(): P256PublicKey {
    return this.config.publicKey;
  }

  /**
   * Returns the configured credential ID
   */
  getCredentialId(): Hex {
    return this.config.credentialId;
  }

  /**
   * Returns the configured RP ID
   */
  getRpId(): string {
    return this.config.rpId;
  }
}
