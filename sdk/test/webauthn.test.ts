import { describe, it, expect } from 'vitest';
import {
  parseP256Signature,
  findClientDataIndex,
  challengeToBase64Url,
  base64UrlToBytes,
} from '../src/auth/utils/webauthn';

describe('webauthn utils', () => {
  describe('parseP256Signature', () => {
    it('should parse a valid DER-encoded signature', () => {
      // Example DER signature with r and s values
      // SEQUENCE { INTEGER r, INTEGER s }
      // 0x30 = SEQUENCE, 0x44 = length 68
      // 0x02 = INTEGER, 0x20 = length 32 for r
      // 0x02 = INTEGER, 0x20 = length 32 for s
      const rBytes = new Uint8Array(32).fill(0x11);
      const sBytes = new Uint8Array(32).fill(0x22);

      const derSignature = new Uint8Array([
        0x30,
        0x44, // SEQUENCE, length 68
        0x02,
        0x20, // INTEGER, length 32
        ...rBytes,
        0x02,
        0x20, // INTEGER, length 32
        ...sBytes,
      ]);

      const { r, s } = parseP256Signature(derSignature);

      // r should be 32 bytes of 0x11
      const expectedR = BigInt('0x' + '11'.repeat(32));
      // s should be 32 bytes of 0x22
      const expectedS = BigInt('0x' + '22'.repeat(32));

      expect(r).toBe(expectedR);
      expect(s).toBe(expectedS);
    });

    it('should handle signatures with leading zeros', () => {
      // When the high bit is set, a leading 0x00 is added to keep the number positive
      const rBytesWithLeadingZero = new Uint8Array([0x00, ...new Uint8Array(32).fill(0xff)]);
      const sBytes = new Uint8Array(32).fill(0x22);

      const derSignature = new Uint8Array([
        0x30,
        0x45, // SEQUENCE, length 69
        0x02,
        0x21, // INTEGER, length 33 (with leading zero)
        ...rBytesWithLeadingZero,
        0x02,
        0x20, // INTEGER, length 32
        ...sBytes,
      ]);

      const { r, s } = parseP256Signature(derSignature);

      // r should be 32 bytes of 0xff (leading zero stripped)
      const expectedR = BigInt('0x' + 'ff'.repeat(32));
      expect(r).toBe(expectedR);
    });

    it('should throw on invalid SEQUENCE tag', () => {
      const invalidSignature = new Uint8Array([0x31, 0x44, 0x02, 0x20]); // 0x31 instead of 0x30
      expect(() => parseP256Signature(invalidSignature)).toThrow('expected SEQUENCE');
    });

    it('should throw on invalid INTEGER tag for r', () => {
      const invalidSignature = new Uint8Array([0x30, 0x44, 0x03, 0x20]); // 0x03 instead of 0x02
      expect(() => parseP256Signature(invalidSignature)).toThrow('expected INTEGER for r');
    });
  });

  describe('findClientDataIndex', () => {
    const clientDataJSON = '{"type":"webauthn.get","challenge":"dGVzdC1jaGFsbGVuZ2U","origin":"https://example.com"}';

    it('should find the challenge index', () => {
      const index = findClientDataIndex(clientDataJSON, 'challenge');
      expect(clientDataJSON.substring(index, index + 11)).toBe('"challenge"');
    });

    it('should find the type index', () => {
      const index = findClientDataIndex(clientDataJSON, 'type');
      expect(clientDataJSON.substring(index, index + 6)).toBe('"type"');
    });

    it('should throw when key is not found', () => {
      expect(() => findClientDataIndex(clientDataJSON, 'notfound')).toThrow('not found');
    });

    it('should find the correct index for origin', () => {
      const index = findClientDataIndex(clientDataJSON, 'origin');
      expect(clientDataJSON.substring(index, index + 8)).toBe('"origin"');
    });
  });

  describe('challengeToBase64Url', () => {
    it('should convert hex to base64url', () => {
      // 0x00 -> AA (base64url)
      const result = challengeToBase64Url('0x00');
      expect(result).toBe('AA');
    });

    it('should not include padding', () => {
      const result = challengeToBase64Url('0x0000');
      expect(result).not.toContain('=');
    });

    it('should use base64url characters', () => {
      // Use bytes that would produce + and / in standard base64
      const result = challengeToBase64Url('0xfbef');
      expect(result).not.toContain('+');
      expect(result).not.toContain('/');
    });

    it('should handle 32-byte hash', () => {
      const hash = '0x' + 'ab'.repeat(32);
      const result = challengeToBase64Url(hash as `0x${string}`);
      // 32 bytes = 256 bits = 43-44 base64 characters (no padding)
      expect(result.length).toBeGreaterThanOrEqual(42);
      expect(result.length).toBeLessThanOrEqual(44);
    });
  });

  describe('base64UrlToBytes', () => {
    it('should decode base64url to bytes', () => {
      const base64url = 'AA'; // 0x00
      const bytes = base64UrlToBytes(base64url);
      expect(bytes).toEqual(new Uint8Array([0]));
    });

    it('should handle strings without padding', () => {
      const base64url = 'AAAA'; // 3 bytes of 0x00
      const bytes = base64UrlToBytes(base64url);
      expect(bytes).toEqual(new Uint8Array([0, 0, 0]));
    });

    it('should roundtrip with challengeToBase64Url', () => {
      const originalHex = '0x' + 'ab'.repeat(32);
      const base64url = challengeToBase64Url(originalHex as `0x${string}`);
      const bytes = base64UrlToBytes(base64url);

      // Convert bytes back to hex and compare
      const recoveredHex =
        '0x' +
        Array.from(bytes)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      expect(recoveredHex).toBe(originalHex);
    });
  });
});
