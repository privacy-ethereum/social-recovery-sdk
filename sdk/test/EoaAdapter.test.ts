import { describe, it, expect } from 'vitest';
import {
  createWalletClient,
  http,
  pad,
  decodeAbiParameters,
  recoverTypedDataAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { EoaAdapter } from '../src/auth/adapters/EoaAdapter';
import { EIP712_DOMAIN, RECOVERY_INTENT_TYPES } from '../src/constants';
import type { RecoveryIntent } from '../src/types';

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function makeTestWalletClient() {
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);
  return createWalletClient({
    account,
    chain: mainnet,
    transport: http(),
  });
}

const testIntent: RecoveryIntent = {
  wallet: '0x1111111111111111111111111111111111111111',
  newOwner: '0x2222222222222222222222222222222222222222',
  nonce: 0n,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 86400),
  chainId: 1n,
  recoveryManager: '0x3333333333333333333333333333333333333333',
};

describe('EoaAdapter', () => {
  describe('computeIdentifier', () => {
    it('should return padded address as bytes32', () => {
      const walletClient = makeTestWalletClient();
      const adapter = new EoaAdapter({ walletClient });
      const address = walletClient.account.address;

      const identifier = adapter.computeIdentifier(address);

      // Should be 66 chars (0x + 64 hex digits)
      expect(identifier).toMatch(/^0x[a-fA-F0-9]{64}$/);
      // Should end with the address (without 0x prefix)
      expect(identifier.toLowerCase()).toContain(address.slice(2).toLowerCase());
      // Should be left-padded with zeros
      expect(identifier.startsWith('0x000000000000000000000000')).toBe(true);
    });

    it('should produce consistent identifiers', () => {
      const walletClient = makeTestWalletClient();
      const adapter = new EoaAdapter({ walletClient });
      const address = walletClient.account.address;

      const id1 = adapter.computeIdentifier(address);
      const id2 = adapter.computeIdentifier(address);
      expect(id1).toBe(id2);
    });

    it('should produce different identifiers for different addresses', () => {
      const walletClient = makeTestWalletClient();
      const adapter = new EoaAdapter({ walletClient });

      const id1 = adapter.computeIdentifier('0x1111111111111111111111111111111111111111');
      const id2 = adapter.computeIdentifier('0x2222222222222222222222222222222222222222');
      expect(id1).not.toBe(id2);
    });
  });

  describe('guardianType', () => {
    it('should return 0 for EOA', () => {
      const walletClient = makeTestWalletClient();
      const adapter = new EoaAdapter({ walletClient });
      expect(adapter.guardianType).toBe(0);
    });
  });

  describe('generateProof', () => {
    it('should sign EIP-712 typed data and return valid proof', async () => {
      const walletClient = makeTestWalletClient();
      const adapter = new EoaAdapter({ walletClient });

      const guardianIdentifier = adapter.computeIdentifier(walletClient.account.address);
      const result = await adapter.generateProof(testIntent, guardianIdentifier);

      expect(result.success).toBe(true);
      expect(result.proof).toBeDefined();
      expect(result.proof!.guardianType).toBe(0);
      expect(result.proof!.guardianIdentifier).toBe(guardianIdentifier);

      // Decode the ABI-encoded proof
      const [v, r, s] = decodeAbiParameters(
        [{ type: 'uint8' }, { type: 'bytes32' }, { type: 'bytes32' }],
        result.proof!.proof,
      );

      expect(v).toBeGreaterThanOrEqual(27);
      expect(v).toBeLessThanOrEqual(28);
      expect(r).toMatch(/^0x[a-f0-9]{64}$/);
      expect(s).toMatch(/^0x[a-f0-9]{64}$/);
    });

    it('should produce recoverable signature', async () => {
      const walletClient = makeTestWalletClient();
      const adapter = new EoaAdapter({ walletClient });

      const guardianIdentifier = adapter.computeIdentifier(walletClient.account.address);
      const result = await adapter.generateProof(testIntent, guardianIdentifier);

      expect(result.success).toBe(true);

      // Decode the proof
      const [v, r, s] = decodeAbiParameters(
        [{ type: 'uint8' }, { type: 'bytes32' }, { type: 'bytes32' }],
        result.proof!.proof,
      );

      // Recover the signer from the typed data signature
      const recoveredAddress = await recoverTypedDataAddress({
        domain: {
          name: EIP712_DOMAIN.name,
          version: EIP712_DOMAIN.version,
          chainId: testIntent.chainId,
          verifyingContract: testIntent.recoveryManager,
        },
        types: RECOVERY_INTENT_TYPES,
        primaryType: 'RecoveryIntent',
        message: {
          wallet: testIntent.wallet,
          newOwner: testIntent.newOwner,
          nonce: testIntent.nonce,
          deadline: testIntent.deadline,
          chainId: testIntent.chainId,
          recoveryManager: testIntent.recoveryManager,
        },
        signature: {
          v: BigInt(v),
          r,
          s,
        },
      });

      expect(recoveredAddress.toLowerCase()).toBe(walletClient.account.address.toLowerCase());
    });

    it('should fail with mismatched guardian identifier', async () => {
      const walletClient = makeTestWalletClient();
      const adapter = new EoaAdapter({ walletClient });

      const wrongIdentifier =
        '0x0000000000000000000000000000000000000000000000000000000000000001' as const;
      const result = await adapter.generateProof(testIntent, wrongIdentifier);

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not match');
    });
  });
});
