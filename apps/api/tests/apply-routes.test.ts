import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// DB-free coverage of the NEW public apply/test-link routes (PLAN.md Phase 4):
// the uniform 404 on GET /api/public/test/:token (probe-resistance — no
// oracle distinguishing bad shape from unknown token), the consent-screen
// meta shape (never items, never tokenHash), and the per-IP rate limiters on
// POST apply + GET /test/:token. Basic apply-body validation already lives
// in app.test.ts and is not duplicated here.
//
// These routes are anonymous, so no auth/prisma.user mock is needed — only
// prisma.testSession.findUnique for the valid-shaped token paths. Vitest
// isolates module state per file, so the router's in-memory limiters start
// at zero for this file regardless of other test files' traffic.

const { testSessionFindUnique, testSessionCreate, candidateUpsert, applicationFindUnique, applicationCreate, stageEventCreate, poolFindFirst } = vi.hoisted(() => ({
  testSessionFindUnique: vi.fn(),
  testSessionCreate: vi.fn(),
  candidateUpsert: vi.fn(),
  applicationFindUnique: vi.fn(),
  applicationCreate: vi.fn(),
  stageEventCreate: vi.fn(),
  poolFindFirst: vi.fn(),
}));

vi.mock('../src/prisma', () => ({
  prisma: {
    testSession: { findUnique: testSessionFindUnique, create: testSessionCreate },
    candidate: { upsert: candidateUpsert },
    application: { findUnique: applicationFindUnique },
    sealedQuestionPool: { findFirst: poolFindFirst },
    // $transaction executes the callback with the same mocked models (the
    // interactive-transaction client is approximated 1:1 for these paths).
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        application: { create: applicationCreate },
        stageEvent: { create: stageEventCreate },
      }),
  },
}));

import { createApp } from '../src/app';

const app = createApp();

// 43 chars of base64url — the exact shape generateTestToken() emits
// (18 + 18 + 7). Valid shape, but (almost certainly) not a real token.
const GOOD_SHAPED_TOKEN = 'AbCdEf1234567890_-AbCdEf1234567890_-AbCdEf1';
expect(GOOD_SHAPED_TOKEN).toHaveLength(43);

// A session row shaped exactly like the service's select (scalars + nested
// job title / blueprint time limit — the only things the consent screen gets).
function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ISSUED',
    expiresAt: new Date(Date.now() + 86_400_000),
    job: { title: 'Senior Payments Engineer', blueprint: { timeLimitMin: 45 } },
    ...overrides,
  };
}

