import { describe, it, expect, beforeAll } from 'vitest';
import {
  packEmailToFields,
  computeCommitment,
  computeEmailHash,
  initBarretenberg,
  frToHex,
  frToBigInt,
  PACKED_EMAIL_FIELDS,
  BYTES_PER_FIELD,
} from '../src/auth/utils/zkjwt/poseidon';
import {
  splitBigIntToLimbs,
  computeRedcParams,
  extractModulusFromJwk,
  generateRsaKeyPair,
} from '../src/auth/utils/zkjwt/rsa';
import { extractJwtInputs } from '../src/auth/utils/zkjwt/jwt';
import { decodeJwtHeader, decodeJwtPayload } from '../src/auth/utils/zkjwt/google-jwks';
import type { BarretenbergSync } from '@aztec/bb.js';

let bb: BarretenbergSync;

beforeAll(async () => {
  bb = await initBarretenberg();
});

describe('packEmailToFields', () => {
  it('should pack a short email into 5 fields', () => {
    const fields = packEmailToFields('a@b.com');
    expect(fields).toHaveLength(PACKED_EMAIL_FIELDS);
    // First field should be non-zero (contains the email bytes)
    expect(fields[0]).toBeGreaterThan(0n);
  });

  it('should return zeros for empty remaining fields', () => {
    const fields = packEmailToFields('a@b.com');
    // "a@b.com" is 7 bytes, fits in first field (31 bytes), rest should be 0
    expect(fields[1]).toBe(0n);
    expect(fields[2]).toBe(0n);
    expect(fields[3]).toBe(0n);
    expect(fields[4]).toBe(0n);
  });

  it('should produce different fields for different emails', () => {
    const fields1 = packEmailToFields('alice@example.com');
    const fields2 = packEmailToFields('bob@example.com');
    expect(fields1[0]).not.toBe(fields2[0]);
  });

  it('should handle max-length emails', () => {
    // Max is 5 * 31 = 155 bytes
    const longEmail = 'a'.repeat(100) + '@' + 'b'.repeat(49) + '.com';
    const fields = packEmailToFields(longEmail);
    expect(fields).toHaveLength(5);
  });
});

