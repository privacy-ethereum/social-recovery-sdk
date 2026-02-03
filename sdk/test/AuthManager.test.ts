import { describe, it, expect, vi } from 'vitest';
import { AuthManager } from '../src/auth/AuthManager';
import { GuardianType } from '../src/types';
import type { IAuthAdapter, ProofResult } from '../src/auth/adapters/IAuthAdapter';
import type { RecoveryIntent } from '../src/types';
import type { Hex } from 'viem';

function createMockAdapter(type: GuardianType): IAuthAdapter {
  return {
    guardianType: type,
    generateProof: vi.fn().mockResolvedValue({
      success: true,
      proof: {
        guardianIdentifier: '0x' + '11'.repeat(32),
        guardianType: type,
        proof: '0xdeadbeef' as Hex,
      },
    } satisfies ProofResult),
    computeIdentifier: vi.fn().mockReturnValue(('0x' + '22'.repeat(32)) as Hex),
  };
}

const testIntent: RecoveryIntent = {
  wallet: '0x1111111111111111111111111111111111111111',
  newOwner: '0x2222222222222222222222222222222222222222',
  nonce: 0n,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 86400),
  chainId: 1n,
  recoveryManager: '0x3333333333333333333333333333333333333333',
};

describe('AuthManager', () => {
  describe('registerAdapter / getAdapter', () => {
    it('should register and retrieve adapters', () => {
      const manager = new AuthManager();
      const eoaAdapter = createMockAdapter(GuardianType.EOA);
      const passkeyAdapter = createMockAdapter(GuardianType.Passkey);

      manager.registerAdapter(eoaAdapter);
      manager.registerAdapter(passkeyAdapter);

      expect(manager.getAdapter(GuardianType.EOA)).toBe(eoaAdapter);
      expect(manager.getAdapter(GuardianType.Passkey)).toBe(passkeyAdapter);
    });

    it('should return undefined for unregistered types', () => {
      const manager = new AuthManager();
      expect(manager.getAdapter(GuardianType.ZkJWT)).toBeUndefined();
    });

    it('should overwrite when registering same type twice', () => {
      const manager = new AuthManager();
      const adapter1 = createMockAdapter(GuardianType.EOA);
      const adapter2 = createMockAdapter(GuardianType.EOA);

      manager.registerAdapter(adapter1);
      manager.registerAdapter(adapter2);

      expect(manager.getAdapter(GuardianType.EOA)).toBe(adapter2);
    });
  });

  describe('hasAdapter', () => {
    it('should return true for registered adapters', () => {
      const manager = new AuthManager();
      manager.registerAdapter(createMockAdapter(GuardianType.EOA));

      expect(manager.hasAdapter(GuardianType.EOA)).toBe(true);
      expect(manager.hasAdapter(GuardianType.Passkey)).toBe(false);
    });
  });

  describe('generateProof', () => {
    it('should route to correct adapter', async () => {
      const manager = new AuthManager();
      const eoaAdapter = createMockAdapter(GuardianType.EOA);
      const zkjwtAdapter = createMockAdapter(GuardianType.ZkJWT);

      manager.registerAdapter(eoaAdapter);
      manager.registerAdapter(zkjwtAdapter);

      const guardianId = ('0x' + '33'.repeat(32)) as Hex;
      await manager.generateProof(GuardianType.EOA, testIntent, guardianId);

      expect(eoaAdapter.generateProof).toHaveBeenCalledWith(testIntent, guardianId);
      expect(zkjwtAdapter.generateProof).not.toHaveBeenCalled();
    });

    it('should throw for unregistered guardian type', async () => {
      const manager = new AuthManager();
      const guardianId = ('0x' + '33'.repeat(32)) as Hex;

      await expect(
        manager.generateProof(GuardianType.ZkJWT, testIntent, guardianId),
      ).rejects.toThrow('No adapter registered');
    });
  });

  describe('computeIdentifier', () => {
    it('should route to correct adapter', () => {
      const manager = new AuthManager();
      const eoaAdapter = createMockAdapter(GuardianType.EOA);
      manager.registerAdapter(eoaAdapter);

      manager.computeIdentifier(GuardianType.EOA, '0x1234');

      expect(eoaAdapter.computeIdentifier).toHaveBeenCalledWith('0x1234');
    });

    it('should throw for unregistered guardian type', () => {
      const manager = new AuthManager();

      expect(() => manager.computeIdentifier(GuardianType.Passkey, {})).toThrow(
        'No adapter registered',
      );
    });
  });
});
