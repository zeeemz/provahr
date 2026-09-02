import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { signToken } from '../src/lib/token';

// V2-3 multi-tenant auth (PLAN.md §12 D19, §12.1): the middleware's runtime
// mode resolution, multi-issuer OIDC verification, the super-admin local
// carve-out, the company local-token ban, the auth-config CRUD scoping and
// the mode cache — all against mocked prisma fixtures and an injected JWKS
// per issuer (the same jwksOverride seam tests/oidc.test.ts uses, applied at
// the getJwksCache boundary so requireAuth runs its REAL resolution path).

// ── JWKS injection: per-issuer overrides served by a mocked getJwksCache ────
// vi.hoisted: the vi.mock factory executes while modules load, before any
// test-body statements — the map must exist by then.
const jwksOverrides = vi.hoisted(() => new Map<string, unknown>());

vi.mock('../src/lib/oidc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/oidc')>();
  return {
    ...actual,
    // Fresh cache per lookup, pinned to the issuer's override — never any
    // network I/O. An unregistered issuer gets an empty key set (fails fast)
    // rather than a real discovery fetch.
    getJwksCache: (issuerUrl: string) =>
      new actual.JwksCache(issuerUrl, { jwksOverride: jwksOverrides.get(issuerUrl) ?? { keys: [] } }),
  };
});

vi.mock('../src/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    company: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    companyAuthConfig: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn(),
    },
    platformSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { prisma } from '../src/prisma';
import { createApp } from '../src/app';
import { env } from '../src/env';
import { resetAuthModeCacheForTests } from '../src/modules/platform/settings.service';

const app = createApp();

// ── Issuers, keys, fixtures ───────────────────────────────────────────────────

const companyA = { id: 'co-a', name: 'Acme' };
const companyB = { id: 'co-b', name: 'Globex' };
const issuerA = 'http://kc-a.test/realms/acme';
const issuerB = 'http://kc-b.test/realms/globex';
const audA = 'provahr-acme';
const audB = 'provahr-globex';
// The env platform default (OIDC_ISSUER_URL) — read from env so the fixture
// can never drift from what the middleware compares against.
const envIssuer = env.OIDC_ISSUER_URL;
const envAudience = env.OIDC_AUDIENCE;

let keys: Record<string, { privateKey: KeyObject; kid: string }>;
let companies: Array<{ id: string; name: string }>;
let authConfigs: Array<{ companyId: string; issuerUrl: string; audience: string; enabled: boolean; updatedAt: Date }>;
let usersById: Record<string, unknown>;
let settingsRow: { authMode: string } | null;

const superAdmin = {
  id: 'user-super-1',
  email: 'root@provahr.test',
  name: 'Sam Super',
  role: 'SUPER_ADMIN',
  companyId: null, // platform-level (D18)
  company: null,
};
const adminA = {
  id: 'user-admin-a',
  email: 'ada@acme.test',
  name: 'Ada Admin',
  role: 'ADMIN',
  companyId: 'co-a',
  company: { name: 'Acme' },
};
const adminB = {
  id: 'user-admin-b',
  email: 'ben@globex.test',
  name: 'Ben Admin',
  role: 'ADMIN',
  companyId: 'co-b',
  company: { name: 'Globex' },
};
const recruiterA = {
  id: 'user-rec-a',
  email: 'rae@acme.test',
  name: 'Rae Recruiter',
  role: 'RECRUITER',
  companyId: 'co-a',
  company: { name: 'Acme' },
};

function kidFor(issuer: string): string {
  return `kid-${issuer}`;
}

function signOidc(issuer: string, audience: string, extra: Record<string, unknown> = {}): string {
  const entry = keys[issuer]!;
  return jwt.sign(
    { sub: 'kc-sub-1', email: 'olive@example.test', name: 'Olive OIDC', realm_access: { roles: ['ADMIN'] }, ...extra },
    entry.privateKey,
    { algorithm: 'RS256', keyid: entry.kid, issuer, audience, expiresIn: '1h' },
  );
}

