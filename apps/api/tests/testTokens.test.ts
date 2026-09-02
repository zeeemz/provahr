import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  generateTestToken,
  hashTestToken,
  isTokenShapeValid,
  TEST_TOKEN_LENGTH,
} from '../src/lib/testTokens';

// Pure token machinery for the one-time test links (PLAN.md §8 TestSession,
// never-regress #3): tokens are 32 random bytes, base64url, stored ONLY as
// sha256 hex. The hash must be recoverable from the token (round-trip), the
// token must never be recoverable from the hash (one-way), and shape checks
// must reject anything a candidate could not have received.

describe('generateTestToken', () => {
  it('round-trips: hashTestToken(token) === tokenHash', () => {
    for (let i = 0; i < 50; i++) {
      const { token, tokenHash } = generateTestToken();
      expect(hashTestToken(token)).toBe(tokenHash);
    }
  });

  it('matches an independent sha256 computation (node:crypto cross-check)', () => {
    const { token, tokenHash } = generateTestToken();
    const expected = createHash('sha256').update(token, 'utf8').digest('hex');
    expect(tokenHash).toBe(expected);
  });

  it('produces distinct tokens and distinct hashes on every call', () => {
    const tokens = new Set<string>();
    const hashes = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const { token, tokenHash } = generateTestToken();
      tokens.add(token);
      hashes.add(tokenHash);
    }
    expect(tokens.size).toBe(500);
    expect(hashes.size).toBe(500);
  });

  it('emits URL-safe tokens: 43 chars of base64url, no padding', () => {
    for (let i = 0; i < 50; i++) {
      const { token } = generateTestToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(token).not.toContain('=');
      expect(token.length).toBe(TEST_TOKEN_LENGTH);
      // URL-safety means the token survives unencoded in a path segment.
      expect(encodeURIComponent(token)).toBe(token);
    }
  });

  it('stores only a hex hash — the hash is not the token and not base64 of it', () => {
    const { token, tokenHash } = generateTestToken();
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toBe(token);
  });
});

describe('hashTestToken', () => {
  it('is deterministic for the same input', () => {
    expect(hashTestToken('fixed-input')).toBe(hashTestToken('fixed-input'));
  });

  it('differs across inputs', () => {
    expect(hashTestToken('token-one')).not.toBe(hashTestToken('token-two'));
  });
});

describe('isTokenShapeValid', () => {
  it('accepts freshly generated tokens', () => {
    for (let i = 0; i < 50; i++) {
      expect(isTokenShapeValid(generateTestToken().token)).toBe(true);
    }
  });

  it('rejects the empty string', () => {
    expect(isTokenShapeValid('')).toBe(false);
  });

  it('rejects garbage: wrong-charset characters anywhere', () => {
    const good = 'A'.repeat(TEST_TOKEN_LENGTH);
    for (const ch of [' ', '+', '/', '=', '!', '#', '?', '.']) {
      expect(isTokenShapeValid(`${good.slice(0, 20)}${ch}${good.slice(21)}`)).toBe(false);
    }
  });

  it('rejects unicode', () => {
    expect(isTokenShapeValid('ünïcödé-tökéñ-tökéñ-tökéñ-tökéñ-tökéñ-üñ')).toBe(false);
    expect(isTokenShapeValid('日本語のトークンです'.padEnd(TEST_TOKEN_LENGTH, 'あ'))).toBe(false);
  });

  it('rejects too-short and too-long base64url strings', () => {
    expect(isTokenShapeValid('A'.repeat(TEST_TOKEN_LENGTH - 1))).toBe(false);
    expect(isTokenShapeValid('A'.repeat(TEST_TOKEN_LENGTH + 1))).toBe(false);
    expect(isTokenShapeValid('A'.repeat(1))).toBe(false);
    expect(isTokenShapeValid('A'.repeat(200))).toBe(false);
  });
});
