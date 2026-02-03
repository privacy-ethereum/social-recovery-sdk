import { encodeAbiParameters, parseSignature, pad } from 'viem';
import type { Hex, WalletClient, Address } from 'viem';
import type { IAuthAdapter, ProofResult } from './IAuthAdapter';
import { GuardianType, type RecoveryIntent } from '../../types';
import { EIP712_DOMAIN, RECOVERY_INTENT_TYPES } from '../../constants';

export interface EoaAdapterConfig {
  walletClient: WalletClient;
}

export class EoaAdapter implements IAuthAdapter {
  readonly guardianType: GuardianType = GuardianType.EOA;

  private readonly config: EoaAdapterConfig;

  constructor(config: EoaAdapterConfig) {
    this.config = config;
  }

  /**
   * Computes the guardian identifier from an EOA address
   * Returns bytes32(uint256(uint160(address))) - left-padded to 32 bytes
   */
  computeIdentifier(address: Address): Hex {
    return pad(address, { size: 32 }) as Hex;
  }

  /**
   * Generates an EOA proof by signing the recovery intent with EIP-712
   */
  async generateProof(intent: RecoveryIntent, guardianIdentifier: Hex): Promise<ProofResult> {
    try {
      const account = this.config.walletClient.account;
      if (!account) {
        return { success: false, error: 'WalletClient has no account attached' };
      }

      // Validate that our address matches the guardian identifier
      const computedIdentifier = this.computeIdentifier(account.address);
      if (computedIdentifier.toLowerCase() !== guardianIdentifier.toLowerCase()) {
        return {
          success: false,
          error: 'Guardian identifier does not match adapter wallet address',
        };
      }

      // Sign the recovery intent using EIP-712 typed data
      const signature = await this.config.walletClient.signTypedData({
        account,
        domain: {
          name: EIP712_DOMAIN.name,
          version: EIP712_DOMAIN.version,
          chainId: intent.chainId,
          verifyingContract: intent.recoveryManager,
        },
        types: RECOVERY_INTENT_TYPES,
        primaryType: 'RecoveryIntent',
        message: {
          wallet: intent.wallet,
          newOwner: intent.newOwner,
          nonce: intent.nonce,
          deadline: intent.deadline,
          chainId: intent.chainId,
          recoveryManager: intent.recoveryManager,
        },
      });

      // Parse the signature into v, r, s components
      const { v, r, s } = parseSignature(signature);

      // ABI-encode for contract submission
      // Must match RecoveryManager._verifyEoaProof: abi.decode(proof, (uint8, bytes32, bytes32))
      const encodedProof = encodeAbiParameters(
        [{ type: 'uint8' }, { type: 'bytes32' }, { type: 'bytes32' }],
        [Number(v), r, s],
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
        error: error instanceof Error ? error.message : 'Unknown error generating EOA proof',
      };
    }
  }
}
