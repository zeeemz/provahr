import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { toRedactedProvider } from '../src/modules/admin/llm-providers.service';
import { encryptSecret } from '../src/lib/crypto';
import { signToken } from '../src/lib/token';
import { UNAUTH_TEST_KEY, REDACTION_TEST_KEY } from './fixtures/credentials';

// No database is reachable in unit tests, so these cover the auth gate
// (which runs before any Prisma call), the pure redaction helper, and — since
// V2-4 — the sandbox-template ADMIN surface against a mocked prisma (same
// seam as platform-routes.test.ts: requireAuth loads the user from the
// database, so the registry carries user + sandboxTemplate). The DB-backed
// happy paths belong to CI's integration tier.

const { userFindUnique, sandboxTemplateFindMany, sandboxTemplateUpsert } = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  sandboxTemplateFindMany: vi.fn(),
  sandboxTemplateUpsert: vi.fn(),
}));

vi.mock('../src/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    sandboxTemplate: { findMany: sandboxTemplateFindMany, upsert: sandboxTemplateUpsert },
  },
}));

const app = createApp();

// Two companies, two admins (V2-4 isolation fixtures): the WHERE clauses the
// service sends decide who sees what — flipped below to prove scoping.
const adminA = {
  id: 'user-a',
  email: 'ada@acme.test',
  name: 'Ada Admin',
  role: 'ADMIN',
  companyId: 'company-a',
  company: { name: 'Acme' },
};
const adminB = {
  id: 'user-b',
  email: 'ben@bcorp.test',
  name: 'Ben Admin',
  role: 'ADMIN',
  companyId: 'company-b',
  company: { name: 'BCorp' },
};
const superAdmin = {
  id: 'user-s',
  email: 'root@provahr.test',
  name: 'Sam Super',
  role: 'SUPER_ADMIN',
  companyId: null, // platform-level (D18): requireRole('ADMIN') never admits it
  company: null,
};

const authA = { Authorization: `Bearer ${signToken('user-a')}` };
const authB = { Authorization: `Bearer ${signToken('user-b')}` };
const authSuper = { Authorization: `Bearer ${signToken('user-s')}` };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('admin llm-providers auth gate', () => {
  it('rejects GET /api/admin/llm-providers without a token', async () => {
    const res = await request(app).get('/api/admin/llm-providers');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects GET /api/admin/llm-providers with a garbage bearer token', async () => {
    const res = await request(app).get('/api/admin/llm-providers').set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects POST /api/admin/llm-providers without a token', async () => {
    const res = await request(app).post('/api/admin/llm-providers').send({
      kind: 'ANTHROPIC',
      apiKey: UNAUTH_TEST_KEY,
      textModel: 'claude-sonnet-4-20250514',
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects DELETE /api/admin/llm-providers/:id without a token (and never 404s past the gate)', async () => {
    const res = await request(app).delete('/api/admin/llm-providers/some-id');
    expect(res.status).toBe(401);
  });
});

// ─── V2-4 (D21): sandbox templates — gates + company scoping ──────────────────

describe('admin sandbox-templates — auth + role gates', () => {
  it('rejects GET /api/admin/sandbox-templates without a token', async () => {
    const res = await request(app).get('/api/admin/sandbox-templates');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects PUT /api/admin/sandbox-templates without a token (never 404s past the gate)', async () => {
    const res = await request(app).put('/api/admin/sandbox-templates').send({});
    expect(res.status).toBe(401);
    expect(sandboxTemplateUpsert).not.toHaveBeenCalled();
  });

  it('rejects GET for a RECRUITER (company token, wrong role)', async () => {
    userFindUnique.mockResolvedValue({ ...adminA, role: 'RECRUITER' });
    const res = await request(app).get('/api/admin/sandbox-templates').set(authA);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects PUT for a RECRUITER — nothing is written', async () => {
    userFindUnique.mockResolvedValue({ ...adminA, role: 'RECRUITER' });
    const res = await request(app).put('/api/admin/sandbox-templates').set(authA).send({
      language: 'NODE',
      name: 'Node CI',
      image: 'acme/node-ci:20',
      enabled: true,
    });
    expect(res.status).toBe(403);
    expect(sandboxTemplateUpsert).not.toHaveBeenCalled();
  });

  it('rejects GET/PUT for the company-less SUPER_ADMIN (platform role, not tenant)', async () => {
    userFindUnique.mockResolvedValue(superAdmin);
    expect((await request(app).get('/api/admin/sandbox-templates').set(authSuper)).status).toBe(403);
    expect((await request(app).put('/api/admin/sandbox-templates').set(authSuper).send({
      language: 'NODE',
      name: 'x',
      image: 'x:1',
      enabled: true,
    })).status).toBe(403);
    expect(sandboxTemplateUpsert).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/sandbox-templates (company admin)', () => {
  it('scopes the query to the CALLER’s company — admin A sees only company-a rows', async () => {
    userFindUnique.mockResolvedValue(adminA);
    sandboxTemplateFindMany.mockResolvedValue([
      {
        id: 'tpl-1',
        name: 'Node CI image',
        description: null,
        language: 'NODE',
        image: 'registry.acme.test/node:20-ci',
        enabled: true,
        updatedAt: new Date('2026-08-29T00:00:00Z'),
      },
    ]);

    const res = await request(app).get('/api/admin/sandbox-templates').set(authA);
    expect(res.status).toBe(200);
    // The one query is company-filtered — A never sees B by construction.
    expect(sandboxTemplateFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'company-a' } }),
    );

    // All three languages list (stored or not) with resolved-active info.
    expect(res.body.templates).toHaveLength(3);
    const byLanguage = new Map(res.body.templates.map((t: { language: string }) => [t.language, t]));
    expect(byLanguage.get('NODE')).toMatchObject({
      defaultImage: 'node:20-alpine',
      activeImage: 'registry.acme.test/node:20-ci',
      activeSource: 'COMPANY',
      template: { image: 'registry.acme.test/node:20-ci', enabled: true },
    });
    expect(byLanguage.get('BASH')).toMatchObject({
      defaultImage: 'bash:5.2',
      activeImage: 'bash:5.2',
      activeSource: 'PLATFORM',
      template: null,
    });
  });

  it('admin B’s list queries company-b — the same row is invisible from B', async () => {
    userFindUnique.mockResolvedValue(adminB);
    // What A stored sits under company-a; B’s query filters company-b, so B’s
    // service call can only ever return B’s rows (empty here).
    sandboxTemplateFindMany.mockResolvedValue([]);

    const res = await request(app).get('/api/admin/sandbox-templates').set(authB);
    expect(res.status).toBe(200);
    expect(sandboxTemplateFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'company-b' } }),
    );
    for (const row of res.body.templates) {
      expect(row.template).toBeNull();
      expect(row.activeSource).toBe('PLATFORM');
    }
  });
});

