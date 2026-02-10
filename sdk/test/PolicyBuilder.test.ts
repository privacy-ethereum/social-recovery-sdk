import { describe, it, expect } from 'vitest';
import { pad, keccak256, encodePacked } from 'viem';
import { PolicyBuilder } from '../src/recovery/PolicyBuilder';
import { GuardianType } from '../src/types';
import { DEFAULT_CHALLENGE_PERIOD } from '../src/constants';
import type { Address, Hex } from 'viem';

describe('PolicyBuilder', () => {
  const testWallet: Address = '0x1111111111111111111111111111111111111111';
  const eoaAddress: Address = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const passkeyPubKey = { x: 100n, y: 200n };
  const zkjwtCommitment =
    '0x0000000000000000000000000000000000000000000000000000000000001234' as Hex;

  describe('build with EOA guardians', () => {
    it('should build a valid policy', () => {
      const policy = new PolicyBuilder()
        .setWallet(testWallet)
        .addEoaGuardian(eoaAddress)
        .setThreshold(1)
        .build();

      expect(policy.wallet).toBe(testWallet);
      expect(policy.threshold).toBe(1n);
      expect(policy.challengePeriod).toBe(DEFAULT_CHALLENGE_PERIOD);
      expect(policy.guardians).toHaveLength(1);
      expect(policy.guardians[0].guardianType).toBe(GuardianType.EOA);
      expect(policy.guardians[0].identifier).toBe(pad(eoaAddress, { size: 32 }));
    });
  });

  describe('build with mixed guardian types', () => {
    it('should build a policy with all three guardian types', () => {
      const policy = new PolicyBuilder()
        .setWallet(testWallet)
        .addEoaGuardian(eoaAddress)
        .addPasskeyGuardian(passkeyPubKey)
        .addZkJwtGuardian(zkjwtCommitment)
        .setThreshold(2)
        .build();

      expect(policy.guardians).toHaveLength(3);
      expect(policy.guardians[0].guardianType).toBe(GuardianType.EOA);
      expect(policy.guardians[1].guardianType).toBe(GuardianType.Passkey);
      expect(policy.guardians[2].guardianType).toBe(GuardianType.ZkJWT);
      expect(policy.threshold).toBe(2n);
    });
  });

  describe('identifier encoding', () => {
    it('should left-pad EOA address to bytes32', () => {
      const policy = new PolicyBuilder()
        .setWallet(testWallet)
        .addEoaGuardian(eoaAddress)
        .setThreshold(1)
        .build();

      const expected = pad(eoaAddress, { size: 32 });
      expect(policy.guardians[0].identifier).toBe(expected);
    });

    it('should compute keccak256 for passkey guardian', () => {
      const policy = new PolicyBuilder()
        .setWallet(testWallet)
        .addPasskeyGuardian(passkeyPubKey)
        .setThreshold(1)
        .build();

      const expected = keccak256(
        encodePacked(['uint256', 'uint256'], [passkeyPubKey.x, passkeyPubKey.y]),
      );
      expect(policy.guardians[0].identifier).toBe(expected);
    });

    it('should use commitment directly for zkJWT guardian', () => {
      const policy = new PolicyBuilder()
        .setWallet(testWallet)
        .addZkJwtGuardian(zkjwtCommitment)
        .setThreshold(1)
        .build();

      expect(policy.guardians[0].identifier).toBe(zkjwtCommitment);
    });
  });

  describe('challenge period', () => {
    it('should use default challenge period', () => {
      const policy = new PolicyBuilder()
        .setWallet(testWallet)
        .addEoaGuardian(eoaAddress)
        .setThreshold(1)
        .build();

      expect(policy.challengePeriod).toBe(DEFAULT_CHALLENGE_PERIOD);
    });

    it('should allow custom challenge period', () => {
      const policy = new PolicyBuilder()
        .setWallet(testWallet)
        .addEoaGuardian(eoaAddress)
        .setThreshold(1)
        .setChallengePeriod(3600)
        .build();

      expect(policy.challengePeriod).toBe(3600n);
    });
  });

  describe('fluent chaining', () => {
    it('should support method chaining', () => {
      const builder = new PolicyBuilder();
      const result = builder.setWallet(testWallet).addEoaGuardian(eoaAddress).setThreshold(1);
      expect(result).toBe(builder);
    });
  });

  describe('validation', () => {
    it('should throw if wallet not set', () => {
      expect(() => {
        new PolicyBuilder().addEoaGuardian(eoaAddress).setThreshold(1).build();
      }).toThrow('Wallet address is required');
    });

    it('should throw if wallet is zero address', () => {
      expect(() => {
        new PolicyBuilder()
          .setWallet('0x0000000000000000000000000000000000000000')
          .addEoaGuardian(eoaAddress)
          .setThreshold(1)
          .build();
      }).toThrow('Wallet address cannot be zero');
    });

    it('should throw if no guardians', () => {
      expect(() => {
        new PolicyBuilder().setWallet(testWallet).setThreshold(1).build();
      }).toThrow('At least one guardian is required');
    });

    it('should throw if threshold is zero', () => {
      expect(() => {
        new PolicyBuilder().setWallet(testWallet).addEoaGuardian(eoaAddress).build();
      }).toThrow('Threshold must be greater than 0');
    });

    it('should throw if threshold exceeds guardian count', () => {
      expect(() => {
        new PolicyBuilder()
          .setWallet(testWallet)
          .addEoaGuardian(eoaAddress)
          .setThreshold(2)
          .build();
      }).toThrow('Threshold cannot exceed number of guardians');
    });

    it('should throw on zero identifier', () => {
      expect(() => {
        new PolicyBuilder()
          .setWallet(testWallet)
          .addZkJwtGuardian(
            '0x0000000000000000000000000000000000000000000000000000000000000000',
          )
          .setThreshold(1)
          .build();
      }).toThrow('zero identifier');
    });

    it('should throw on duplicate guardian identifiers', () => {
      expect(() => {
        new PolicyBuilder()
          .setWallet(testWallet)
          .addEoaGuardian(eoaAddress)
          .addEoaGuardian(eoaAddress)
          .setThreshold(1)
          .build();
      }).toThrow('Duplicate guardian identifier');
    });
  });
});
