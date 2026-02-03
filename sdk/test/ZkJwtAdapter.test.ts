import { describe, it, expect, vi, beforeAll } from 'vitest';
import { ZkJwtAdapter, computeZkJwtIdentifier } from '../src/auth/adapters/ZkJwtAdapter';
import { initBarretenberg } from '../src/auth/utils/zkjwt/poseidon';
import type { RecoveryIntent } from '../src/types';

// Mock the circuit proof generation (actual proving is too slow for unit tests)
vi.mock('../src/auth/utils/zkjwt/circuit', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    generateZkJwtProof: vi.fn().mockResolvedValue({
      rawProof: new Uint8Array(64).fill(0xab),
      publicInputs: ['0x1234'],
    }),
  };
});

// Mock Google JWKS fetch
vi.mock('../src/auth/utils/zkjwt/google-jwks', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    fetchGoogleJwk: vi.fn().mockResolvedValue({
      kty: 'RSA',
      n: 'sXchDaQebHnPiGvhGPEUBL98SXRq6V6D_eD0B7BDCj2B0C4N0I-Z3GFne-56VoITfXRhGn6b1IqA0SICffRmC0f3T6UdSfIab38G0VQzJ_hIV_zKPwfGs7MWXB2xJ2g-aIAP2GOP0_CLhBE0xPWMB0lHHbyOD0bPOnfOCvSdHmLYGxbMOB0GSMV0oeP2RBNheFNbJE0S3GWmJBL2JtVfC79eMVIaUt18n5pOGJCqXRTOY-OiqQZmiFb1oO-GP8kcaHYJaRBmeF43KS7bmk9eFqBaE1EHOsQPhsRBMBEasLyQJJfJmo5ALFiNTgWAFCesVj8D80lQ-5mVkiTb0q9w',
      e: 'AQAB',
      kid: 'test-kid',
    }),
  };
});

const TEST_EMAIL = 'test@example.com';
const TEST_SALT = 12345n;

// Create a minimal valid JWT for testing (self-signed, won't verify but is parseable)
function createTestJwt(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-kid' })).toString(
    'base64url',
  );
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      email: TEST_EMAIL,
      email_verified: true,
      sub: '12345',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString('base64url');
  // Fake signature (256 bytes for RSA-2048)
  const signature = Buffer.from(new Uint8Array(256).fill(0x42)).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

const testIntent: RecoveryIntent = {
  wallet: '0x1111111111111111111111111111111111111111',
  newOwner: '0x2222222222222222222222222222222222222222',
  nonce: 0n,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 86400),
  chainId: 1n,
  recoveryManager: '0x3333333333333333333333333333333333333333',
};

describe('ZkJwtAdapter', () => {
  beforeAll(async () => {
    await initBarretenberg();
  });

  describe('computeZkJwtIdentifier', () => {
    it('should return a bytes32 hex commitment', async () => {
      const identifier = await computeZkJwtIdentifier(TEST_EMAIL, TEST_SALT);
      expect(identifier).toMatch(/^0x[a-f0-9]{64}$/);
    });

    it('should be consistent', async () => {
      const id1 = await computeZkJwtIdentifier(TEST_EMAIL, TEST_SALT);
      const id2 = await computeZkJwtIdentifier(TEST_EMAIL, TEST_SALT);
      expect(id1).toBe(id2);
    });

    it('should differ for different emails', async () => {
      const id1 = await computeZkJwtIdentifier('alice@example.com', TEST_SALT);
      const id2 = await computeZkJwtIdentifier('bob@example.com', TEST_SALT);
      expect(id1).not.toBe(id2);
    });

    it('should differ for different salts', async () => {
      const id1 = await computeZkJwtIdentifier(TEST_EMAIL, 1n);
      const id2 = await computeZkJwtIdentifier(TEST_EMAIL, 2n);
      expect(id1).not.toBe(id2);
    });
  });

  describe('computeIdentifier', () => {
    it('should return Poseidon2 commitment for known email/salt', () => {
      const jwt = createTestJwt();
      const adapter = new ZkJwtAdapter({ jwt, salt: TEST_SALT });
      const identifier = adapter.computeIdentifier({ email: TEST_EMAIL, salt: TEST_SALT });
      expect(identifier).toMatch(/^0x[a-f0-9]{64}$/);
    });
  });

  describe('guardianType', () => {
    it('should return 2 for ZkJWT', () => {
      const jwt = createTestJwt();
      const adapter = new ZkJwtAdapter({ jwt, salt: TEST_SALT });
      expect(adapter.guardianType).toBe(2);
    });
  });

  describe('generateProof', () => {
    it('should generate proof with mocked circuit', async () => {
      const jwt = createTestJwt();
      const adapter = new ZkJwtAdapter({ jwt, salt: TEST_SALT });
      const guardianIdentifier = adapter.computeIdentifier({
        email: TEST_EMAIL,
        salt: TEST_SALT,
      });

      const result = await adapter.generateProof(testIntent, guardianIdentifier);

      expect(result.success).toBe(true);
      expect(result.proof).toBeDefined();
      expect(result.proof!.guardianType).toBe(2);
      expect(result.proof!.guardianIdentifier).toBe(guardianIdentifier);
      // The proof should be ABI-encoded bytes
      expect(result.proof!.proof).toMatch(/^0x/);
    });

    it('should fail with mismatched guardian identifier', async () => {
      const jwt = createTestJwt();
      const adapter = new ZkJwtAdapter({ jwt, salt: TEST_SALT });

      const wrongIdentifier =
        '0x0000000000000000000000000000000000000000000000000000000000000001' as const;
      const result = await adapter.generateProof(testIntent, wrongIdentifier);

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not match');
    });
  });
});