describe('computeCommitment', () => {
  it('should return a non-zero commitment', () => {
    const commitment = computeCommitment(bb, 'test@example.com', 12345n);
    const hex = frToHex(commitment);
    expect(hex).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('should be consistent', () => {
    const c1 = frToHex(computeCommitment(bb, 'test@example.com', 12345n));
    const c2 = frToHex(computeCommitment(bb, 'test@example.com', 12345n));
    expect(c1).toBe(c2);
  });

  it('should differ for different emails', () => {
    const c1 = frToHex(computeCommitment(bb, 'alice@example.com', 12345n));
    const c2 = frToHex(computeCommitment(bb, 'bob@example.com', 12345n));
    expect(c1).not.toBe(c2);
  });

  it('should differ for different salts', () => {
    const c1 = frToHex(computeCommitment(bb, 'test@example.com', 1n));
    const c2 = frToHex(computeCommitment(bb, 'test@example.com', 2n));
    expect(c1).not.toBe(c2);
  });
});

describe('computeEmailHash', () => {
  it('should return a non-zero hash', () => {
    const hash = computeEmailHash(bb, 'test@example.com');
    expect(frToBigInt(hash)).not.toBe(0n);
  });
});

describe('frToHex / frToBigInt', () => {
  it('should roundtrip through hex', () => {
    const commitment = computeCommitment(bb, 'test@example.com', 42n);
    const hex = frToHex(commitment);
    const bigInt = frToBigInt(commitment);
    expect(BigInt(hex)).toBe(bigInt);
  });
});

describe('splitBigIntToLimbs', () => {
  it('should split into 18 limbs by default', () => {
    const limbs = splitBigIntToLimbs(2n ** 2048n - 1n);
    expect(limbs).toHaveLength(18);
  });

  it('should roundtrip correctly', () => {
    const original = 2n ** 200n + 123456789n;
    const limbs = splitBigIntToLimbs(original);
    // Reconstruct
    let reconstructed = 0n;
    for (let i = 0; i < limbs.length; i++) {
      reconstructed += limbs[i] << (BigInt(i) * 120n);
    }
    expect(reconstructed).toBe(original);
  });

  it('should handle zero', () => {
    const limbs = splitBigIntToLimbs(0n);
    expect(limbs).toHaveLength(18);
    expect(limbs.every((l) => l === 0n)).toBe(true);
  });

  it('should handle custom chunk size', () => {
    const limbs = splitBigIntToLimbs(0xFFFFn, 8, 4);
    expect(limbs).toHaveLength(4);
    expect(limbs[0]).toBe(0xFFn);
    expect(limbs[1]).toBe(0xFFn);
    expect(limbs[2]).toBe(0n);
    expect(limbs[3]).toBe(0n);
  });
});

describe('computeRedcParams', () => {
  it('should compute non-zero REDC param', () => {
    const modulus = 2n ** 2047n + 1n;
    const redc = computeRedcParams(modulus);
    expect(redc).toBeGreaterThan(0n);
  });
});

describe('extractModulusFromJwk', () => {
  it('should extract modulus from generated key pair', () => {
    const keyPair = generateRsaKeyPair();
    const modulus = extractModulusFromJwk(keyPair.publicKeyJwk);
    expect(modulus).toBeGreaterThan(0n);
    // RSA-2048 modulus should be 2048 bits
    expect(modulus.toString(2).length).toBeLessThanOrEqual(2048);
    expect(modulus.toString(2).length).toBeGreaterThan(2040);
  });

  it('should throw on missing modulus', () => {
    expect(() => extractModulusFromJwk({ kty: 'RSA' })).toThrow('does not contain modulus');
  });
});

describe('decodeJwtHeader / decodeJwtPayload', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'key1' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ email: 'test@example.com', sub: '123' }),
  ).toString('base64url');
  const signature = Buffer.from('fake-signature').toString('base64url');
  const jwt = `${header}.${payload}.${signature}`;

  it('should decode JWT header', () => {
    const decoded = decodeJwtHeader(jwt);
    expect(decoded.alg).toBe('RS256');
    expect(decoded.kid).toBe('key1');
  });

  it('should decode JWT payload', () => {
    const decoded = decodeJwtPayload(jwt);
    expect(decoded.email).toBe('test@example.com');
    expect(decoded.sub).toBe('123');
  });

  it('should throw on invalid JWT format', () => {
    expect(() => decodeJwtHeader('not.a.valid.jwt.with.extra.parts')).toThrow();
    expect(() => decodeJwtHeader('no-dots')).toThrow();
  });
});

describe('extractJwtInputs', () => {
  it('should extract inputs from a self-signed JWT', () => {
    const keyPair = generateRsaKeyPair();

    // Create a minimal JWT manually (without jsonwebtoken lib)
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString(
      'base64url',
    );
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'test',
        email: 'test@example.com',
        sub: '123',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');
    // Create a fake but correctly-sized signature (256 bytes for RSA-2048)
    const signature = Buffer.from(new Uint8Array(256).fill(1)).toString('base64url');
    const jwt = `${header}.${payload}.${signature}`;

    const inputs = extractJwtInputs(jwt, keyPair.publicKeyJwk);

    expect(inputs.data).toHaveLength(900);
    expect(inputs.dataLength).toBeGreaterThan(0);
    expect(inputs.dataLength).toBeLessThanOrEqual(900);
    expect(inputs.base64DecodeOffset).toBe(header.length + 1);
    expect(inputs.signatureLimbs).toHaveLength(18);
    expect(inputs.pubkeyModulusLimbs).toHaveLength(18);
    expect(inputs.redcParamsLimbs).toHaveLength(18);
  });

  it('should throw if data exceeds max length', () => {
    const keyPair = generateRsaKeyPair();
    const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
    const longPayload = Buffer.from('x'.repeat(1000)).toString('base64url');
    const signature = Buffer.from(new Uint8Array(256)).toString('base64url');
    const jwt = `${header}.${longPayload}.${signature}`;

    // Use a small maxDataLength to trigger the error
    expect(() => extractJwtInputs(jwt, keyPair.publicKeyJwk, 100)).toThrow('exceeds maxDataLength');
  });
});