beforeAll(() => {
  for (const issuer of [issuerA, issuerB, envIssuer]) {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const kid = kidFor(issuer);
    const jwk = pair.publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
    jwk.kid = kid;
    jwksOverrides.set(issuer, { keys: [jwk] });
    keys ??= {};
    keys[issuer] = { privateKey: pair.privateKey, kid };
  }

  // Fixture-driven implementations: tests mutate the `companies` /
  // `authConfigs` / `usersById` / `settingsRow` variables (reset in
  // beforeEach) and the queries below observe them.
  vi.mocked(prisma.user.findUnique).mockImplementation(
    (async (args: { where: { id: string } }) => usersById[args.where.id] ?? null) as never,
  );
  vi.mocked(prisma.user.upsert).mockImplementation(
    (async (args: {
      create: { email: string; name: string; role: string; companyId: string | null };
    }) => {
      const { email, name, role, companyId } = args.create;
      const co = companies.find((c) => c.id === companyId);
      return { id: `user-prov-${email}`, email, name, role, companyId, company: co ? { name: co.name } : null };
    }) as never,
  );
  vi.mocked(prisma.company.findUnique).mockImplementation(
    (async (args: { where: { id: string } }) => companies.find((c) => c.id === args.where.id) ?? null) as never,
  );
  vi.mocked(prisma.company.findFirst).mockImplementation((async () => companies[0] ?? null) as never);
  vi.mocked(prisma.company.findMany).mockImplementation(
    (async () =>
      companies.map((c) => ({
        id: c.id,
        name: c.name,
        authConfig: authConfigs.find((cfg) => cfg.companyId === c.id) ?? null,
      }))) as never,
  );
  vi.mocked(prisma.companyAuthConfig.findFirst).mockImplementation(
    (async (args: {
      where: { issuerUrl?: string; enabled?: boolean; companyId?: string | { not: string } };
    }) =>
      authConfigs.find(
        (cfg) =>
          (args.where.issuerUrl === undefined || cfg.issuerUrl === args.where.issuerUrl) &&
          (args.where.enabled === undefined || cfg.enabled === args.where.enabled) &&
          (args.where.companyId === undefined ||
            (typeof args.where.companyId === 'string'
              ? cfg.companyId === args.where.companyId
              : cfg.companyId !== args.where.companyId.not)),
      ) ?? null) as never,
  );
  vi.mocked(prisma.companyAuthConfig.findUnique).mockImplementation(
    (async (args: { where: { companyId: string } }) =>
      authConfigs.find((cfg) => cfg.companyId === args.where.companyId) ?? null) as never,
  );
  vi.mocked(prisma.companyAuthConfig.count).mockImplementation(
    (async () => authConfigs.filter((cfg) => cfg.enabled).length) as never,
  );
  vi.mocked(prisma.companyAuthConfig.upsert).mockImplementation(
    (async (args: {
      where: { companyId: string };
      create: { issuerUrl: string; audience: string; enabled: boolean };
    }) => ({ ...args.create, companyId: args.where.companyId, updatedAt: new Date('2026-08-29T00:00:00Z') })) as never,
  );
  vi.mocked(prisma.platformSettings.findUnique).mockImplementation((async () => settingsRow) as never);
});

beforeEach(() => {
  vi.clearAllMocks();
  companies = [companyA, companyB];
  authConfigs = [];
  usersById = {};
  settingsRow = null;
  resetAuthModeCacheForTests();
});

function authAs(user: { id: string }): { Authorization: string } {
  return { Authorization: `Bearer ${signToken(user.id)}` };
}

function me(token: string) {
  return request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
}

// ── Multi-issuer OIDC verification (oidc mode) ────────────────────────────────

