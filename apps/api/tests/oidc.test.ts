import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { JwksCache, verifyOidcToken } from '../src/lib/oidc';
import { mapRoles, PROVAHR_ROLES } from '../src/lib/roles';

// All tests run against an injected JWKS — no network, no database.
const cfg = { issuerUrl: 'http://kc.test/realms/provahr', audience: 'provahr-api' };

let privateKey: KeyObject;
let jwksOverride: unknown;

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = pair.privateKey;
  const jwk = pair.publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  jwk.kid = 'test-kid';
  jwksOverride = { keys: [jwk] };
});

function freshCache(): JwksCache {
  return new JwksCache(cfg.issuerUrl, { jwksOverride });
}

function signToken(payload: object, options: jwt.SignOptions = {}): string {
  return jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    keyid: 'test-kid',
    issuer: cfg.issuerUrl,
    audience: cfg.audience,
    expiresIn: '1h',
    ...options,
  });
}

function basePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { sub: 'kc-user-1', email: 'alice@example.com', ...overrides };
}

function expectUnauthenticated(promise: Promise<unknown>) {
  return expect(promise).rejects.toMatchObject({
    statusCode: 401,
    code: 'UNAUTHENTICATED',
  });
}

describe('verifyOidcToken', () => {
  it('round-trips a valid token and extracts claims', async () => {
    const token = signToken(basePayload({ name: 'Alice Admin' }));
    const info = await verifyOidcToken(token, cfg, freshCache());
    expect(info).toEqual({
      sub: 'kc-user-1',
      email: 'alice@example.com',
      name: 'Alice Admin',
      roles: [],
    });
  });

  it('unions roles from realm_access and resource_access[audience], deduplicated', async () => {
    const token = signToken(
      basePayload({
        realm_access: { roles: ['ADMIN', 'default-roles-provahr'] },
        resource_access: { 'provahr-api': { roles: ['ADMIN', 'INTERVIEWER'] } },
      }),
    );
    const info = await verifyOidcToken(token, cfg, freshCache());
    expect(info.roles.sort()).toEqual(['ADMIN', 'INTERVIEWER', 'default-roles-provahr']);
  });

  it('falls back to preferred_username when name is absent', async () => {
    const token = signToken(basePayload({ preferred_username: 'alice.k' }));
    const info = await verifyOidcToken(token, cfg, freshCache());
    expect(info.name).toBe('alice.k');
  });

  it('falls back to email when name and preferred_username are absent', async () => {
    const info = await verifyOidcToken(signToken(basePayload()), cfg, freshCache());
    expect(info.name).toBe('alice@example.com');
  });

  it('rejects a token from the wrong issuer', async () => {
    const token = signToken(basePayload(), { issuer: 'http://evil.test/realms/other' });
    await expectUnauthenticated(verifyOidcToken(token, cfg, freshCache()));
  });

  it('rejects a token for the wrong audience', async () => {
    const token = signToken(basePayload(), { audience: 'some-other-api' });
    await expectUnauthenticated(verifyOidcToken(token, cfg, freshCache()));
  });

  it('rejects an expired token', async () => {
    const token = signToken(basePayload(), { expiresIn: '1ms' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expectUnauthenticated(verifyOidcToken(token, cfg, freshCache()));
  });

  it('rejects HS256 tokens at the algorithm check', async () => {
    // Signed with a shared secret; must never reach key lookup.
    const token = jwt.sign(basePayload(), 'attacker-knows-this-secret', {
      algorithm: 'HS256',
      keyid: 'test-kid',
      issuer: cfg.issuerUrl,
      audience: cfg.audience,
      expiresIn: '1h',
    });
    await expectUnauthenticated(verifyOidcToken(token, cfg, freshCache()));
  });

  it('rejects an unknown kid after one refresh (override only — no fetch)', async () => {
    const token = signToken(basePayload(), { keyid: 'rotated-away-kid' });
    await expect(verifyOidcToken(token, cfg, freshCache())).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHENTICATED',
      message: 'Unknown signing key',
    });
  });

  it('rejects a token without an email claim', async () => {
    const token = signToken({ sub: 'kc-user-1' });
    await expect(verifyOidcToken(token, cfg, freshCache())).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHENTICATED',
      message: 'Token missing email claim',
    });
  });

  it('rejects a token without a subject', async () => {
    const token = signToken({ email: 'alice@example.com' });
    await expectUnauthenticated(verifyOidcToken(token, cfg, freshCache()));
  });

  it('rejects garbage input', async () => {
    await expectUnauthenticated(verifyOidcToken('not-a-jwt', cfg, freshCache()));
    await expectUnauthenticated(verifyOidcToken('', cfg, freshCache()));
  });
});

describe('mapRoles', () => {
  it('prefers ADMIN over RECRUITER and INTERVIEWER', () => {
    expect(mapRoles(['RECRUITER', 'INTERVIEWER', 'ADMIN'])).toBe('ADMIN');
  });

  it('prefers RECRUITER over INTERVIEWER', () => {
    expect(mapRoles(['INTERVIEWER', 'RECRUITER'])).toBe('RECRUITER');
  });

  it('maps each single role', () => {
    for (const role of PROVAHR_ROLES) {
      expect(mapRoles([role])).toBe(role);
    }
  });

  it('returns null for no roles', () => {
    expect(mapRoles([])).toBeNull();
  });

  it('returns null for roles unrelated to ProvaHR', () => {
    expect(mapRoles(['offline_access', 'uma_authorization', 'default-roles-provahr'])).toBeNull();
  });

  it('tolerates duplicate and unrelated roles mixed in', () => {
    expect(mapRoles(['INTERVIEWER', 'INTERVIEWER', 'uma_protection'])).toBe('INTERVIEWER');
  });
});
