// Mint path (QA wave-5 F3): POST apply → one-time link issuance.
//
// Separate file from apply-routes.test.ts on purpose: that file's rate-limit
// test exhausts the in-memory apply bucket (per-file module isolation gives
// this file a fresh limiter and a fresh prisma mock).

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

const { testSessionCreate, candidateUpsert, applicationFindUnique, applicationCreate, stageEventCreate, poolFindFirst, testSessionFindUnique, jobFindUnique } =
  vi.hoisted(() => ({
    testSessionCreate: vi.fn(),
    candidateUpsert: vi.fn(),
    applicationFindUnique: vi.fn(),
    applicationCreate: vi.fn(),
    stageEventCreate: vi.fn(),
    poolFindFirst: vi.fn(),
    testSessionFindUnique: vi.fn(),
    jobFindUnique: vi.fn(),
  }));

vi.mock('../src/prisma', () => ({
  prisma: {
    testSession: { findUnique: testSessionFindUnique, create: testSessionCreate },
    candidate: { upsert: candidateUpsert },
    application: { findUnique: applicationFindUnique },
    sealedQuestionPool: { findFirst: poolFindFirst },
    job: { findUnique: jobFindUnique },
    // Interactive-transaction client approximated 1:1 for these paths.
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        application: { create: applicationCreate },
        stageEvent: { create: stageEventCreate },
      }),
  },
}));

import { createApp } from '../src/app';

const app = createApp();

const APPLY_BODY = { name: 'Test Candidate', email: 'mint.path@provahr.test' };

function primeApplyMocks() {
  vi.clearAllMocks();
  testSessionFindUnique.mockResolvedValue(null);
  jobFindUnique.mockResolvedValue({ id: 'job-1', status: 'OPEN' }); // the apply gate
  candidateUpsert.mockResolvedValue({ id: 'cand-1', email: APPLY_BODY.email });
  applicationFindUnique.mockResolvedValue(null); // no duplicate
  applicationCreate.mockResolvedValue({
    id: 'app-1',
    jobId: 'job-1',
    createdAt: new Date(),
    job: { id: 'job-1', title: 'Senior Payments Engineer' },
  });
  stageEventCreate.mockResolvedValue({});
}

describe('POST /api/public/jobs/:id/apply — one-time link minting', () => {
  it('mints a link when an active pool exists: plain token once, hash-only storage', async () => {
    primeApplyMocks();
    poolFindFirst.mockResolvedValue({ id: 'pool-1' });
    testSessionCreate.mockResolvedValue({ id: 'sess-1' });

    const res = await request(app).post('/api/public/jobs/job-1/apply').send(APPLY_BODY);

    expect(res.status).toBe(201);
    expect(res.body.application.id).toBe('app-1');
    expect(res.body.testLink.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // The stored value is the sha256 hash — never the plain token.
    const createArg = testSessionCreate.mock.calls[0][0] as { data: { tokenHash: string } };
    expect(createArg.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(createArg.data.tokenHash).not.toBe(res.body.testLink.token);
    // The pool probe selects only the id — the encrypted blob never loads.
    const poolArg = poolFindFirst.mock.calls[0][0] as { select: Record<string, boolean> };
    expect(Object.keys(poolArg.select)).toEqual(['id']);
  });

  it('creates the application but no link when no pool is sealed (NO_POOL)', async () => {
    primeApplyMocks();
    poolFindFirst.mockResolvedValue(null);

    const res = await request(app).post('/api/public/jobs/job-1/apply').send(APPLY_BODY);

    expect(res.status).toBe(201);
    expect(res.body.testLink).toBeNull();
    expect(res.body.testLinkReason).toBe('NO_POOL');
    expect(testSessionCreate).not.toHaveBeenCalled();
  });

  it('409s BEFORE minting on a duplicate application (never-regress #3)', async () => {
    primeApplyMocks();
    applicationFindUnique.mockResolvedValue({ id: 'existing-app' }); // duplicate

    const res = await request(app).post('/api/public/jobs/job-1/apply').send(APPLY_BODY);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_APPLIED');
    expect(poolFindFirst).not.toHaveBeenCalled();
    expect(testSessionCreate).not.toHaveBeenCalled();
  });

  it('surfaces the friendly 409 when the unique-constraint race fires (P2002)', async () => {
    primeApplyMocks();
    // Pre-check sees no duplicate; the transaction insert loses the race.
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    applicationCreate.mockRejectedValue(p2002);

    const res = await request(app).post('/api/public/jobs/job-1/apply').send(APPLY_BODY);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_APPLIED'); // not generic CONFLICT
    expect(testSessionCreate).not.toHaveBeenCalled();
  });
});
