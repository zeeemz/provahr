// Candidate test profile (founder requirement 2026-09-21) + the re-appearance
// pin: a candidate rejected on one role can apply to any other role — nothing
// in the apply path consults other applications. House mock style from
// apply-mint.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { signToken } from '../src/lib/token';

const {
  userFindUnique,
  applicationFindMany,
  candidateFindUnique,
  evaluationFindMany,
  // apply-path mocks (re-appearance pin):
  jobFindUnique,
  candidateUpsert,
  applicationFindUnique,
  applicationCreate,
  stageEventCreate,
  poolFindFirst,
} = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  applicationFindMany: vi.fn(),
  candidateFindUnique: vi.fn(),
  evaluationFindMany: vi.fn(),
  jobFindUnique: vi.fn(),
  candidateUpsert: vi.fn(),
  applicationFindUnique: vi.fn(),
  applicationCreate: vi.fn(),
  stageEventCreate: vi.fn(),
  poolFindFirst: vi.fn(),
}));

vi.mock('../src/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    application: { findMany: applicationFindMany, findUnique: applicationFindUnique },
    candidate: { findUnique: candidateFindUnique, upsert: candidateUpsert },
    evaluation: { findMany: evaluationFindMany },
    job: { findUnique: jobFindUnique },
    sealedQuestionPool: { findFirst: poolFindFirst },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        application: { create: applicationCreate },
        stageEvent: { create: stageEventCreate },
      }),
  },
}));

import { createApp } from '../src/app';

const app = createApp();
const token = signToken('user-cp-1');
const auth = { Authorization: `Bearer ${token}` };

function primeUser(role: string) {
  userFindUnique.mockResolvedValue({
    id: 'user-cp-1',
    email: 'hr@example.com',
    name: 'Hr Person',
    role,
    companyId: 'company-1',
    company: { name: 'Acme' },
  });
}

describe('GET /api/candidates/:candidateId/profile', () => {
  it('rejects without a token', async () => {
    const res = await request(app).get('/api/candidates/cand-1/profile');
    expect(res.status).toBe(401);
  });

  it('rejects interviewers — the profile is HR evidence', async () => {
    primeUser('INTERVIEWER');
    const res = await request(app).get('/api/candidates/cand-1/profile').set(auth);
    expect(res.status).toBe(403);
  });

  it('404s (no cross-tenant oracle) when the candidate has no application to this company', async () => {
    primeUser('RECRUITER');
    applicationFindMany.mockResolvedValue([]);
    const res = await request(app).get('/api/candidates/cand-1/profile').set(auth);
    expect(res.status).toBe(404);
  });

  it('aggregates the cross-role story: history, average, per-format tallies, flags', async () => {
    primeUser('RECRUITER');
    // Two roles: one flunked (rejected, scored 0.25), one fresh (interviewing, scored 0.9).
    applicationFindMany.mockResolvedValue([
      {
        id: 'app-2',
        stage: 'INTERVIEW',
        status: 'ACTIVE',
        createdAt: new Date('2026-09-15T10:00:00Z'),
        source: null,
        job: { id: 'job-2', title: 'SRE' },
        testSession: {
          status: 'SUBMITTED',
          submittedAt: new Date('2026-09-16T10:00:00Z'),
          assessment: { totalScore: 0.9, strengths: 'linux (3/3)', gaps: 'sql (1/2)', flagSummary: { aiHigh: 0, aiMedium: 1 } },
        },
      },
      {
        id: 'app-1',
        stage: 'ASSESSMENT',
        status: 'REJECTED',
        createdAt: new Date('2026-08-01T10:00:00Z'),
        source: 'WALK_IN',
        job: { id: 'job-1', title: 'Support Specialist' },
        testSession: {
          status: 'SUBMITTED',
          submittedAt: new Date('2026-08-02T10:00:00Z'),
          assessment: { totalScore: 0.25, strengths: null, gaps: 'linux (0/2), sql (0/1)', flagSummary: { aiHigh: 1, aiMedium: 0 } },
        },
      },
    ]);
    candidateFindUnique.mockResolvedValue({
      id: 'cand-1', name: 'Repeat Candidate', email: 'repeat@provahr.test',
      phone: null, resumeUrl: null, linkedinUrl: null, githubUrl: null, createdAt: new Date('2026-08-01T09:00:00Z'),
    });
    evaluationFindMany.mockResolvedValue([
      { verdict: 'CORRECT', sessionQuestion: { format: 'MCQ' } },
      { verdict: 'INCORRECT', sessionQuestion: { format: 'MCQ' } },
      { verdict: 'PARTIAL', sessionQuestion: { format: 'SWIPE_MCQ' } },
      { verdict: 'CORRECT', sessionQuestion: { format: 'WRITTEN' } },
    ]);

    const res = await request(app).get('/api/candidates/cand-1/profile').set(auth);

    expect(res.status).toBe(200);
    expect(res.body.candidate.name).toBe('Repeat Candidate');
    expect(res.body.summary.applications).toBe(2);
    expect(res.body.summary.testsTaken).toBe(2);
    expect(res.body.summary.averageScore).toBeCloseTo(0.575, 5);
    expect(res.body.summary.byFormat.MCQ).toEqual({ CORRECT: 1, PARTIAL: 0, INCORRECT: 1 });
    expect(res.body.summary.byFormat.SWIPE_MCQ).toEqual({ CORRECT: 0, PARTIAL: 1, INCORRECT: 0 });
    expect(res.body.summary.flags).toEqual({ high: 1, medium: 1 });
    expect(res.body.history).toHaveLength(2);
    expect(res.body.history[1].source).toBe('WALK_IN');
    expect(res.body.history[1].session.score).toBe(0.25); // the flunked one stays visible — and blocks nothing
  });
});

describe('re-appearance pin: flunking one role never blocks another', () => {
  const INPUT = { name: 'Repeat Candidate', email: 'repeat@provahr.test' };

  beforeEach(() => {
    vi.clearAllMocks();
    jobFindUnique.mockResolvedValue({ id: 'job-2', status: 'OPEN' });
    candidateUpsert.mockResolvedValue({ id: 'cand-1', email: INPUT.email });
    applicationCreate.mockResolvedValue({
      id: 'app-new', jobId: 'job-2', createdAt: new Date(), job: { id: 'job-2', title: 'SRE' },
    });
    stageEventCreate.mockResolvedValue({});
    poolFindFirst.mockResolvedValue(null); // NO_POOL — no session minting in this test's way
  });

  it('a candidate REJECTED on job-1 applies cleanly to job-2', async () => {
    // The ONLY duplicate check is (jobId, candidateId) for THIS job — the
    // rejection on job-1 is never consulted.
    applicationFindUnique.mockResolvedValue(null);

    const res = await request(app).post('/api/public/jobs/job-2/apply').send(INPUT);

    expect(res.status).toBe(201);
    const check = applicationFindUnique.mock.calls[0][0] as { where: { jobId_candidateId: { jobId: string } } };
    expect(check.where.jobId_candidateId.jobId).toBe('job-2');
  });

  it('still refuses a re-apply to the SAME role (409 ALREADY_APPLIED)', async () => {
    applicationFindUnique.mockResolvedValue({ id: 'app-existing' });
    const res = await request(app).post('/api/public/jobs/job-1/apply').send(INPUT);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_APPLIED');
  });
});
