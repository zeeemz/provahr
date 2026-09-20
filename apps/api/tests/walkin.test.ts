// Walk-in flow (founder requirement 2026-09-20): HR creates the application at
// the office, the candidate completes their details from the test link.
//
// Covers: POST /api/jobs/:jobId/walkin (auth gate, WALK_IN sourcing + HR-credited
// stage event, link minting, NO_POOL, ALREADY_APPLIED) and the token-gated
// candidate half (GET /test/:token walkIn fields, POST .../details writes,
// uniform 404s, DETAILS_LOCKED after start). Same prisma-mock seam as
// apply-mint.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { signToken } from '../src/lib/token';

const {
  userFindUnique,
  jobFindFirst,
  candidateUpsert,
  candidateUpdate,
  applicationFindUnique,
  applicationCreate,
  applicationUpdate,
  stageEventCreate,
  poolFindFirst,
  testSessionCreate,
  testSessionFindUnique,
} = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  jobFindFirst: vi.fn(),
  candidateUpsert: vi.fn(),
  candidateUpdate: vi.fn(),
  applicationFindUnique: vi.fn(),
  applicationCreate: vi.fn(),
  applicationUpdate: vi.fn(),
  stageEventCreate: vi.fn(),
  poolFindFirst: vi.fn(),
  testSessionCreate: vi.fn(),
  testSessionFindUnique: vi.fn(),
}));

vi.mock('../src/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    job: { findFirst: jobFindFirst },
    candidate: { upsert: candidateUpsert, update: candidateUpdate },
    application: { findUnique: applicationFindUnique, update: applicationUpdate },
    sealedQuestionPool: { findFirst: poolFindFirst },
    testSession: { create: testSessionCreate, findUnique: testSessionFindUnique },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        application: { create: applicationCreate },
        stageEvent: { create: stageEventCreate },
      }),
  },
}));

import { createApp } from '../src/app';

const app = createApp();
const token = signToken('user-wi-1');
const auth = { Authorization: `Bearer ${token}` };

const BODY = { name: 'Walk In Wanderer', email: 'walkin@provahr.test', phone: '+1 555 0100' };

function prime() {
  vi.clearAllMocks();
  userFindUnique.mockResolvedValue({
    id: 'user-wi-1',
    email: 'hr@example.com',
    name: 'Hr Person',
    role: 'RECRUITER',
    companyId: 'company-1',
    company: { name: 'Acme' },
  });
  jobFindFirst.mockResolvedValue({ id: 'job-1', status: 'OPEN' });
  candidateUpsert.mockResolvedValue({ id: 'cand-1', email: BODY.email });
  applicationFindUnique.mockResolvedValue(null);
  applicationCreate.mockResolvedValue({ id: 'app-1', jobId: 'job-1', createdAt: new Date() });
  stageEventCreate.mockResolvedValue({});
  poolFindFirst.mockResolvedValue({ id: 'pool-1' });
  testSessionCreate.mockResolvedValue({ id: 'sess-1' });
}

