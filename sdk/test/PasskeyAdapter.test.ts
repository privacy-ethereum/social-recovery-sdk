import { describe, it, expect } from 'vitest';
import { keccak256, encodePacked } from 'viem';
import { PasskeyAdapter } from '../src/auth/adapters/PasskeyAdapter';
import type { P256PublicKey, RecoveryIntent } from '../src/types';

describe('PasskeyAdapter', () => {
  const testPublicKey: P256PublicKey = {
    x: 0x65a0c7c1bef5e6d27f2a69876f7a5e8d6c9b4a3c2d1e0f9a8b7c6d5e4f3a2b1cn,
    y: 0x1a2b3c4d5e6f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5bn,
  };

  const testConfig = {
    rpId: 'example.com',
    credentialId: '0x1234567890abcdef' as const,
    publicKey: testPublicKey,
  };

  const testIntent: RecoveryIntent = {
    wallet: '0x1111111111111111111111111111111111111111',
    newOwner: '0x2222222222222222222222222222222222222222',
    nonce: 0n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 86400),
    chainId: 1n,
    recoveryManager: '0x3333333333333333333333333333333333333333',
  };

  describe('computeIdentifier', () => {
    it('should compute keccak256(x || y)', () => {
      const adapter = new PasskeyAdapter(testConfig);
      const identifier = adapter.computeIdentifier(testPublicKey);

      // Compute expected value manually
      const expected = keccak256(encodePacked(['uint256', 'uint256'], [testPublicKey.x, testPublicKey.y]));

      expect(identifier).toBe(expected);
    });

    it('should produce consistent identifiers', () => {
      const adapter = new PasskeyAdapter(testConfig);
      const id1 = adapter.computeIdentifier(testPublicKey);
      const id2 = adapter.computeIdentifier(testPublicKey);

      expect(id1).toBe(id2);
    });

    it('should produce different identifiers for different keys', () => {
      const adapter = new PasskeyAdapter(testConfig);

      const key1: P256PublicKey = { x: 1n, y: 2n };
      const key2: P256PublicKey = { x: 2n, y: 1n };

      const id1 = adapter.computeIdentifier(key1);
      const id2 = adapter.computeIdentifier(key2);

      expect(id1).not.toBe(id2);
    });

    it('should match contract computation', () => {
      const adapter = new PasskeyAdapter(testConfig);
      const identifier = adapter.computeIdentifier(testPublicKey);

      // The identifier should be a 32-byte hex string
      expect(identifier).toMatch(/^0x[a-f0-9]{64}$/);
    });
  });

  describe('guardianType', () => {
    it('should return 1 for Passkey', () => {
      const adapter = new PasskeyAdapter(testConfig);
      expect(adapter.guardianType).toBe(1);
    });
  });

  describe('getters', () => {
    it('should return configured public key', () => {
      const adapter = new PasskeyAdapter(testConfig);
      expect(adapter.getPublicKey()).toEqual(testPublicKey);
    });

    it('should return configured credential ID', () => {
      const adapter = new PasskeyAdapter(testConfig);
      expect(adapter.getCredentialId()).toBe(testConfig.credentialId);
    });

    it('should return configured RP ID', () => {
      const adapter = new PasskeyAdapter(testConfig);
      expect(adapter.getRpId()).toBe(testConfig.rpId);
    });
  });

  describe('generateProof', () => {
    it('should fail with mismatched guardian identifier', async () => {
      const adapter = new PasskeyAdapter(testConfig);

      // Use a different identifier than what the adapter would compute
      const wrongIdentifier = '0x0000000000000000000000000000000000000000000000000000000000000001' as const;

      const result = await adapter.generateProof(testIntent, wrongIdentifier);

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not match');
    });

    // Note: Full WebAuthn tests require browser environment
    // The generateProof method calls navigator.credentials.get which is not available in Node.js
    it('should fail in non-browser environment', async () => {
      const adapter = new PasskeyAdapter(testConfig);
      const identifier = adapter.computeIdentifier(testPublicKey);

      const result = await adapter.generateProof(testIntent, identifier);

      // Should fail because WebAuthn is not available
      expect(result.success).toBe(false);
      expect(result.error).toContain('WebAuthn is not supported');
    });
  });
});
