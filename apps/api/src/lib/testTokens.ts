import { createHash, randomBytes } from 'node:crypto';

// One-time candidate test-link tokens (PLAN.md §4 loop step 3, §8 TestSession).
//
// Shape contract: 32 random bytes, base64url-encoded WITHOUT padding →
// exactly 43 characters from [A-Za-z0-9_-]. The URL-safe alphabet means a
// token never needs percent-encoding when placed in a path segment
// (`/api/public/test/:token`).
//
// Security model (never-regress #3, docs/TESTING.md §6): the database stores
// ONLY the sha256 hex hash. The plain token leaves the system exactly once —
// in the 201 apply response that mints it. A second use of the link fails,
// and nothing here ever re-derives the token from the hash.

/** base64url of 32 bytes with padding stripped — always 43 chars. */
export const TEST_TOKEN_LENGTH = 43;

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Mints a fresh one-time test token. Returns the URL-safe plain token (hand
 * it to the candidate once, then drop it) plus its sha256 hex hash (the only
 * value that may be persisted).
 */
export function generateTestToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashTestToken(token) };
}

/** sha256 of a token as lowercase hex — the ONLY form stored in TestSession. */
export function hashTestToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Cheap pre-DB shape check: right length, base64url charset only. Rejects
 * garbage before a database lookup is spent on it. Callers must answer bad
 * shape and unknown-token identically (uniform 404) so the endpoint is not a
 * token-validity oracle.
 */
export function isTokenShapeValid(token: string): boolean {
  return token.length === TEST_TOKEN_LENGTH && BASE64URL_RE.test(token);
}
