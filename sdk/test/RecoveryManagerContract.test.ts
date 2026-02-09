import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecoveryManagerContract } from '../src/contracts/RecoveryManagerContract';
import { GuardianType } from '../src/types';
import type { Address, Hex, PublicClient, WalletClient } from 'viem';

const TEST_ADDRESS = '0x1234567890123456789012345678901234567890' as Address;

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

describe('RecoveryManagerContract', () => {
  describe('read functions', () => {
    it('should read wallet address', async () => {
      const publicClient = createMockPublicClient();
      (publicClient.readContract as any).mockResolvedValue('0xwallet' as Address);

      const contract = new RecoveryManagerContract({
        address: TEST_ADDRESS,
        publicClient,
      });

      const wallet = await contract.wallet();
      expect(wallet).toBe('0xwallet');
      expect(publicClient.readContract).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: 'wallet' }),
      );
    });

    it('should read threshold', async () => {
      const publicClient = createMockPublicClient();
      (publicClient.readContract as any).mockResolvedValue(2n);

      const contract = new RecoveryManagerContract({
        address: TEST_ADDRESS,
        publicClient,
      });

      const threshold = await contract.threshold();
      expect(threshold).toBe(2n);
    });

    it('should read challengePeriod', async () => {
      const publicClient = createMockPublicClient();
      (publicClient.readContract as any).mockResolvedValue(86400n);

      const contract = new RecoveryManagerContract({
        address: TEST_ADDRESS,
        publicClient,
      });

      const period = await contract.challengePeriod();
      expect(period).toBe(86400n);
    });

    it('should read nonce', async () => {
      const publicClient = createMockPublicClient();
      (publicClient.readContract as any).mockResolvedValue(0n);

      const contract = new RecoveryManagerContract({
        address: TEST_ADDRESS,
        publicClient,
      });

      const nonce = await contract.nonce();
      expect(nonce).toBe(0n);
    });

    it('should map getGuardian return to Guardian type', async () => {
      const publicClient = createMockPublicClient();
      (publicClient.readContract as any).mockResolvedValue({
        guardianType: 0,
        identifier: ('0x' + '11'.repeat(32)) as Hex,
      });

      const contract = new RecoveryManagerContract({
        address: TEST_ADDRESS,
        publicClient,
      });

      const guardian = await contract.getGuardian(0n);
      expect(guardian.guardianType).toBe(0);
      expect(guardian.identifier).toBe('0x' + '11'.repeat(32));
    });

    it('should map getSession return to RecoverySession', async () => {
      const publicClient = createMockPublicClient();
      (publicClient.readContract as any).mockResolvedValue([
        ('0x' + 'aa'.repeat(32)) as Hex,
        '0x2222222222222222222222222222222222222222' as Address,
        1000n,
        500n,
        2n,
      ]);

      const contract = new RecoveryManagerContract({
        address: TEST_ADDRESS,
        publicClient,
      });

      const session = await contract.getSession();
      expect(session.intentHash).toBe('0x' + 'aa'.repeat(32));
      expect(session.newOwner).toBe('0x2222222222222222222222222222222222222222');
      expect(session.deadline).toBe(1000n);
      expect(session.thresholdMetAt).toBe(500n);
      expect(session.approvalCount).toBe(2n);
    });

    it('should read isRecoveryActive', async () => {
      const publicClient = createMockPublicClient();
      (publicClient.readContract as any).mockResolvedValue(false);

      const contract = new RecoveryManagerContract({
        address: TEST_ADDRESS,
        publicClient,
      });

      const active = await contract.isRecoveryActive();
      expect(active).toBe(false);
    });

    it('should read hasApproved', async () => {
      const publicClient = createMockPublicClient();
      (publicClient.readContract as any).mockResolvedValue(true);

      const contract = new RecoveryManagerContract({
        address: TEST_ADDRESS,
        publicClient,
      });

      const approved = await contract.hasApproved(('0x' + '11'.repeat(32)) as Hex);
      expect(approved).toBe(true);
    });
  });

  describe('write functions', () => {
    it('should call startRecovery with correct args', async () => {
      const publicClient = createMockPublicClient();
      const walletClient = createMockWalletClient();

      const contract = new RecoveryManagerContract({
        address: TEST_ADDRESS,
        publicClient,
        walletClient,
      });

      const intent = {
        wallet: '0x1111111111111111111111111111111111111111' as Address,
        newOwner: '0x2222222222222222222222222222222222222222' as Address,
        nonce: 0n,
        deadline: 999999n,
        chainId: 1n,
        recoveryManager: TEST_ADDRESS,
      };

      const txHash = await contract.startRecovery(intent, 0n, '0xproof' as Hex);
      expect(txHash).toBe('0xtxhash');
      expect(walletClient.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'startRecovery',
        }),
      );
    });

    it('should call submitProof', async () => {
      const publicClient = createMockPublicClient();
      const walletClient = createMockWalletClient();

      const contract = new RecoveryManagerContract({
        address: TEST_ADDRESS,
        publicClient,
        walletClient,
      });

      const txHash = await contract.submitProof(1n, '0xproof' as Hex);
      expect(txHash).toBe('0xtxhash');
    });

    it('should call executeRecovery', async () => {
      const publicClient = createMockPublicClient();
      const walletClient = createMockWalletClient();

      const contract = new RecoveryManagerContract({
        address: TEST_ADDRESS,
        publicClient,
        walletClient,
      });

      const txHash = await contract.executeRecovery();
      expect(txHash).toBe('0xtxhash');
    });

    it('should call cancelRecovery', async () => {
      const publicClient = createMockPublicClient();
      const walletClient = createMockWalletClient();

      const contract = new RecoveryManagerContract({
        address: TEST_ADDRESS,
        publicClient,
        walletClient,
      });

      const txHash = await contract.cancelRecovery();
      expect(txHash).toBe('0xtxhash');
    });

    it('should call updatePolicy with guardian payload', async () => {
      const publicClient = createMockPublicClient();
      const walletClient = createMockWalletClient();

      const contract = new RecoveryManagerContract({
        address: TEST_ADDRESS,
        publicClient,
        walletClient,
      });

      const txHash = await contract.updatePolicy(
        [
          {
            guardianType: GuardianType.EOA,
            identifier: ('0x' + '11'.repeat(32)) as Hex,
          },
        ],
        1n,
        3600n,
      );

      expect(txHash).toBe('0xtxhash');
      expect(walletClient.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'updatePolicy',
          args: [
            [
              {
                guardianType: GuardianType.EOA,
                identifier: ('0x' + '11'.repeat(32)) as Hex,
              },
            ],
            1n,
            3600n,
          ],
        }),
      );
    });

    it('should throw when no walletClient for write ops', async () => {
      const publicClient = createMockPublicClient();
      const contract = new RecoveryManagerContract({
        address: TEST_ADDRESS,
        publicClient,
      });

      await expect(contract.executeRecovery()).rejects.toThrow('WalletClient required');
      await expect(
        contract.updatePolicy(
          [
            {
              guardianType: GuardianType.EOA,
              identifier: ('0x' + '11'.repeat(32)) as Hex,
            },
          ],
          1n,
          0n,
        ),
      ).rejects.toThrow('WalletClient required');
    });
  });
});