describe('PUT /api/admin/sandbox-templates (company admin)', () => {
  const validBody = {
    language: 'NODE',
    name: 'Node CI image',
    image: 'registry.acme.test/node:20-ci',
    enabled: true,
  };

  it('upserts on the CALLER’s company compound key — A cannot touch B’s row', async () => {
    userFindUnique.mockResolvedValue(adminA);
    sandboxTemplateUpsert.mockResolvedValue({
      id: 'tpl-1',
      name: validBody.name,
      description: null,
      language: 'NODE',
      image: validBody.image,
      enabled: true,
      updatedAt: new Date('2026-08-29T00:00:00Z'),
    });

    const res = await request(app).put('/api/admin/sandbox-templates').set(authA).send(validBody);
    expect(res.status).toBe(200);
    expect(sandboxTemplateUpsert).toHaveBeenCalledTimes(1);
    expect(sandboxTemplateUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        // companyId_language compound key: the caller's company, not a body-supplied one.
        where: { companyId_language: { companyId: 'company-a', language: 'NODE' } },
        create: expect.objectContaining({ companyId: 'company-a', createdBy: 'user-a', image: validBody.image }),
      }),
    );
    expect(res.body.template).toMatchObject({ activeImage: validBody.image, activeSource: 'COMPANY' });
  });

  it('admin B’s PUT writes under company-b (A/B isolation at the write path)', async () => {
    userFindUnique.mockResolvedValue(adminB);
    sandboxTemplateUpsert.mockResolvedValue({
      id: 'tpl-b1',
      name: 'Bash CI',
      description: null,
      language: 'BASH',
      image: 'bcorp/bash:5.2',
      enabled: true,
      updatedAt: new Date('2026-08-29T00:00:00Z'),
    });

    const res = await request(app)
      .put('/api/admin/sandbox-templates')
      .set(authB)
      .send({ ...validBody, language: 'BASH', name: 'Bash CI', image: 'bcorp/bash:5.2' });
    expect(res.status).toBe(200);
    expect(sandboxTemplateUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId_language: { companyId: 'company-b', language: 'BASH' } } }),
    );
  });

  it('refuses an UNSAFE image at the zod boundary (400 VALIDATION_ERROR, nothing written)', async () => {
    userFindUnique.mockResolvedValue(adminA);
    for (const image of [
      '--privileged', // flag-like
      '-v',
      'Node:20', // uppercase
      'evil.com/a:b$c', // metachar
      'a b', // whitespace
      '', // empty
      'a'.repeat(101), // over-length
      'app@sha256:deadbeef', // digest
    ]) {
      const res = await request(app)
        .put('/api/admin/sandbox-templates')
        .set(authA)
        .send({ ...validBody, image });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(sandboxTemplateUpsert).not.toHaveBeenCalled();
  });

  it('refuses a language outside CODE_LANGUAGES (no RUST templates)', async () => {
    userFindUnique.mockResolvedValue(adminA);
    const res = await request(app)
      .put('/api/admin/sandbox-templates')
      .set(authA)
      .send({ ...validBody, language: 'RUST' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(sandboxTemplateUpsert).not.toHaveBeenCalled();
  });

  it('refuses an empty name', async () => {
    userFindUnique.mockResolvedValue(adminA);
    const res = await request(app)
      .put('/api/admin/sandbox-templates')
      .set(authA)
      .send({ ...validBody, name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('toRedactedProvider', () => {
  const apiKey = REDACTION_TEST_KEY;

  const redacted = toRedactedProvider({
    id: 'provider-1',
    kind: 'ANTHROPIC',
    baseUrl: 'https://api.anthropic.com',
    textModel: 'claude-sonnet-4-20250514',
    visionModel: null,
    isActive: true,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    apiKeyEncrypted: encryptSecret(apiKey),
  });

  it('exposes only the last 4 characters of the API key', () => {
    expect(redacted.apiKeyLast4).toBe('7799');
    expect(redacted.apiKeyLast4).toHaveLength(4);
  });

  it('carries no ciphertext or key material anywhere in the object', () => {
    expect(redacted).not.toHaveProperty('apiKeyEncrypted');
    expect(redacted).not.toHaveProperty('apiKey');
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain('apiKeyEncrypted');
  });

  it('passes through the identifying fields unchanged', () => {
    expect(redacted).toMatchObject({
      id: 'provider-1',
      kind: 'ANTHROPIC',
      baseUrl: 'https://api.anthropic.com',
      textModel: 'claude-sonnet-4-20250514',
      visionModel: null,
      isActive: true,
    });
  });
});