describe('GET /api/public/test/:token — uniform 404 (no token oracle)', () => {
  const invalidShapeTokens = [
    'x',
    'definitely-garbage!!',
    'ünïcödé-tökéñ',
    'A'.repeat(42), // too short
    'A'.repeat(44), // too long
    'abc+def/ghi=jkl' + 'A'.repeat(29), // base64 (not base64url) alphabet
  ];

  it('answers every invalid-shape token with the identical 404 body', async () => {
    const bodies: string[] = [];
    for (const token of invalidShapeTokens) {
      const res = await request(app).get(`/api/public/test/${encodeURIComponent(token)}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      bodies.push(JSON.stringify(res.body));
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it('answers a valid-shaped but UNKNOWN token with the same 404 body (shape ≢ existence)', async () => {
    testSessionFindUnique.mockResolvedValue(null);

    const [resInvalid, resUnknown] = await Promise.all([
      request(app).get('/api/public/test/garbage-token'),
      request(app).get(`/api/public/test/${GOOD_SHAPED_TOKEN}`),
    ]);

    expect(resUnknown.status).toBe(404);
    expect(resUnknown.body).toEqual(resInvalid.body); // identical: no oracle
    // The unknown-token path is the only one that reached the DB, and it
    // looked the token up BY HASH — never by the plain value.
    expect(testSessionFindUnique).toHaveBeenCalledTimes(1);
    const callArg = testSessionFindUnique.mock.calls[0]![0] as { where: { tokenHash: string } };
    expect(callArg.where.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(callArg.where.tokenHash).not.toBe(GOOD_SHAPED_TOKEN);
  });
});

describe('GET /api/public/test/:token — consent-screen meta (never items, never tokenHash)', () => {
  beforeEach(() => {
    testSessionFindUnique.mockReset();
  });

  it('returns status/expiresAt/jobTitle/timeLimitMin for an ISSUED link', async () => {
    const row = sessionRow();
    testSessionFindUnique.mockResolvedValue(row);

    const res = await request(app).get(`/api/public/test/${GOOD_SHAPED_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ISSUED',
      expiresAt: row.expiresAt.toISOString(),
      jobTitle: 'Senior Payments Engineer',
      timeLimitMin: 45,
      alreadyUsed: false,
    });
    // No hash ever leaves the system — only the DB-side sha256 exists, and
    // it must not appear anywhere in the response.
    expect(JSON.stringify(res.body)).not.toContain('tokenHash');
  });

  it('flags STARTED links as alreadyUsed', async () => {
    testSessionFindUnique.mockResolvedValue(sessionRow({ status: 'STARTED' }));
    const res = await request(app).get(`/api/public/test/${GOOD_SHAPED_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('STARTED');
    expect(res.body.alreadyUsed).toBe(true);
  });

  it('flags SUBMITTED links as alreadyUsed', async () => {
    testSessionFindUnique.mockResolvedValue(sessionRow({ status: 'SUBMITTED' }));
    const res = await request(app).get(`/api/public/test/${GOOD_SHAPED_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUBMITTED');
    expect(res.body.alreadyUsed).toBe(true);
  });

  it('reports EXPIRED when expiresAt is in the past', async () => {
    testSessionFindUnique.mockResolvedValue(
      sessionRow({ expiresAt: new Date(Date.now() - 1000) }),
    );
    const res = await request(app).get(`/api/public/test/${GOOD_SHAPED_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('EXPIRED');
    expect(res.body.alreadyUsed).toBe(false); // never started, just stale
  });

  it('survives a missing blueprint (timeLimitMin null, job title still shown)', async () => {
    testSessionFindUnique.mockResolvedValue(
      sessionRow({ job: { title: 'Legacy Role', blueprint: null } }),
    );
    const res = await request(app).get(`/api/public/test/${GOOD_SHAPED_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.timeLimitMin).toBeNull();
    expect(res.body.jobTitle).toBe('Legacy Role');
  });
});

describe('rate limiting on the anonymous surface (per IP, per minute)', () => {
  beforeEach(() => {
    testSessionFindUnique.mockReset();
  });

  it('GET /test/:token trips to 429 after 20 hits within the window', async () => {
    // Earlier tests in this file already consumed part of this IP's test
    // bucket; hammer until the limiter trips — it must trip, with 429, and
    // everything before it stays a uniform 404 (probe gets no new signal).
    let saw429 = false;
    let remaining = 30; // hard stop so a broken limiter fails the test, not the suite
    while (!saw429 && remaining > 0) {
      const res = await request(app).get('/api/public/test/probe-garbage');
      if (res.status === 429) {
        saw429 = true;
        expect(res.body.error.code).toBe('RATE_LIMITED');
      } else {
        expect(res.status).toBe(404); // anything other than 404/429 is a bug
        expect(res.body.error.message).toBe('Test link not found');
      }
      remaining -= 1;
    }
    expect(saw429).toBe(true);
  });

  it('POST apply trips to 429 on the 21st request; the limiter runs before validation', async () => {
    // Separate bucket from GET /test — fresh in this file because nothing
    // above POSTs. Requests 1–20 are invalid bodies → 400 (validation still
    // answers once allowed); request 21 is refused by the limiter → 429.
    for (let i = 1; i <= 21; i++) {
      const res = await request(app).post('/api/public/jobs/job-1/apply').send({ name: 'x' });
      if (i <= 20) {
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      } else {
        expect(res.status).toBe(429);
        expect(res.body.error.code).toBe('RATE_LIMITED');
      }
    }
  });
});
