import { describe, it, expect, vi } from 'vitest';
import { FactoryContract } from '../src/contracts/FactoryContract';
import { GuardianType } from '../src/types';
import type { Address, Hex, PublicClient, WalletClient } from 'viem';

const FACTORY_ADDRESS = '0xfactoryfactoryfactoryfactoryfactory00000' as Address;

function createMockPublicClient() {
  return {
    readContract: vi.fn(),
  } as unknown as PublicClient;
}

function createMockWalletClient() {
  return {
    account: { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    chain: { id: 1 },
    writeContract: vi.fn().mockResolvedValue('0xtxhash' as Hex),
  } as unknown as WalletClient;
}

describe('FactoryContract', () => {
  describe('read functions', () => {
    it('should read getRecoveryManager', async () => {
      const publicClient = createMockPublicClient();
      const rmAddress = '0x1234567890123456789012345678901234567890' as Address;
      (publicClient.readContract as any).mockResolvedValue(rmAddress);

      const factory = new FactoryContract({
        address: FACTORY_ADDRESS,
        publicClient,
      });

      const result = await factory.getRecoveryManager(
        '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      );
      expect(result).toBe(rmAddress);
    });

    it('should read implementation', async () => {
      const publicClient = createMockPublicClient();
      (publicClient.readContract as any).mockResolvedValue('0ximpl' as Address);

      const factory = new FactoryContract({
        address: FACTORY_ADDRESS,
        publicClient,
      });

      const impl = await factory.implementation();
      expect(impl).toBe('0ximpl');
    });

    it('should read passkeyVerifier', async () => {
      const publicClient = createMockPublicClient();
      (publicClient.readContract as any).mockResolvedValue('0xpasskey' as Address);

      const factory = new FactoryContract({
        address: FACTORY_ADDRESS,
        publicClient,
      });

      const verifier = await factory.passkeyVerifier();
      expect(verifier).toBe('0xpasskey');
    });

    it('should read zkJwtVerifier', async () => {
      const publicClient = createMockPublicClient();
      (publicClient.readContract as any).mockResolvedValue('0xzkjwt' as Address);

      const factory = new FactoryContract({
        address: FACTORY_ADDRESS,
        publicClient,
      });

      const verifier = await factory.zkJwtVerifier();
      expect(verifier).toBe('0xzkjwt');
    });
  });

  describe('write functions', () => {
    it('should call deployRecoveryManager with correct args', async () => {
      const publicClient = createMockPublicClient();
      const walletClient = createMockWalletClient();

      const factory = new FactoryContract({
        address: FACTORY_ADDRESS,
        publicClient,
        walletClient,
      });

      const guardians = [
        {
          guardianType: GuardianType.EOA,
          identifier: ('0x' + '11'.repeat(32)) as Hex,
        },
      ];

      const txHash = await factory.deployRecoveryManager(
        '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        guardians,
        1n,
        86400n,
      );

      expect(txHash).toBe('0xtxhash');
      expect(walletClient.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'deployRecoveryManager',
        }),
      );
    });

    it('should throw when no walletClient', async () => {
      const publicClient = createMockPublicClient();
      const factory = new FactoryContract({
        address: FACTORY_ADDRESS,
        publicClient,
      });

      await expect(
        factory.deployRecoveryManager(
          '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          [],
          1n,
          86400n,
        ),
      ).rejects.toThrow('WalletClient required');
    });
  });
});