describe('requireAuth — multi-issuer resolution in oidc mode', () => {
  beforeEach(() => {
    settingsRow = { authMode: 'oidc' };
    authConfigs = [
      { companyId: 'co-a', issuerUrl: issuerA, audience: audA, enabled: true, updatedAt: new Date() },
      { companyId: 'co-b', issuerUrl: issuerB, audience: audB, enabled: true, updatedAt: new Date() },
    ];
  });

  it('verifies company A tokens against A’s config and provisions into company A', async () => {
    const res = await me(signOidc(issuerA, audA));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'olive@example.test', role: 'ADMIN', companyId: 'co-a', companyName: 'Acme' });
    expect(prisma.company.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'co-a' } }),
    );
  });

  it('verifies company B tokens against B’s config and provisions into company B', async () => {
    const res = await me(signOidc(issuerB, audB));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ companyId: 'co-b', companyName: 'Globex' });
  });

  it('rejects cross-issuer forgeries: iss names one realm, key belongs to another', async () => {
    // iss = B, signed by A's key: resolution picks B's config, verification fails.
    const cross = jwt.sign(
      { sub: 's', email: 'e@example.test', realm_access: { roles: ['ADMIN'] } },
      keys[issuerA]!.privateKey,
      { algorithm: 'RS256', keyid: kidFor(issuerB), issuer: issuerB, audience: audB, expiresIn: '1h' },
    );
    const res1 = await me(cross);
    expect(res1.status).toBe(401);
    expect(res1.body.error.code).toBe('UNAUTHENTICATED');

    // And the mirror image: iss = A, signed by B's key.
    const cross2 = jwt.sign(
      { sub: 's', email: 'e@example.test', realm_access: { roles: ['ADMIN'] } },
      keys[issuerB]!.privateKey,
      { algorithm: 'RS256', keyid: kidFor(issuerA), issuer: issuerA, audience: audA, expiresIn: '1h' },
    );
    const res2 = await me(cross2);
    expect(res2.status).toBe(401);
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it('rejects the wrong audience for the matched config', async () => {
    const res = await me(signOidc(issuerA, 'some-other-api'));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a token from an issuer nobody configures (unknown issuer → 401)', async () => {
    const orphanIssuer = 'http://kc-unknown.test/realms/nobody';
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = pair.publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
    jwk.kid = 'kid-orphan';
    jwksOverrides.set(orphanIssuer, { keys: [jwk] });
    const token = jwt.sign(
      { sub: 's', email: 'e@example.test', realm_access: { roles: ['ADMIN'] } },
      pair.privateKey,
      { algorithm: 'RS256', keyid: 'kid-orphan', issuer: orphanIssuer, audience: 'whatever', expiresIn: '1h' },
    );
    const res = await me(token);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Unknown token issuer');
    // The unverified iss was used ONLY for config selection — never a fetch:
    // no JWKS cache is even built for the orphan issuer.
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it('ignores a DISABLED config — its issuer is treated as unknown', async () => {
    authConfigs = [
      { companyId: 'co-a', issuerUrl: issuerA, audience: audA, enabled: false, updatedAt: new Date() },
    ];
    const res = await me(signOidc(issuerA, audA));
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Unknown token issuer');
  });

  it('falls back to the env platform default when no company config matches', async () => {
    const res = await me(signOidc(envIssuer, envAudience, { email: 'legacy@provahr.test' }));
    expect(res.status).toBe(200);
    // V2-1 platform-default behavior: first company wins for provisioning.
    expect(res.body.user).toMatchObject({ companyId: 'co-a' });
    expect(prisma.company.findFirst).toHaveBeenCalled();
  });

  it('rejects a verified-issuer token with no ProvaHR role (403)', async () => {
    const res = await me(signOidc(issuerA, audA, { realm_access: { roles: ['offline_access'] } }));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });
});

// ── The two oidc-mode carve-outs (D19 lockout safety) ─────────────────────────

describe('requireAuth — oidc mode local-token carve-outs', () => {
  beforeEach(() => {
    settingsRow = { authMode: 'oidc' };
  });

  it('SUPER_ADMIN still authenticates locally in oidc mode (lockout safety)', async () => {
    usersById['user-super-1'] = superAdmin;
    const res = await me(signToken('user-super-1'));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: 'SUPER_ADMIN', companyId: null });
    // Local pass — no OIDC resolution, no provisioning.
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it('company users cannot ride local tokens in oidc mode (403 SSO_MODE_ACTIVE)', async () => {
    usersById['user-admin-a'] = adminA;
    const res = await me(signToken('user-admin-a'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SSO_MODE_ACTIVE');
  });
});

// ── Local mode stays the default read ─────────────────────────────────────────

describe('requireAuth — local mode', () => {
  it('authenticates company users with local tokens when the row says local', async () => {
    settingsRow = { authMode: 'local' };
    usersById['user-admin-a'] = adminA;
    const res = await me(signToken('user-admin-a'));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: 'ADMIN', companyId: 'co-a' });
  });

  it('falls back to the env (local) mode when the settings read fails', async () => {
    // mockImplementationOnce (not mockImplementation): clearAllMocks in the
    // next beforeEach clears calls but KEEPS implementations — a sticky
    // throwing mock would poison every later test in this file.
    vi.mocked(prisma.platformSettings.findUnique).mockImplementationOnce((async () => {
      throw new Error('db down');
    }) as never);
    usersById['user-admin-a'] = adminA;
    const res = await me(signToken('user-admin-a'));
    expect(res.status).toBe(200);
  });
});

// ── Mode endpoint: { mode, perCompany } ────────────────────────────────────────

describe('GET /api/auth/mode', () => {
  it('reports perCompany=true when a company has an enabled config', async () => {
    settingsRow = { authMode: 'oidc' };
    authConfigs = [{ companyId: 'co-a', issuerUrl: issuerA, audience: audA, enabled: true, updatedAt: new Date() }];
    const res = await request(app).get('/api/auth/mode');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mode: 'oidc', perCompany: true });
  });

  it('reports perCompany=false with only disabled configs', async () => {
    authConfigs = [{ companyId: 'co-a', issuerUrl: issuerA, audience: audA, enabled: false, updatedAt: new Date() }];
    const res = await request(app).get('/api/auth/mode');
    expect(res.body).toEqual({ mode: 'local', perCompany: false });
  });

  it('fails open to perCompany=false when the count read throws', async () => {
    vi.mocked(prisma.companyAuthConfig.count).mockImplementationOnce((async () => {
      throw new Error('db down');
    }) as never);
    const res = await request(app).get('/api/auth/mode');
    expect(res.status).toBe(200);
    expect(res.body.perCompany).toBe(false);
  });
});

