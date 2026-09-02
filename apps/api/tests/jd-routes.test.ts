import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { signToken } from '../src/lib/token';
import { buildJdUserPrompt } from '../src/prompts/jd';

// The 400-validation path runs AFTER requireAuth, whose local mode loads the
// user from the database. No DB is reachable in unit tests, so the prisma
// module is mocked with exactly one resolved user — the smallest seam that
// gets a signed token past auth without a database or network. The DB-backed
// flows (intake → draft → approve, queue claims) belong to CI's integration
// tier with a real Postgres, like admin-routes.test.ts.
vi.mock('../src/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({
        id: 'user-1',
        email: 'hannah@example.com',
        name: 'Hannah Recruiter',
        role: 'RECRUITER',
        companyId: 'company-1',
        company: { name: 'Acme' },
      })),
    },
  },
}));

import { createApp } from '../src/app';

const app = createApp();
const token = signToken('user-1');
const auth = { Authorization: `Bearer ${token}` };

describe('POST /api/jobs/intake — auth gate', () => {
  it('rejects without a token', async () => {
    const res = await request(app).post('/api/jobs/intake').send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a garbage bearer token', async () => {
    const res = await request(app).post('/api/jobs/intake').set('Authorization', 'Bearer garbage').send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('POST /api/jobs/intake — validation', () => {
  it('rejects an intake with no material at all', async () => {
    const res = await request(app).post('/api/jobs/intake').set(auth).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects notes as the only material when they are empty after trim', async () => {
    const res = await request(app).post('/api/jobs/intake').set(auth).send({ notes: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed urls', async () => {
    const res = await request(app).post('/api/jobs/intake').set(auth).send({ urls: ['not-a-url'] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects more than 5 urls', async () => {
    const res = await request(app)
      .post('/api/jobs/intake')
      .set(auth)
      .send({ urls: ['https://a.example', 'https://b.example', 'https://c.example', 'https://d.example', 'https://e.example', 'https://f.example'] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects screenshots with an unsupported media type', async () => {
    const res = await request(app)
      .post('/api/jobs/intake')
      .set(auth)
      .send({ screenshots: [{ name: 'x', mediaType: 'image/gif', base64: 'aGk=' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('JD subroutes — auth gate', () => {
  it('rejects GET /api/jobs/:id/jd without a token', async () => {
    const res = await request(app).get('/api/jobs/job-1/jd');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects PATCH /api/jobs/:id/jd without a token', async () => {
    const res = await request(app).patch('/api/jobs/job-1/jd').send({ title: 'X' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects POST /api/jobs/:id/jd/approve without a token', async () => {
    const res = await request(app).post('/api/jobs/job-1/jd/approve');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('buildJdUserPrompt', () => {
  it('delimits the material and includes notes and fetched pages', () => {
    const prompt = buildJdUserPrompt({
      notes: 'Senior Rust engineer, payments team.',
      fetched: [{ url: 'https://example.com/role', text: 'We build payment rails.' }],
      screenshotCount: 0,
    });
    expect(prompt).toContain('=== MATERIAL START ===');
    expect(prompt).toContain('=== MATERIAL END ===');
    expect(prompt).toContain('Senior Rust engineer, payments team.');
    expect(prompt).toContain('--- Fetched page: https://example.com/role ---');
    expect(prompt).toContain('We build payment rails.');
    expect(prompt).not.toContain('Screenshots');
  });

  it('mentions screenshots only when screenshotCount > 0', () => {
    const withShots = buildJdUserPrompt({ notes: 'n', fetched: [], screenshotCount: 3 });
    expect(withShots).toContain('Screenshots of a reference professional profile are attached as images');
    expect(withShots).toContain('(3 total)');

    const noShots = buildJdUserPrompt({ notes: 'n', fetched: [], screenshotCount: 0 });
    expect(noShots).not.toContain('Screenshots');
  });

  it('marks empty fetched text explicitly instead of silently truncating', () => {
    const prompt = buildJdUserPrompt({ fetched: [{ url: 'https://example.com/x', text: '' }], screenshotCount: 0 });
    expect(prompt).toContain('(no extractable text)');
  });
});
