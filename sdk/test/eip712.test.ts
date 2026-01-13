import { describe, it, expect } from 'vitest';
import { hashRecoveryIntent, createRecoveryIntent, isValidIntent } from '../src/auth/utils/eip712';
import type { RecoveryIntent } from '../src/types';

describe('eip712 utils', () => {
  const testIntent: RecoveryIntent = {
    wallet: '0x1111111111111111111111111111111111111111',
    newOwner: '0x2222222222222222222222222222222222222222',
    nonce: 0n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 86400), // 1 day from now
    chainId: 1n,
    recoveryManager: '0x3333333333333333333333333333333333333333',
  };

  describe('hashRecoveryIntent', () => {
    it('should produce consistent hashes', () => {
      const hash1 = hashRecoveryIntent(testIntent);
      const hash2 = hashRecoveryIntent(testIntent);
      expect(hash1).toBe(hash2);
    });

    it('should produce 32-byte hash', () => {
      const hash = hashRecoveryIntent(testIntent);
      expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
    });

    it('should produce different hashes for different nonces', () => {
      const intent1 = { ...testIntent, nonce: 0n };
      const intent2 = { ...testIntent, nonce: 1n };
      expect(hashRecoveryIntent(intent1)).not.toBe(hashRecoveryIntent(intent2));
    });

    it('should produce different hashes for different chainIds', () => {
      const intent1 = { ...testIntent, chainId: 1n };
      const intent2 = { ...testIntent, chainId: 137n };
      expect(hashRecoveryIntent(intent1)).not.toBe(hashRecoveryIntent(intent2));
    });

    it('should produce different hashes for different recoveryManagers', () => {
      const intent1 = { ...testIntent, recoveryManager: '0x1111111111111111111111111111111111111111' as const };
      const intent2 = { ...testIntent, recoveryManager: '0x2222222222222222222222222222222222222222' as const };
      expect(hashRecoveryIntent(intent1)).not.toBe(hashRecoveryIntent(intent2));
    });

    it('should produce different hashes for different newOwners', () => {
      const intent1 = { ...testIntent, newOwner: '0x1111111111111111111111111111111111111111' as const };
      const intent2 = { ...testIntent, newOwner: '0x2222222222222222222222222222222222222222' as const };
      expect(hashRecoveryIntent(intent1)).not.toBe(hashRecoveryIntent(intent2));
    });

    it('should produce different hashes for different deadlines', () => {
      const intent1 = { ...testIntent, deadline: 1000n };
      const intent2 = { ...testIntent, deadline: 2000n };
      expect(hashRecoveryIntent(intent1)).not.toBe(hashRecoveryIntent(intent2));
    });
  });

  describe('createRecoveryIntent', () => {
    it('should create intent with default deadline', () => {
      const intent = createRecoveryIntent({
        wallet: '0x1111111111111111111111111111111111111111',
        newOwner: '0x2222222222222222222222222222222222222222',
        recoveryManager: '0x3333333333333333333333333333333333333333',
        nonce: 0n,
        chainId: 1n,
      });

      expect(intent.wallet).toBe('0x1111111111111111111111111111111111111111');
      expect(intent.newOwner).toBe('0x2222222222222222222222222222222222222222');
      expect(intent.nonce).toBe(0n);
      expect(intent.chainId).toBe(1n);

      // Deadline should be approximately 24 hours from now
      const now = BigInt(Math.floor(Date.now() / 1000));
      expect(intent.deadline).toBeGreaterThan(now);
      expect(intent.deadline).toBeLessThanOrEqual(now + 86400n + 10n); // Allow 10 seconds tolerance
    });

    it('should create intent with custom deadline', () => {
      const intent = createRecoveryIntent({
        wallet: '0x1111111111111111111111111111111111111111',
        newOwner: '0x2222222222222222222222222222222222222222',
        recoveryManager: '0x3333333333333333333333333333333333333333',
        nonce: 0n,
        chainId: 1n,
        deadlineSeconds: 3600, // 1 hour
      });

      const now = BigInt(Math.floor(Date.now() / 1000));
      expect(intent.deadline).toBeGreaterThan(now);
      expect(intent.deadline).toBeLessThanOrEqual(now + 3600n + 10n);
    });
  });

  describe('isValidIntent', () => {
    it('should return true for valid intent', () => {
      expect(isValidIntent(testIntent)).toBe(true);
    });

    it('should return false for zero wallet address', () => {
      const intent = {
        ...testIntent,
        wallet: '0x0000000000000000000000000000000000000000' as const,
      };
      expect(isValidIntent(intent)).toBe(false);
    });

    it('should return false for zero newOwner address', () => {
      const intent = {
        ...testIntent,
        newOwner: '0x0000000000000000000000000000000000000000' as const,
      };
      expect(isValidIntent(intent)).toBe(false);
    });

    it('should return false for zero recoveryManager address', () => {
      const intent = {
        ...testIntent,
        recoveryManager: '0x0000000000000000000000000000000000000000' as const,
      };
      expect(isValidIntent(intent)).toBe(false);
    });

    it('should return false for expired deadline', () => {
      const intent = {
        ...testIntent,
        deadline: BigInt(Math.floor(Date.now() / 1000) - 1), // 1 second ago
      };
      expect(isValidIntent(intent)).toBe(false);
    });

    it('should return false for zero chainId', () => {
      const intent = { ...testIntent, chainId: 0n };
      expect(isValidIntent(intent)).toBe(false);
    });
  });
});