// ── Mode cache: 10s in-memory trust window ────────────────────────────────────

describe('auth mode cache (10s window)', () => {
  it('serves N requests with ONE settings read, then re-reads after a reset', async () => {
    settingsRow = { authMode: 'oidc' };
    const first = await request(app).get('/api/auth/mode');
    expect(first.body.mode).toBe('oidc');

    // Flip the row out-of-band: within the window the cached mode persists.
    settingsRow = { authMode: 'local' };
    for (let i = 0; i < 3; i += 1) {
      const res = await request(app).get('/api/auth/mode');
      expect(res.body.mode).toBe('oidc');
    }
    expect(prisma.platformSettings.findUnique).toHaveBeenCalledTimes(1);

    // After the cache drops (tests use the same seam a 10s expiry uses), the
    // new value is picked up — the portal PUT refreshes the cache itself.
    resetAuthModeCacheForTests();
    const after = await request(app).get('/api/auth/mode');
    expect(after.body.mode).toBe('local');
    expect(prisma.platformSettings.findUnique).toHaveBeenCalledTimes(2);
  });
});

// ── Company admin auth-config CRUD (scoping) ─────────────────────────────────

describe('admin auth-config routes', () => {
  beforeEach(() => {
    usersById['user-admin-a'] = adminA;
    usersById['user-admin-b'] = adminB;
    usersById['user-rec-a'] = recruiterA;
    usersById['user-super-1'] = superAdmin;
  });

  it('rejects GET /api/admin/auth-config without a token', async () => {
    const res = await request(app).get('/api/admin/auth-config');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects PUT /api/admin/auth-config without a token (and never upserts)', async () => {
    const res = await request(app).put('/api/admin/auth-config').send({ issuerUrl: issuerA, audience: audA, enabled: true });
    expect(res.status).toBe(401);
    expect(prisma.companyAuthConfig.upsert).not.toHaveBeenCalled();
  });

  it('rejects non-admin roles (RECRUITER → 403) and the platform SUPER_ADMIN (403)', async () => {
    const rec = await request(app).get('/api/admin/auth-config').set(authAs(recruiterA));
    expect(rec.status).toBe(403);
    const sup = await request(app).get('/api/admin/auth-config').set(authAs(superAdmin));
    expect(sup.status).toBe(403);
    expect(prisma.companyAuthConfig.findUnique).not.toHaveBeenCalled();
  });

  it('GET returns ONLY the caller’s company config — A sees Acme’s, B sees Globex’s', async () => {
    authConfigs = [
      { companyId: 'co-a', issuerUrl: issuerA, audience: audA, enabled: true, updatedAt: new Date('2026-08-01T00:00:00Z') },
      { companyId: 'co-b', issuerUrl: issuerB, audience: audB, enabled: false, updatedAt: new Date('2026-08-02T00:00:00Z') },
    ];

    const resA = await request(app).get('/api/admin/auth-config').set(authAs(adminA));
    expect(resA.status).toBe(200);
    expect(resA.body.authConfig).toMatchObject({ issuerUrl: issuerA, audience: audA, enabled: true });
    expect(prisma.companyAuthConfig.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'co-a' } }),
    );

    const resB = await request(app).get('/api/admin/auth-config').set(authAs(adminB));
    expect(resB.status).toBe(200);
    expect(resB.body.authConfig).toMatchObject({ issuerUrl: issuerB, enabled: false });
  });

  it('GET returns authConfig null when the company never saved one', async () => {
    const res = await request(app).get('/api/admin/auth-config').set(authAs(adminA));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authConfig: null });
  });

  it('PUT upserts scoped to the CALLER’s company, with the issuer slash-normalized', async () => {
    const res = await request(app)
      .put('/api/admin/auth-config')
      .set(authAs(adminA))
      .send({ issuerUrl: `${issuerA}/`, audience: ` ${audA} `, enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.authConfig).toMatchObject({ issuerUrl: issuerA, audience: audA, enabled: false });
    expect(prisma.companyAuthConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'co-a' },
        create: { companyId: 'co-a', issuerUrl: issuerA, audience: audA, enabled: false },
      }),
    );
  });

  it('PUT enabling an issuer another company already enables → 409 ISSUER_TAKEN', async () => {
    authConfigs = [
      { companyId: 'co-b', issuerUrl: issuerB, audience: audB, enabled: true, updatedAt: new Date() },
    ];
    const res = await request(app)
      .put('/api/admin/auth-config')
      .set(authAs(adminA))
      .send({ issuerUrl: issuerB, audience: audA, enabled: true });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ISSUER_TAKEN');
    expect(prisma.companyAuthConfig.upsert).not.toHaveBeenCalled();
  });

  it('PUT allows a DISABLED draft of an issuer another company enables', async () => {
    authConfigs = [
      { companyId: 'co-b', issuerUrl: issuerB, audience: audB, enabled: true, updatedAt: new Date() },
    ];
    const res = await request(app)
      .put('/api/admin/auth-config')
      .set(authAs(adminA))
      .send({ issuerUrl: issuerB, audience: audA, enabled: false });
    expect(res.status).toBe(200);
    expect(prisma.companyAuthConfig.upsert).toHaveBeenCalledTimes(1);
  });

  it('PUT rejects a malformed issuer URL (400 VALIDATION_ERROR)', async () => {
    const res = await request(app)
      .put('/api/admin/auth-config')
      .set(authAs(adminA))
      .send({ issuerUrl: 'not-a-url', audience: audA, enabled: false });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.companyAuthConfig.upsert).not.toHaveBeenCalled();
  });
});

