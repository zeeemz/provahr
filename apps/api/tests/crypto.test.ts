import { describe, it, expect, afterEach } from 'vitest';
import { encryptSecret, decryptSecret } from '../src/lib/crypto';
import { AppError } from '../src/lib/http';

// tests/setup.ts does not set SECRETS_KEY, so crypto falls back to the env
// default — record whatever is present so each test can rotate freely.
const originalKey = process.env.SECRETS_KEY;

afterEach(() => {
  if (originalKey === undefined) {
    delete process.env.SECRETS_KEY;
  } else {
    process.env.SECRETS_KEY = originalKey;
  }
});

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a secret', () => {
    const payload = encryptSecret('sk-live-abc123-XYZ');
    expect(decryptSecret(payload)).toBe('sk-live-abc123-XYZ');
  });

  it('round-trips the empty string and unicode', () => {
    expect(decryptSecret(encryptSecret(''))).toBe('');
    expect(decryptSecret(encryptSecret('pässwörd→🔑'))).toBe('pässwörd→🔑');
  });

  it('uses a fresh IV per call — identical plaintexts encrypt differently', () => {
    const a = encryptSecret('same-secret');
    const b = encryptSecret('same-secret');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same-secret');
    expect(decryptSecret(b)).toBe('same-secret');
  });

  it('leaks no substring of the plaintext in the payload', () => {
    const secret = 'sk-very-secret-key-123456';
    const payload = encryptSecret(secret);
    expect(payload).not.toContain(secret);
    expect(payload).not.toContain('very-secret');
    // Sanity: the payload really is the v1 envelope with 3 segments.
    expect(payload.startsWith('v1.')).toBe(true);
    expect(payload.slice(3).split('.')).toHaveLength(3);
  });
});

describe('decryptSecret rejects tampering', () => {
  const payload = encryptSecret('sk-live-tamper-check');

  /** Corrupts one segment deterministically: decode, flip the first byte,
   *  re-encode. (Editing the final base64url char can be a decode NO-OP —
   *  up to ~25% for 16-byte segments — which made this suite flaky; see
   *  QA wave-2 finding F1.) */
  function tamper(segment: 0 | 1 | 2): string {
    const parts = payload.slice(3).split('.');
    const buf = Buffer.from(parts[segment]!, 'base64url');
    buf[0] ^= 0xff;
    parts[segment] = buf.toString('base64url');
    return 'v1.' + parts.join('.');
  }

  it('throws CRYPTO_ERROR when the IV is tampered', () => {
    expect(() => decryptSecret(tamper(0))).toThrowError(AppError);
    expect(() => decryptSecret(tamper(0))).toThrowError(/decryption failed/i);
  });

  it('throws CRYPTO_ERROR when the auth tag is tampered', () => {
    expect(() => decryptSecret(tamper(1))).toThrowError(AppError);
  });

  it('throws CRYPTO_ERROR when the ciphertext is tampered', () => {
    expect(() => decryptSecret(tamper(2))).toThrowError(AppError);
  });

  it('rejects payloads without the v1 prefix', () => {
    expect(() => decryptSecret(payload.slice(3))).toThrowError(AppError);
  });

  it('rejects payloads with the wrong segment count', () => {
    expect(() => decryptSecret('v1.only-one-segment')).toThrowError(AppError);
    expect(() => decryptSecret('v1.a.b.c.d')).toThrowError(AppError);
    expect(() => decryptSecret('v1..')).toThrowError(AppError);
  });
});

describe('SECRETS_KEY rotation', () => {
  it('invalidates payloads encrypted under the old key', () => {
    const oldPayload = encryptSecret('sk-rotate-me');
    process.env.SECRETS_KEY = 'rotated-unit-test-key-32-chars-long!';
    expect(() => decryptSecret(oldPayload)).toThrowError(AppError);
    // And the new key round-trips its own payloads.
    const newPayload = encryptSecret('sk-new-key-era');
    expect(decryptSecret(newPayload)).toBe('sk-new-key-era');
  });
});
