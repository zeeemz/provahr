import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { signToken } from '../src/lib/token';

// Same seam as blueprint-routes.test.ts: no database is reachable in unit
// tests, but requireAuth (local mode) loads the user from the database — so
// the prisma module is mocked and the mocked user's ROLE is flipped between
// suites to prove the SUPER_ADMIN gate (D18). The company-creation happy
// path asserts the TRANSACTIONAL creates (company + first ADMIN) against the
// mocked transaction client. DB-backed branches (404s, slug collisions,
// cascade deletes) belong to CI's integration tier, like admin-routes.test.ts.
vi.mock('../src/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    company: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    platformSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../src/prisma';
import { resetAuthModeCacheForTests } from '../src/modules/platform/settings.service';
import { createApp } from '../src/app';

const app = createApp();
const token = signToken('user-plat-1');
const auth = { Authorization: `Bearer ${token}` };

// Same id, different role: the platform gate must hinge ONLY on the role.
const recruiterUser = {
  id: 'user-plat-1',
  email: 'rae@acme.test',
  name: 'Rae Recruiter',
  role: 'RECRUITER',
  companyId: 'company-1',
  company: { name: 'Acme' },
};
const superAdminUser = {
  id: 'user-plat-1',
  email: 'root@provahr.test',
  name: 'Sam Super',
  role: 'SUPER_ADMIN',
  companyId: null, // platform-level (D18): super admins own no company
  company: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('platform routes — auth gate (no token → 401)', () => {
  it('rejects GET /api/platform/companies', async () => {
    const res = await request(app).get('/api/platform/companies');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects POST /api/platform/companies', async () => {
    const res = await request(app).post('/api/platform/companies').send({ name: 'Acme' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects DELETE /api/platform/companies/:id', async () => {
    const res = await request(app).delete('/api/platform/companies/co-1');
    expect(res.status).toBe(401);
  });

  it('rejects PUT /api/platform/settings', async () => {
    const res = await request(app).put('/api/platform/settings').send({ authMode: 'oidc' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a garbage bearer token', async () => {
    const res = await request(app).get('/api/platform/companies').set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('platform routes — role gate (company token → 403)', () => {
  beforeEach(() => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(recruiterUser as never);
  });

  it('rejects GET /api/platform/companies for a RECRUITER', async () => {
    const res = await request(app).get('/api/platform/companies').set(auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects POST /api/platform/companies for a RECRUITER (and never creates)', async () => {
    const res = await request(app).post('/api/platform/companies').set(auth).send({
      name: 'Acme',
      firstAdmin: { name: 'Ada Admin', email: 'ada@acme.test', password: 'password123' },
    });
    expect(res.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects PUT /api/platform/settings for a RECRUITER', async () => {
    const res = await request(app).put('/api/platform/settings').set(auth).send({ authMode: 'oidc' });
    expect(res.status).toBe(403);
    expect(prisma.platformSettings.upsert).not.toHaveBeenCalled();
  });
});

describe('GET /api/platform/companies (super admin)', () => {
  beforeEach(() => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(superAdminUser as never);
  });

  it('lists tenants with their user counts', async () => {
    vi.mocked(prisma.company.findMany).mockResolvedValue([
      {
        id: 'co-1',
        name: 'Acme Software',
        slug: 'acme-software',
        website: 'https://acme.test',
        createdAt: new Date('2026-08-29T00:00:00Z'),
        _count: { users: 7 },
      },
      {
        id: 'co-2',
        name: 'Globex',
        slug: 'globex',
        website: null,
        createdAt: new Date('2026-08-28T00:00:00Z'),
        _count: { users: 0 },
      },
    ] as never);

    const res = await request(app).get('/api/platform/companies').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.companies).toHaveLength(2);
    expect(res.body.companies[0]).toMatchObject({ id: 'co-1', name: 'Acme Software', userCount: 7 });
    expect(res.body.companies[1]).toMatchObject({ id: 'co-2', name: 'Globex', userCount: 0 });
    // No company user rows may leak from the list endpoint.
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });
});

describe('POST /api/platform/companies (super admin)', () => {
  beforeEach(() => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(superAdminUser as never);
  });

  it('creates the company AND its first ADMIN in one transaction', async () => {
    const companyRow = {
      id: 'co-new',
      name: 'Initech',
      slug: 'initech',
      website: 'https://initech.test',
      createdAt: new Date('2026-08-29T00:00:00Z'),
    };
    const adminRow = {
      id: 'user-ina-1',
      email: 'ada@initech.test',
      name: 'Ada Admin',
      role: 'ADMIN',
    };
    // The mocked transaction client: every create is recorded so the test can
    // assert BOTH rows were produced inside the SAME $transaction call.
    const txCompanyCreate = vi.fn(async () => companyRow);
    const txUserCreate = vi.fn(async (_args: { data: { passwordHash: string } }) => adminRow);
    const tx = {
      company: { findUnique: vi.fn(async () => null), create: txCompanyCreate },
      user: { findUnique: vi.fn(async () => null), create: txUserCreate },
    };
    vi.mocked(prisma.$transaction).mockImplementation(
      (async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as never,
    );

    const res = await request(app)
      .post('/api/platform/companies')
      .set(auth)
      .send({
        name: 'Initech',
        website: 'https://initech.test',
        firstAdmin: { name: 'Ada Admin', email: 'ada@initech.test', password: 'password123' },
      });

    expect(res.status).toBe(201);
    expect(res.body.company).toMatchObject({ id: 'co-new', name: 'Initech', userCount: 1 });
    expect(res.body.admin).toMatchObject({ email: 'ada@initech.test', role: 'ADMIN' });

    // Transactional semantics: one $transaction, company first, ADMIN tied to
    // the company id returned by the in-transaction create.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(txCompanyCreate).toHaveBeenCalledWith({
      data: { name: 'Initech', slug: 'initech', website: 'https://initech.test' },
    });
    expect(txUserCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'ada@initech.test',
        name: 'Ada Admin',
        role: 'ADMIN',
        companyId: 'co-new',
      }),
    });
    // The password is hashed before it reaches Prisma — never stored raw.
    const userCreateArgs = txUserCreate.mock.calls[0]![0];
    expect(userCreateArgs.data.passwordHash).not.toBe('password123');
  });

  it('rejects a body without a name (400 VALIDATION_ERROR)', async () => {
    const res = await request(app).post('/api/platform/companies').set(auth).send({ website: 'https://x.test' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a malformed firstAdmin block without touching the database', async () => {
    const res = await request(app)
      .post('/api/platform/companies')
      .set(auth)
      .send({ name: 'Initech', firstAdmin: { name: 'A', email: 'not-an-email', password: 'short' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('PUT /api/platform/settings (super admin)', () => {
  beforeEach(() => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(superAdminUser as never);
  });

  it('rejects an authMode outside local|oidc (400 VALIDATION_ERROR)', async () => {
    for (const authMode of ['keycloak', 'LOCAL', '', null, 42]) {
      const res = await request(app).put('/api/platform/settings').set(auth).send({ authMode });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(prisma.platformSettings.upsert).not.toHaveBeenCalled();
  });

  it('upserts the singleton row with the new mode', async () => {
    vi.mocked(prisma.platformSettings.upsert).mockResolvedValue({ authMode: 'oidc' } as never);

    const res = await request(app).put('/api/platform/settings').set(auth).send({ authMode: 'oidc' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authMode: 'oidc' });
    expect(prisma.platformSettings.upsert).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      create: { id: 'singleton', authMode: 'oidc' },
      update: { authMode: 'oidc' },
      select: { authMode: true },
    });
  });
});

describe('GET /api/platform/settings (super admin)', () => {
  beforeEach(() => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(superAdminUser as never);
  });

  it('returns the stored platform auth mode', async () => {
    vi.mocked(prisma.platformSettings.findUnique).mockResolvedValue({ authMode: 'oidc' } as never);
    const res = await request(app).get('/api/platform/settings').set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authMode: 'oidc' });
  });

  it('falls back to the boot-time env mode when no row exists yet', async () => {
    vi.mocked(prisma.platformSettings.findUnique).mockResolvedValue(null as never);
    const res = await request(app).get('/api/platform/settings').set(auth);
    expect(res.status).toBe(200);
    expect(['local', 'oidc']).toContain(res.body.authMode);
  });
});

// ─── V2-4 (D21): platform-wide sandbox template oversight (read-only) ─────────

describe('GET /api/platform/sandbox-templates', () => {
  it('rejects a company token (RECRUITER → 403)', async () => {
    // Earlier suites prime platformSettings.findUnique with oidc, and the
    // middleware's mode read is 10s-cached — drop the cache and re-prime
    // local so requireAuth resolves the local user before the role gate.
    resetAuthModeCacheForTests();
    vi.mocked(prisma.platformSettings.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(recruiterUser as never);
    const res = await request(app).get('/api/platform/sandbox-templates').set(auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('lists every company with per-language resolved images (super admin)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(superAdminUser as never);
    vi.mocked(prisma.company.findMany).mockResolvedValue([
      {
        id: 'co-1',
        name: 'Acme Software',
        sandboxTemplates: [
          {
            id: 'tpl-1',
            name: 'Node CI',
            description: null,
            language: 'NODE',
            image: 'registry.acme.test/node:20-ci',
            enabled: true,
            updatedAt: new Date('2026-08-29T00:00:00Z'),
          },
        ],
      },
      {
        id: 'co-2',
        name: 'Globex',
        sandboxTemplates: [
          {
            id: 'tpl-2',
            name: 'Draft bash',
            description: null,
            language: 'BASH',
            image: 'globex/bash:5.2',
            enabled: false, // disabled draft: never overrides
            updatedAt: new Date('2026-08-29T00:00:00Z'),
          },
        ],
      },
      { id: 'co-3', name: 'Initech', sandboxTemplates: [] },
    ] as never);

    const res = await request(app).get('/api/platform/sandbox-templates').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.companies).toHaveLength(3);

    const acme = res.body.companies[0];
    expect(acme).toMatchObject({ companyId: 'co-1', companyName: 'Acme Software', anyOverride: true });
    const acmeNode = acme.languages.find((l: { language: string }) => l.language === 'NODE');
    expect(acmeNode).toMatchObject({
      activeImage: 'registry.acme.test/node:20-ci',
      activeSource: 'COMPANY',
      defaultImage: 'node:20-alpine',
    });
    const acmeBash = acme.languages.find((l: { language: string }) => l.language === 'BASH');
    expect(acmeBash.activeSource).toBe('PLATFORM');

    // A DISABLED template resolves to the platform default — drafts never run.
    const globex = res.body.companies[1];
    expect(globex.anyOverride).toBe(false);
    const globexBash = globex.languages.find((l: { language: string }) => l.language === 'BASH');
    expect(globexBash).toMatchObject({ activeImage: 'bash:5.2', activeSource: 'PLATFORM' });
    expect(globexBash.template.enabled).toBe(false); // …but the draft is still visible to the platform owner.

    // Companies without rows list with null templates (unconfigured, not broken).
    const initech = res.body.companies[2];
    expect(initech.anyOverride).toBe(false);
    for (const l of initech.languages) expect(l.template).toBeNull();
  });
});