// ── Platform console: the read-only all-companies list ────────────────────────

describe('GET /api/platform/auth-configs (super admin)', () => {
  beforeEach(() => {
    usersById['user-super-1'] = superAdmin;
    usersById['user-rec-a'] = recruiterA;
  });

  it('rejects a company token (403) — the list is platform-only', async () => {
    const res = await request(app).get('/api/platform/auth-configs').set(authAs(recruiterA));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(prisma.company.findMany).not.toHaveBeenCalled();
  });

  it('lists every company with its config and the issuer-shape hint', async () => {
    authConfigs = [
      { companyId: 'co-a', issuerUrl: issuerA, audience: audA, enabled: true, updatedAt: new Date('2026-08-01T00:00:00Z') },
    ];
    const res = await request(app).get('/api/platform/auth-configs').set(authAs(superAdmin));
    expect(res.status).toBe(200);
    expect(res.body.configs).toHaveLength(2);
    expect(res.body.configs[0]).toMatchObject({
      companyId: 'co-a',
      companyName: 'Acme',
      issuerShapeValid: true,
      authConfig: { issuerUrl: issuerA, audience: audA, enabled: true },
    });
    // An unconfigured company lists with authConfig null — distinguishable
    // from "configured but disabled".
    expect(res.body.configs[1]).toMatchObject({ companyId: 'co-b', authConfig: null, issuerShapeValid: false });
    // No user rows are ever part of this listing.
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('flags a non-http issuer shape as invalid (validity hint is shape-only)', async () => {
    authConfigs = [
      { companyId: 'co-a', issuerUrl: 'ftp://kc-a.test/realms/acme', audience: audA, enabled: true, updatedAt: new Date() },
    ];
    const res = await request(app).get('/api/platform/auth-configs').set(authAs(superAdmin));
    expect(res.status).toBe(200);
    expect(res.body.configs[0].issuerShapeValid).toBe(false);
  });
});
