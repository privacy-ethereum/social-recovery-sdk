import { getContract, type PublicClient, type WalletClient, type Address, type Hex } from 'viem';
import { RecoveryManagerAbi } from './abis';
import type { RecoveryIntent, RecoverySession, Guardian, GuardianType } from '../types';

export interface RecoveryManagerContractConfig {
  address: Address;
  publicClient: PublicClient;
  walletClient?: WalletClient;
}

export class RecoveryManagerContract {
  readonly address: Address;

  private readonly publicClient: PublicClient;
  private readonly walletClient?: WalletClient;

  constructor(config: RecoveryManagerContractConfig) {
    this.address = config.address;
    this.publicClient = config.publicClient;
    this.walletClient = config.walletClient;
  }

  // === Read Functions ===

  async wallet(): Promise<Address> {
    return this.publicClient.readContract({
      address: this.address,
      abi: RecoveryManagerAbi,
      functionName: 'wallet',
    });
  }

  async threshold(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.address,
      abi: RecoveryManagerAbi,
      functionName: 'threshold',
    });
  }

  async challengePeriod(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.address,
      abi: RecoveryManagerAbi,
      functionName: 'challengePeriod',
    });
  }

  async nonce(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.address,
      abi: RecoveryManagerAbi,
      functionName: 'nonce',
    });
  }

  async guardianCount(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.address,
      abi: RecoveryManagerAbi,
      functionName: 'guardianCount',
    });
  }

  async getGuardian(index: bigint): Promise<Guardian> {
    const result = await this.publicClient.readContract({
      address: this.address,
      abi: RecoveryManagerAbi,
      functionName: 'getGuardian',
      args: [index],
    });
    return {
      guardianType: result.guardianType as GuardianType,
      identifier: result.identifier,
    };
  }

  async isRecoveryActive(): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.address,
      abi: RecoveryManagerAbi,
      functionName: 'isRecoveryActive',
    });
  }

  async getSession(): Promise<RecoverySession> {
    const [intentHash, newOwner, deadline, thresholdMetAt, approvalCount] =
      await this.publicClient.readContract({
        address: this.address,
        abi: RecoveryManagerAbi,
        functionName: 'getSession',
      });
    return { intentHash, newOwner, deadline, thresholdMetAt, approvalCount };
  }

  async hasApproved(guardianIdentifier: Hex): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.address,
      abi: RecoveryManagerAbi,
      functionName: 'hasApproved',
      args: [guardianIdentifier],
    });
  }

  // === Write Functions ===

  async startRecovery(intent: RecoveryIntent, guardianIndex: bigint, proof: Hex): Promise<Hex> {
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
      abi: RecoveryManagerAbi,
      functionName: 'startRecovery',
      args: [
        {
          wallet: intent.wallet,
          newOwner: intent.newOwner,
          nonce: intent.nonce,
          deadline: intent.deadline,
          chainId: intent.chainId,
          recoveryManager: intent.recoveryManager,
        },
        guardianIndex,
        proof,
      ],
      chain: this.walletClient.chain,
    });
  }

  async submitProof(guardianIndex: bigint, proof: Hex): Promise<Hex> {
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
      abi: RecoveryManagerAbi,
      functionName: 'submitProof',
      args: [guardianIndex, proof],
      chain: this.walletClient.chain,
    });
  }

  async executeRecovery(): Promise<Hex> {
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
      abi: RecoveryManagerAbi,
      functionName: 'executeRecovery',
      chain: this.walletClient.chain,
    });
  }

  async cancelRecovery(): Promise<Hex> {
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
      abi: RecoveryManagerAbi,
      functionName: 'cancelRecovery',
      chain: this.walletClient.chain,
    });
  }

  async updatePolicy(guardians: Guardian[], threshold: bigint, challengePeriod: bigint): Promise<Hex> {
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
      abi: RecoveryManagerAbi,
      functionName: 'updatePolicy',
      args: [
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
