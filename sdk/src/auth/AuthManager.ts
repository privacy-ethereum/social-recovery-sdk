import type { Hex } from 'viem';
import type { IAuthAdapter, ProofResult } from './adapters/IAuthAdapter';
import type { GuardianType, RecoveryIntent } from '../types';

export class AuthManager {
  private adapters: Map<GuardianType, IAuthAdapter> = new Map();

  registerAdapter(adapter: IAuthAdapter): void {
    this.adapters.set(adapter.guardianType, adapter);
  }

  getAdapter(guardianType: GuardianType): IAuthAdapter | undefined {
    return this.adapters.get(guardianType);
  }

  hasAdapter(guardianType: GuardianType): boolean {
    return this.adapters.has(guardianType);
  }

  async generateProof(
    guardianType: GuardianType,
    intent: RecoveryIntent,
    guardianIdentifier: Hex,
  ): Promise<ProofResult> {
    const adapter = this.adapters.get(guardianType);
    if (!adapter) {
      throw new Error(`No adapter registered for guardian type ${guardianType}`);
    }
    return adapter.generateProof(intent, guardianIdentifier);
  }

  computeIdentifier(guardianType: GuardianType, credentials: unknown): Hex {
    const adapter = this.adapters.get(guardianType);
    if (!adapter) {
      throw new Error(`No adapter registered for guardian type ${guardianType}`);
    }
    return adapter.computeIdentifier(credentials);
  }
}
