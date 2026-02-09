import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecoveryClient } from '../src/recovery/RecoveryClient';
import { GuardianType } from '../src/types';
import type { Address, Hex, PublicClient, WalletClient } from 'viem';

const FACTORY_ADDRESS = '0xfactoryfactoryfactoryfactoryfactory00000' as Address;
const RM_ADDRESS = '0x1234567890123456789012345678901234567890' as Address;
const WALLET_ADDRESS = '0x1111111111111111111111111111111111111111' as Address;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

function createMockPublicClient() {
  return {
    readContract: vi.fn(),
    getChainId: vi.fn().mockResolvedValue(1),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
  } as unknown as PublicClient;
}

function createMockWalletClient() {
  return {
    account: { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address },
    chain: { id: 1 },
    writeContract: vi.fn().mockResolvedValue('0xtxhash' as Hex),
  } as unknown as WalletClient;
}

describe('RecoveryClient', () => {
  describe('constructor', () => {
    it('should create without factory or recovery manager', () => {
      const client = new RecoveryClient({
        publicClient: createMockPublicClient(),
      });
      expect(client.getAuthManager()).toBeDefined();
    });

    it('should create with factory address', () => {
      const client = new RecoveryClient({
        publicClient: createMockPublicClient(),
        factoryAddress: FACTORY_ADDRESS,
      });
      expect(client).toBeDefined();
    });

    it('should create with recovery manager address', () => {
      const client = new RecoveryClient({
        publicClient: createMockPublicClient(),
        recoveryManagerAddress: RM_ADDRESS,
      });
      expect(client).toBeDefined();
    });
  });

  describe('getAuthManager', () => {
    it('should expose the auth manager for adapter registration', () => {
      const client = new RecoveryClient({
        publicClient: createMockPublicClient(),
      });
      const authManager = client.getAuthManager();
      expect(authManager.hasAdapter(GuardianType.EOA)).toBe(false);
    });
  });

  describe('setRecoveryManager', () => {
    it('should allow setting recovery manager address', () => {
      const client = new RecoveryClient({
        publicClient: createMockPublicClient(),
      });

      // Should not throw
      client.setRecoveryManager(RM_ADDRESS);
    });
  });

  describe('query methods without recovery manager', () => {
    it('should throw when no recovery manager set', async () => {
      const client = new RecoveryClient({
        publicClient: createMockPublicClient(),
      });

      await expect(client.getSession()).rejects.toThrow('RecoveryManager address not set');
      await expect(client.isRecoveryActive()).rejects.toThrow('RecoveryManager address not set');
      await expect(client.getPolicy()).rejects.toThrow('RecoveryManager address not set');
      await expect(client.getNonce()).rejects.toThrow('RecoveryManager address not set');
      await expect(client.executeRecovery()).rejects.toThrow('RecoveryManager address not set');
      await expect(client.cancelRecovery()).rejects.toThrow('RecoveryManager address not set');
      await expect(client.clearExpiredRecovery()).rejects.toThrow('RecoveryManager address not set');
    });
  });

  describe('startRecovery', () => {
    it('should forward intent and proof to recovery manager', async () => {
      const publicClient = createMockPublicClient();
      const walletClient = createMockWalletClient();

      const client = new RecoveryClient({
        publicClient,
        walletClient,
        recoveryManagerAddress: RM_ADDRESS,
      });

      const intent = {
        wallet: WALLET_ADDRESS,
        newOwner: '0x2222222222222222222222222222222222222222' as Address,
        nonce: 0n,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 86400),
        chainId: 1n,
        recoveryManager: RM_ADDRESS,
      };

      const proof = {
        guardianIdentifier: ('0x' + '11'.repeat(32)) as Hex,
        guardianType: 0 as any,
        proof: '0xdeadbeef' as Hex,
      };

      const txHash = await client.startRecovery({
        intent,
        guardianIndex: 0n,
        proof,
      });

      expect(txHash).toBe('0xtxhash');
    });

    it('should reject an invalid intent', async () => {
      const publicClient = createMockPublicClient();
      const walletClient = createMockWalletClient();

      const client = new RecoveryClient({
        publicClient,
        walletClient,
        recoveryManagerAddress: RM_ADDRESS,
      });

      const expiredIntent = {
        wallet: WALLET_ADDRESS,
        newOwner: '0x2222222222222222222222222222222222222222' as Address,
        nonce: 0n,
        deadline: 0n, // expired
        chainId: 1n,
        recoveryManager: RM_ADDRESS,
      };

      const proof = {
        guardianIdentifier: ('0x' + '11'.repeat(32)) as Hex,
        guardianType: 0 as any,
        proof: '0xdeadbeef' as Hex,
      };

      await expect(
        client.startRecovery({ intent: expiredIntent, guardianIndex: 0n, proof }),
      ).rejects.toThrow('invalid');
    });
  });

  describe('query methods with recovery manager', () => {
    it('should forward getSession to contract', async () => {
      const publicClient = createMockPublicClient();
      (publicClient.readContract as any).mockResolvedValue([
        ('0x' + 'aa'.repeat(32)) as Hex,
        '0x2222222222222222222222222222222222222222' as Address,
        1000n,
        500n,
        2n,
      ]);

      const client = new RecoveryClient({
        publicClient,
        recoveryManagerAddress: RM_ADDRESS,
      });

      const session = await client.getSession();
      expect(session.intentHash).toBe('0x' + 'aa'.repeat(32));
      expect(session.approvalCount).toBe(2n);
    });

    it('should forward isRecoveryActive to contract', async () => {
      const publicClient = createMockPublicClient();
      (publicClient.readContract as any).mockResolvedValue(true);

      const client = new RecoveryClient({
        publicClient,
        recoveryManagerAddress: RM_ADDRESS,
      });

      const active = await client.isRecoveryActive();
      expect(active).toBe(true);
    });

    it('should forward getNonce to contract', async () => {
      const publicClient = createMockPublicClient();
      (publicClient.readContract as any).mockResolvedValue(5n);

      const client = new RecoveryClient({
        publicClient,
        recoveryManagerAddress: RM_ADDRESS,
      });

      const nonce = await client.getNonce();
      expect(nonce).toBe(5n);
    });

    it('should return policy with guardians', async () => {
      const publicClient = createMockPublicClient();
      (publicClient.readContract as any).mockImplementation(
        async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
          switch (functionName) {
            case 'wallet':
              return WALLET_ADDRESS;
            case 'threshold':
              return 2n;
            case 'challengePeriod':
              return 86400n;
            case 'guardianCount':
              return 2n;
            case 'getGuardian':
              if ((args?.[0] as bigint) === 0n) {
                return {
                  guardianType: GuardianType.EOA,
                  identifier: ('0x' + '11'.repeat(32)) as Hex,
                };
              }
              return {
                guardianType: GuardianType.Passkey,
                identifier: ('0x' + '22'.repeat(32)) as Hex,
              };
            default:
              throw new Error(`Unexpected function call: ${functionName}`);
          }
        },
      );

      const client = new RecoveryClient({
        publicClient,
        recoveryManagerAddress: RM_ADDRESS,
      });

      const policy = await client.getPolicy();
      expect(policy.wallet).toBe(WALLET_ADDRESS);
      expect(policy.threshold).toBe(2n);
      expect(policy.challengePeriod).toBe(86400n);
      expect(policy.guardians).toEqual([
        {
          guardianType: GuardianType.EOA,
          identifier: ('0x' + '11'.repeat(32)) as Hex,
        },
        {
          guardianType: GuardianType.Passkey,
          identifier: ('0x' + '22'.repeat(32)) as Hex,
        },
      ]);
    });
  });

  describe('submitProof', () => {
    it('should forward to recovery manager', async () => {
      const publicClient = createMockPublicClient();
      const walletClient = createMockWalletClient();

      const client = new RecoveryClient({
        publicClient,
        walletClient,
        recoveryManagerAddress: RM_ADDRESS,
      });

      const proof = {
        guardianIdentifier: ('0x' + '11'.repeat(32)) as Hex,
        guardianType: GuardianType.EOA,
        proof: '0xdeadbeef' as Hex,
      };

      const txHash = await client.submitProof({
        guardianIndex: 1n,
        proof,
      });

      expect(txHash).toBe('0xtxhash');
    });
  });

  describe('executeRecovery', () => {
    it('should forward to recovery manager', async () => {
      const publicClient = createMockPublicClient();
      const walletClient = createMockWalletClient();

      const client = new RecoveryClient({
        publicClient,
        walletClient,
        recoveryManagerAddress: RM_ADDRESS,
      });

      const txHash = await client.executeRecovery();
      expect(txHash).toBe('0xtxhash');
    });
  });

  describe('cancelRecovery', () => {
    it('should forward to recovery manager', async () => {
      const publicClient = createMockPublicClient();
      const walletClient = createMockWalletClient();

      const client = new RecoveryClient({
        publicClient,
        walletClient,
        recoveryManagerAddress: RM_ADDRESS,
      });

      const txHash = await client.cancelRecovery();
      expect(txHash).toBe('0xtxhash');
    });
  });

  describe('clearExpiredRecovery', () => {
    it('should forward to recovery manager', async () => {
      const publicClient = createMockPublicClient();
      const walletClient = createMockWalletClient();

      const client = new RecoveryClient({
        publicClient,
        walletClient,
        recoveryManagerAddress: RM_ADDRESS,
      });

      const txHash = await client.clearExpiredRecovery();
      expect(txHash).toBe('0xtxhash');
    });
  });

  describe('isReadyToExecute', () => {
    it('should return false when recovery not active', async () => {
      const publicClient = createMockPublicClient();
      // isRecoveryActive returns false
      (publicClient.readContract as any)
        .mockResolvedValueOnce(false) // isRecoveryActive
        .mockResolvedValueOnce([
          // getSession
          ('0x' + '00'.repeat(32)) as Hex,
          '0x0000000000000000000000000000000000000000' as Address,
          0n,
          0n,
          0n,
        ])
        .mockResolvedValueOnce(2n) // threshold
        .mockResolvedValueOnce(86400n); // challengePeriod

      const client = new RecoveryClient({
        publicClient,
        recoveryManagerAddress: RM_ADDRESS,
      });

      const ready = await client.isReadyToExecute();
      expect(ready).toBe(false);
    });

    it('should return true when threshold met, challenge elapsed, and deadline valid', async () => {
      const publicClient = createMockPublicClient();
      const now = BigInt(Math.floor(Date.now() / 1000));

      (publicClient.readContract as any)
        .mockResolvedValueOnce(true) // isRecoveryActive
        .mockResolvedValueOnce([
          ('0x' + 'aa'.repeat(32)) as Hex,
          '0x2222222222222222222222222222222222222222' as Address,
          now + 3600n, // deadline
          now - 1000n, // thresholdMetAt
          2n, // approvalCount
        ])
        .mockResolvedValueOnce(2n) // threshold
        .mockResolvedValueOnce(600n); // challengePeriod

      const client = new RecoveryClient({
        publicClient,
        recoveryManagerAddress: RM_ADDRESS,
      });

      const ready = await client.isReadyToExecute();
      expect(ready).toBe(true);
    });
  });

  describe('deployRecoveryManager', () => {
    it('should throw when factory not configured', async () => {
      const client = new RecoveryClient({
        publicClient: createMockPublicClient(),
        walletClient: createMockWalletClient(),
      });

      await expect(
        client.deployRecoveryManager({
          wallet: WALLET_ADDRESS,
          threshold: 1n,
          challengePeriod: 86400n,
          guardians: [],
        }),
      ).rejects.toThrow('Factory address not configured');
    });

    it('should throw when walletClient not provided', async () => {
      const client = new RecoveryClient({
        publicClient: createMockPublicClient(),
        factoryAddress: FACTORY_ADDRESS,
      });

      await expect(
        client.deployRecoveryManager({
          wallet: WALLET_ADDRESS,
          threshold: 1n,
          challengePeriod: 86400n,
          guardians: [],
        }),
      ).rejects.toThrow('WalletClient required');
    });

    it('should deploy and set recovery manager on success', async () => {
      const publicClient = createMockPublicClient();
      const walletClient = createMockWalletClient();
      (publicClient.readContract as any).mockResolvedValue(RM_ADDRESS);

      const client = new RecoveryClient({
        publicClient,
        walletClient,
        factoryAddress: FACTORY_ADDRESS,
      });

      const deployedAddress = await client.deployRecoveryManager({
        wallet: WALLET_ADDRESS,
        threshold: 1n,
        challengePeriod: 86400n,
        guardians: [],
      });

      expect(deployedAddress).toBe(RM_ADDRESS);
      expect(publicClient.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: '0xtxhash' });

      // If setRecoveryManager worked, this call should no longer throw for missing RM
      (publicClient.readContract as any).mockResolvedValueOnce(true);
      await expect(client.isRecoveryActive()).resolves.toBe(true);
    });

    it('should throw when factory returns zero address', async () => {
      const publicClient = createMockPublicClient();
      const walletClient = createMockWalletClient();
      (publicClient.readContract as any).mockResolvedValue(ZERO_ADDRESS);

      const client = new RecoveryClient({
        publicClient,
        walletClient,
        factoryAddress: FACTORY_ADDRESS,
      });

      await expect(
        client.deployRecoveryManager({
          wallet: WALLET_ADDRESS,
          threshold: 1n,
          challengePeriod: 86400n,
          guardians: [],
        }),
      ).rejects.toThrow('Factory returned zero RecoveryManager address');
    });
  });
});
