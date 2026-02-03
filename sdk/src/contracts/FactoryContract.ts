import type { PublicClient, WalletClient, Address, Hex } from 'viem';
import { RecoveryManagerFactoryAbi } from './abis';
import type { Guardian } from '../types';

export interface FactoryContractConfig {
  address: Address;
  publicClient: PublicClient;
  walletClient?: WalletClient;
}

export class FactoryContract {
  readonly address: Address;

  private readonly publicClient: PublicClient;
  private readonly walletClient?: WalletClient;

  constructor(config: FactoryContractConfig) {
    this.address = config.address;
    this.publicClient = config.publicClient;
    this.walletClient = config.walletClient;
  }

  // === Read Functions ===

  async getRecoveryManager(wallet: Address): Promise<Address> {
    return this.publicClient.readContract({
      address: this.address,
      abi: RecoveryManagerFactoryAbi,
      functionName: 'getRecoveryManager',
      args: [wallet],
    });
  }

  async implementation(): Promise<Address> {
    return this.publicClient.readContract({
      address: this.address,
      abi: RecoveryManagerFactoryAbi,
      functionName: 'implementation',
    });
  }

  async passkeyVerifier(): Promise<Address> {
    return this.publicClient.readContract({
      address: this.address,
      abi: RecoveryManagerFactoryAbi,
      functionName: 'passkeyVerifier',
    });
  }

  async zkJwtVerifier(): Promise<Address> {
    return this.publicClient.readContract({
      address: this.address,
      abi: RecoveryManagerFactoryAbi,
      functionName: 'zkJwtVerifier',
    });
  }

  // === Write Functions ===

  async deployRecoveryManager(
    wallet: Address,
    guardians: Guardian[],
    threshold: bigint,
    challengePeriod: bigint,
  ): Promise<Hex> {
    if (!this.walletClient) {
      throw new Error('WalletClient required for write operations');
    }
    const account = this.walletClient.account;
    if (!account) {
      throw new Error('WalletClient has no account attached');
    }
    return this.walletClient.writeContract({
      account,
      address: this.address,
      abi: RecoveryManagerFactoryAbi,
      functionName: 'deployRecoveryManager',
      args: [
        wallet,
        guardians.map((g) => ({
          guardianType: g.guardianType,
          identifier: g.identifier,
        })),
        threshold,
        challengePeriod,
      ],
      chain: this.walletClient.chain,
    });
  }
}