describe('POST /api/jobs/:jobId/walkin — HR side', () => {
  it('rejects without a token', async () => {
    const res = await request(app).post('/api/jobs/job-1/walkin').send(BODY);
    expect(res.status).toBe(401);
  });

  it('rejects a short name', async () => {
    prime();
    const res = await request(app).post('/api/jobs/job-1/walkin').set(auth).send({ ...BODY, name: 'A' });
    expect(res.status).toBe(400);
  });

  it('creates a WALK_IN application credited to the HR user and mints a one-time link', async () => {
    prime();
    const res = await request(app).post('/api/jobs/job-1/walkin').set(auth).send(BODY);

    expect(res.status).toBe(201);
    expect(res.body.application.id).toBe('app-1');
    expect(res.body.testLink.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Sourcing + audit: WALK_IN application, stage event credits the HR user.
    const created = applicationCreate.mock.calls[0][0] as { data: { source: string } };
    expect(created.data.source).toBe('WALK_IN');
    const event = stageEventCreate.mock.calls[0][0] as { data: { actorId: string | null } };
    expect(event.data.actorId).toBe('user-wi-1');

    // Hash-only storage, and the pool probe selects only the id.
    const session = testSessionCreate.mock.calls[0][0] as { data: { tokenHash: string } };
    expect(session.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const poolArg = poolFindFirst.mock.calls[0][0] as { select: Record<string, boolean> };
    expect(Object.keys(poolArg.select)).toEqual(['id']);
  });

  it('creates the application without a link when no pool is sealed (NO_POOL)', async () => {
    prime();
    poolFindFirst.mockResolvedValue(null);
    const res = await request(app).post('/api/jobs/job-1/walkin').set(auth).send(BODY);
    expect(res.status).toBe(201);
    expect(res.body.testLink).toBeNull();
    expect(res.body.testLinkReason).toBe('NO_POOL');
  });

  it('propagates ALREADY_APPLIED before any session is minted', async () => {
    prime();
    applicationFindUnique.mockResolvedValue({ id: 'existing' });
    const res = await request(app).post('/api/jobs/job-1/walkin').set(auth).send(BODY);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_APPLIED');
    expect(testSessionCreate).not.toHaveBeenCalled();
  });

  it('404s for another company job or a non-OPEN job (company-scoped lookup)', async () => {
    prime();
    jobFindFirst.mockResolvedValue(null);
    const res = await request(app).post('/api/jobs/job-x/walkin').set(auth).send(BODY);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/public/test/:token + POST .../details — candidate side', () => {
  const TOKEN = 't'.repeat(43);

  function primeSession(status: string, source: string | null) {
    prime();
    testSessionFindUnique.mockResolvedValue({
      status,
      expiresAt: new Date(Date.now() + 86_400_000),
      applicationId: 'app-1',
      application: {
        source,
        candidateId: 'cand-1',
        candidate: {
          name: 'Walk In Wanderer',
          email: BODY.email,
          phone: BODY.phone,
          resumeUrl: null,
          linkedinUrl: null,
          githubUrl: null,
        },
      },
      job: { title: 'Support Specialist', blueprint: { timeLimitMin: 30 } },
    });
  }

  it('GET reports walkIn + candidate for a walk-in link, and not for a normal link', async () => {
    primeSession('ISSUED', 'WALK_IN');
    const wi = await request(app).get(`/api/public/test/${TOKEN}`);
    expect(wi.status).toBe(200);
    expect(wi.body.walkIn).toBe(true);
    expect(wi.body.candidate.name).toBe('Walk In Wanderer');
    expect(wi.body.candidate.email).toBe(BODY.email);

    primeSession('ISSUED', null);
    const normal = await request(app).get(`/api/public/test/${TOKEN}`);
    expect(normal.status).toBe(200);
    expect(normal.body.walkIn).toBe(false);
    expect(normal.body.candidate).toBeUndefined();
  });

  it('saves provided details before the test starts (candidate + application writes)', async () => {
    primeSession('ISSUED', 'WALK_IN');
    const res = await request(app)
      .post(`/api/public/test/${TOKEN}/details`)
      .send({ resumeUrl: 'https://cv.example.com/x', coverLetter: 'I walk in, I deliver.' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ saved: true });
    const candArg = candidateUpdate.mock.calls[0][0] as { where: { id: string }; data: Record<string, string> };
    expect(candArg.where.id).toBe('cand-1');
    expect(candArg.data.resumeUrl).toBe('https://cv.example.com/x');
    const appArg = applicationUpdate.mock.calls[0][0] as { data: { coverLetter: string } };
    expect(appArg.data.coverLetter).toBe('I walk in, I deliver.');
  });

  it('uniform 404 for unknown tokens and for non-walk-in tokens', async () => {
    primeSession('ISSUED', 'WALK_IN');
    testSessionFindUnique.mockResolvedValue(null);
    const unknown = await request(app).post(`/api/public/test/${TOKEN}/details`).send({});
    expect(unknown.status).toBe(404);

    primeSession('ISSUED', null); // a normal self-serve link
    const normal = await request(app).post(`/api/public/test/${TOKEN}/details`).send({});
    expect(normal.status).toBe(404);
  });

  it('locks details once the session has started (409 DETAILS_LOCKED)', async () => {
    primeSession('STARTED', 'WALK_IN');
    const res = await request(app).post(`/api/public/test/${TOKEN}/details`).send({ phone: '+1 555 0101' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DETAILS_LOCKED');
    expect(candidateUpdate).not.toHaveBeenCalled();
  });
});
