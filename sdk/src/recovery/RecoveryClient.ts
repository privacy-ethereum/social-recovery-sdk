import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import { RecoveryManagerContract } from '../contracts/RecoveryManagerContract';
import { FactoryContract } from '../contracts/FactoryContract';
import { AuthManager } from '../auth/AuthManager';
import { isValidIntent } from '../auth/utils/eip712';
import type { Guardian, RecoveryIntent, RecoverySession, RecoveryPolicy, GuardianProof } from '../types';

export interface RecoveryClientConfig {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  factoryAddress?: Address;
  recoveryManagerAddress?: Address;
}

export class RecoveryClient {
  private readonly publicClient: PublicClient;
  private readonly walletClient?: WalletClient;
  private factory?: FactoryContract;
  private recoveryManager?: RecoveryManagerContract;
  private readonly authManager: AuthManager;

  constructor(config: RecoveryClientConfig) {
    this.publicClient = config.publicClient;
    this.walletClient = config.walletClient;
    this.authManager = new AuthManager();

    if (config.factoryAddress) {
      this.factory = new FactoryContract({
        address: config.factoryAddress,
        publicClient: this.publicClient,
        walletClient: this.walletClient,
      });
    }

    if (config.recoveryManagerAddress) {
      this.recoveryManager = new RecoveryManagerContract({
        address: config.recoveryManagerAddress,
        publicClient: this.publicClient,
        walletClient: this.walletClient,
      });
    }
  }

  getAuthManager(): AuthManager {
    return this.authManager;
  }

  // --- Deployment ---

  async deployRecoveryManager(policy: RecoveryPolicy): Promise<Address> {
    if (!this.factory) {
      throw new Error('Factory address not configured');
    }
    if (!this.walletClient) {
      throw new Error('WalletClient required for deployment');
    }

    const txHash = await this.factory.deployRecoveryManager(
      policy.wallet,
      policy.guardians,
      policy.threshold,
      policy.challengePeriod,
    );

    // Wait for the transaction receipt to get the deployed address
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    // Get the deployed RecoveryManager address from the factory
    const rmAddress = await this.factory.getRecoveryManager(policy.wallet);

    // Store it for future use
    this.setRecoveryManager(rmAddress);

    return rmAddress;
  }

  // --- Recovery Flow ---

  async startRecovery(params: {
    intent: RecoveryIntent;
    guardianIndex: bigint;
    proof: GuardianProof;
  }): Promise<Hex> {
    const rm = this.getRecoveryManagerOrThrow();

    if (!isValidIntent(params.intent)) {
      throw new Error('Recovery intent is invalid');
    }

    return rm.startRecovery(params.intent, params.guardianIndex, params.proof.proof);
  }

  async submitProof(params: { guardianIndex: bigint; proof: GuardianProof }): Promise<Hex> {
    const rm = this.getRecoveryManagerOrThrow();
    return rm.submitProof(params.guardianIndex, params.proof.proof);
  }

  async executeRecovery(): Promise<Hex> {
    const rm = this.getRecoveryManagerOrThrow();
    return rm.executeRecovery();
  }

  async cancelRecovery(): Promise<Hex> {
    const rm = this.getRecoveryManagerOrThrow();
    return rm.cancelRecovery();
  }

  // --- Queries ---

  async getSession(): Promise<RecoverySession> {
    const rm = this.getRecoveryManagerOrThrow();
    return rm.getSession();
  }

  async isRecoveryActive(): Promise<boolean> {
    const rm = this.getRecoveryManagerOrThrow();
    return rm.isRecoveryActive();
  }

  async getPolicy(): Promise<RecoveryPolicy> {
    const rm = this.getRecoveryManagerOrThrow();

    const [wallet, threshold, challengePeriod, count] = await Promise.all([
      rm.wallet(),
      rm.threshold(),
      rm.challengePeriod(),
      rm.guardianCount(),
    ]);

    const guardians: Guardian[] = [];
    for (let i = 0n; i < count; i++) {
      guardians.push(await rm.getGuardian(i));
    }

    return { wallet, threshold, challengePeriod, guardians };
  }

  async getNonce(): Promise<bigint> {
    const rm = this.getRecoveryManagerOrThrow();
    return rm.nonce();
  }

  async isReadyToExecute(): Promise<boolean> {
    const rm = this.getRecoveryManagerOrThrow();

    const [active, session, threshold, challengePeriod] = await Promise.all([
      rm.isRecoveryActive(),
      rm.getSession(),
      rm.threshold(),
      rm.challengePeriod(),
    ]);

    if (!active) return false;
    if (session.approvalCount < threshold) return false;
    if (session.thresholdMetAt === 0n) return false;

    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now < session.thresholdMetAt + challengePeriod) return false;
    if (now >= session.deadline) return false;

    return true;
  }

  // --- Setters ---

  setRecoveryManager(address: Address): void {
    this.recoveryManager = new RecoveryManagerContract({
      address,
      publicClient: this.publicClient,
      walletClient: this.walletClient,
    });
  }

  private getRecoveryManagerOrThrow(): RecoveryManagerContract {
    if (!this.recoveryManager) {
      throw new Error('RecoveryManager address not set. Call setRecoveryManager() or deployRecoveryManager() first.');
    }
    return this.recoveryManager;
  }
}
