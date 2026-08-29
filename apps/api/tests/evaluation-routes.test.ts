// Phase 8 evaluation pipeline + HR X-ray + void (PLAN.md §4 step 6/7, §5.2 #7,
// §9; docs/TESTING.md phase-8 row + §6 #1/#4/#6). Mock house style from
// apply-mint.test.ts / session-routes.test.ts: the prisma module is mocked
// model-by-model, and the runEvaluation paths run the REAL crypto round-trip —
// the mock pool row carries itemsEncrypted = encryptSecret(JSON.stringify(items)).
//
// The LLM adapter is NEVER called in this file: prisma.llmProvider.findFirst
// resolves null, so getActiveAdapter fails with NO_PROVIDER and the service
// degrades to deterministic scoring exactly as production would without a
// configured provider. Since V2-2 the probe is company-scoped
// (getActiveAdapter(session.job.companyId)) — the runEvaluation fixtures carry
// job.companyId and the provider probe's where clause is asserted below.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { signToken } from '../src/lib/token';
import { encryptSecret } from '../src/lib/crypto';
import { runEvaluation } from '../src/modules/applications/evaluation.service';
import type { AssessmentItem } from '../src/lib/assessment/item';

const {
  mockUser,
  savedEvaluations,
  userFindUnique,
  applicationFindUnique,
  applicationUpdate,
  testSessionFindUnique,
  sessionQuestionFindFirst,
  sessionQuestionFindMany,
  answerUpsertUnused,
  poolFindFirst,
  voidedItemFindMany,
  voidedItemUpsert,
  voidedItemFindUnique,
  llmProviderFindFirst,
  evaluationFindUnique,
  evaluationUpsert,
  evaluationFindMany,
  evaluationUpdateMany,
  executionResultUpsert,
  sessionAssessmentUpsert,
  sessionAssessmentFindUnique,
  signalFindMany,
} = vi.hoisted(() => ({
  // Mutable auth target: tests flip role (ADMIN vs RECRUITER) and companyId.
  mockUser: {
    value: {
      id: 'user-1',
      email: 'hannah@example.com',
      name: 'Hannah Recruiter',
      role: 'RECRUITER' as 'RECRUITER' | 'ADMIN',
      companyId: 'company-1',
      company: { name: 'Acme' },
    },
  },
  // Stateful evaluation store so idempotency + rollup read what upserts wrote.
  savedEvaluations: { value: [] as Array<Record<string, unknown>> },
  userFindUnique: vi.fn(),
  applicationFindUnique: vi.fn(),
  applicationUpdate: vi.fn(),
  testSessionFindUnique: vi.fn(),
  sessionQuestionFindFirst: vi.fn(),
  sessionQuestionFindMany: vi.fn(),
  answerUpsertUnused: vi.fn(),
  poolFindFirst: vi.fn(),
  voidedItemFindMany: vi.fn(),
  voidedItemUpsert: vi.fn(),
  voidedItemFindUnique: vi.fn().mockResolvedValue(null),
  llmProviderFindFirst: vi.fn(),
  evaluationFindUnique: vi.fn(),
  evaluationUpsert: vi.fn(),
  evaluationFindMany: vi.fn(),
  evaluationUpdateMany: vi.fn(),
  executionResultUpsert: vi.fn(),
  sessionAssessmentUpsert: vi.fn(),
  sessionAssessmentFindUnique: vi.fn(),
  signalFindMany: vi.fn(),
}));

vi.mock('../src/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    application: { findUnique: applicationFindUnique, update: applicationUpdate },
    testSession: { findUnique: testSessionFindUnique },
    sessionQuestion: { findFirst: sessionQuestionFindFirst, findMany: sessionQuestionFindMany },
    answer: { upsert: answerUpsertUnused },
    sealedQuestionPool: { findFirst: poolFindFirst },
    voidedItem: { findMany: voidedItemFindMany, upsert: voidedItemUpsert, findUnique: voidedItemFindUnique },
    llmProvider: { findFirst: llmProviderFindFirst },
    evaluation: {
      findUnique: evaluationFindUnique,
      upsert: evaluationUpsert,
      findMany: evaluationFindMany,
      updateMany: evaluationUpdateMany,
    },
    executionResult: { upsert: executionResultUpsert },
    sessionAssessment: { upsert: sessionAssessmentUpsert, findUnique: sessionAssessmentFindUnique },
    sessionSignal: { findMany: signalFindMany },
    // Interactive-transaction client approximated 1:1 (voidItem is the only user).
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        voidedItem: { upsert: voidedItemUpsert },
        sessionQuestion: { findMany: sessionQuestionFindMany },
        evaluation: { updateMany: evaluationUpdateMany, findMany: evaluationFindMany },
        sessionAssessment: { upsert: sessionAssessmentUpsert },
      }),
  },
}));

import { createApp } from '../src/app';

const app = createApp();
const token = signToken('user-1');
const auth = { Authorization: `Bearer ${token}` };

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Truth data: one SWIPE_MCQ (2 true, 1 false) + one MCQ + one WRITTEN item. */
const POOL_ITEMS: AssessmentItem[] = [
  {
    id: 'item-swipe',
    format: 'SWIPE_MCQ',
    prompt: 'Which claims about Linux processes are true?',
    options: [
      { id: 'a', text: 'fork() returns twice', truth: true },
      { id: 'b', text: 'kill -9 can be caught', truth: false },
      { id: 'c', text: 'A zombie holds a PID', truth: true },
    ],
    difficulty: 'EASY',
    topics: ['linux'],
  },
  {
    id: 'item-mcq',
    format: 'MCQ',
    prompt: 'Which HTTP status should a well-formed idempotent replay return?',
    options: [
      { id: 'a', text: '200 with the original result body' },
      { id: 'b', text: '409 Conflict' },
      { id: 'c', text: '500 Internal Server Error' },
    ],
    correctOptionId: 'a',
    difficulty: 'EASY',
    topics: ['http'],
  },
  {
    id: 'item-written',
    format: 'WRITTEN',
    prompt: 'Explain how you would debug a slow endpoint.',
    rubric: 'Must name measurement first AND at least one isolation step.',
    difficulty: 'MEDIUM',
    topics: ['debugging'],
  },
];

/** Real AES-256-GCM box — runEvaluation must decrypt it (pool decrypt site #2). */
const ENCRYPTED_POOL = encryptSecret(JSON.stringify(POOL_ITEMS));

const now = new Date('2026-08-28T10:00:00.000Z');

function swipeAnswerRow(content: Record<string, unknown> | null) {
  return {
    content,
    revisions: 1,
    firstAnsweredAt: now,
    lastAnsweredAt: new Date('2026-08-28T10:01:00.000Z'),
  };
}

/** The submitted session's questions (swipe perfect, MCQ wrong). */
const SESSION_QUESTIONS = [
  {
    id: 'sq-1',
    order: 1,
    format: 'SWIPE_MCQ',
    itemId: 'item-swipe',
    answer: swipeAnswerRow({ a: 'LIKE', b: 'DISLIKE', c: 'LIKE' }), // perfect → 1.0
  },
  {
    id: 'sq-2',
    order: 2,
    format: 'MCQ',
    itemId: 'item-mcq',
    answer: swipeAnswerRow({ optionId: 'b' }), // wrong → 0.0
  },
];

const SESSION_SIGNALS = [
  { type: 'TAB_SWITCH' },
  { type: 'TAB_SWITCH' },
  { type: 'LARGE_PASTE' },
];

function primeRunEvaluation() {
  vi.clearAllMocks();
  savedEvaluations.value = [];
  mockUser.value = { ...mockUser.value, role: 'RECRUITER', companyId: 'company-1' };

  userFindUnique.mockImplementation(async () => mockUser.value);
  testSessionFindUnique.mockResolvedValue({ id: 'sess-1', jobId: 'job-1', status: 'SUBMITTED', job: { companyId: 'company-1' } });
  sessionQuestionFindMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
    const where = args?.where ?? {};
    // NOTE: the collusion probe also carries sessionId ({ not: ... }) — branch
    // on a scalar sessionId (this session's rows), not mere key presence.
    if (typeof where.sessionId === 'string') return SESSION_QUESTIONS;
    if (where.itemId && typeof where.itemId === 'object') return []; // collusion probe
    return []; // void-affected sessions
  });
  poolFindFirst.mockResolvedValue({ itemsEncrypted: ENCRYPTED_POOL });
  voidedItemFindMany.mockResolvedValue([]);
  llmProviderFindFirst.mockResolvedValue(null); // NO_PROVIDER → deterministic-only
  signalFindMany.mockImplementation(async () => SESSION_SIGNALS);

  // Stateful evaluation model: upserts append, lookups read the store.
  evaluationFindUnique.mockImplementation(
    async ({ where }: { where: { sessionQuestionId: string } }) =>
      savedEvaluations.value.find((e) => e.sessionQuestionId === where.sessionQuestionId) ?? null,
  );
  evaluationUpsert.mockImplementation(async ({ where, create }: { where: { sessionQuestionId: string }; create: Record<string, unknown> }) => {
    savedEvaluations.value.push({ ...create, sessionQuestionId: where.sessionQuestionId, voided: false });
    return {};
  });
  evaluationFindMany.mockImplementation(async () =>
    savedEvaluations.value.filter((e) => e.voided !== true).map((e) => ({
      sessionQuestionId: e.sessionQuestionId,
      verdict: e.verdict,
      score: e.score,
      aiLikelihood: e.aiLikelihood,
    })),
  );
  evaluationUpdateMany.mockResolvedValue({ count: 0 });
  sessionAssessmentUpsert.mockResolvedValue({});
  sessionAssessmentFindUnique.mockResolvedValue(null);
  executionResultUpsert.mockResolvedValue({});
  applicationUpdate.mockResolvedValue({});
}

// ─── Auth gates (docs/TESTING.md §6 #6 — HR-only routes) ──────────────────────

describe('evaluation routes — auth gate', () => {
  beforeEach(() => primeRunEvaluation());

  it('rejects GET /api/applications/:id/xray without a token', async () => {
    const res = await request(app).get('/api/applications/app-1/xray');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects POST /api/applications/admin/items/:itemId/void without a token', async () => {
    const res = await request(app).post('/api/applications/admin/items/item-1/void').send({ reason: 'flawed' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

// ─── X-ray: scoping + the asymmetric evidence view ────────────────────────────

describe('GET /api/applications/:id/xray', () => {
  function applicationRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'app-1',
      stage: 'ASSESSMENT',
      status: 'ACTIVE',
      job: { id: 'job-1', title: 'Senior Payments Engineer', companyId: 'company-1' },
      candidate: { id: 'cand-1', name: 'Ada Candidate', email: 'ada@example.com' },
      testSession: {
        id: 'sess-1',
        status: 'SUBMITTED',
        startedAt: now,
        submittedAt: now,
        deadlineAt: now,
      },
      ...overrides,
    };
  }

  function xrayQuestionRow() {
    return {
      order: 1,
      format: 'SWIPE_MCQ',
      itemId: 'item-swipe',
      presented: { prompt: 'Which claims…', options: [{ id: 'a', text: 'fork() returns twice' }] },
      answer: { content: { a: 'LIKE', b: 'DISLIKE', c: 'LIKE' }, revisions: 1, firstAnsweredAt: now, lastAnsweredAt: now },
      evaluation: {
        verdict: 'CORRECT',
        score: 1,
        method: 'DETERMINISTIC',
        detail: { hits: [] },
        qualityNotes: null,
        aiLikelihood: 'LOW',
        aiReasoning: null,
        voided: false,
        createdAt: now,
      },
      executionResult: null,
    };
  }

  beforeEach(() => {
    primeRunEvaluation();
    applicationFindUnique.mockResolvedValue(applicationRow());
    sessionQuestionFindMany.mockResolvedValue([xrayQuestionRow()]);
    sessionAssessmentFindUnique.mockResolvedValue({
      totalScore: 0.5,
      strengths: 'linux (1/1)',
      gaps: 'http (0/1)',
      recommendation: 'Advisory only — hiring decisions are made by humans.',
      flagSummary: { aiHigh: 0, aiMedium: 0, signals: { TAB_SWITCH: 2 }, collusion: [] },
    });
  });

  it('404s for another company application — no existence oracle (never-regress #4)', async () => {
    applicationFindUnique.mockResolvedValue(applicationRow({ job: { id: 'job-9', title: 'X', companyId: 'company-other' } }));
    const res = await request(app).get('/api/applications/app-1/xray').set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(sessionQuestionFindMany).not.toHaveBeenCalled();
  });

  it('404s for an unknown application with the identical body', async () => {
    applicationFindUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/applications/app-404/xray').set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: 'NOT_FOUND', message: 'Application not found' });
  });

  it('returns the full X-ray for a SUBMITTED session: answers, evaluations (with voided flag), signals, assessment', async () => {
    const res = await request(app).get('/api/applications/app-1/xray').set(auth);

    expect(res.status).toBe(200);
    expect(res.body.xray.available).toBe(true);
    expect(res.body.xray.session).toMatchObject({ id: 'sess-1', status: 'SUBMITTED' });
    expect(res.body.xray.candidate).toMatchObject({ id: 'cand-1', name: 'Ada Candidate' });
    expect(res.body.xray.questions).toHaveLength(1);
    expect(res.body.xray.questions[0].evaluation).toMatchObject({ verdict: 'CORRECT', score: 1, method: 'DETERMINISTIC', voided: false });
    expect(res.body.xray.questions[0].answer.content).toEqual({ a: 'LIKE', b: 'DISLIKE', c: 'LIKE' });
    expect(res.body.xray.signals).toEqual({ total: 3, byType: { TAB_SWITCH: 2, LARGE_PASTE: 1 } });
    expect(res.body.xray.assessment.totalScore).toBe(0.5);
    expect(res.body.xray.assessment.flagSummary.collusion).toEqual([]);
  });

  it('shows nothing but session status before submission — the audit view opens when the candidate view closes', async () => {
    applicationFindUnique.mockResolvedValue(
      applicationRow({ testSession: { id: 'sess-1', status: 'STARTED', startedAt: now, submittedAt: null, deadlineAt: now } }),
    );
    const res = await request(app).get('/api/applications/app-1/xray').set(auth);

    expect(res.status).toBe(200);
    expect(res.body.xray.available).toBe(false);
    expect(res.body.xray.questions).toEqual([]);
    expect(res.body.xray.assessment).toBeNull();
    expect(res.body.xray.session.status).toBe('STARTED');
  });

  it('answers gracefully when the application has no test session at all', async () => {
    applicationFindUnique.mockResolvedValue(applicationRow({ testSession: null }));
    const res = await request(app).get('/api/applications/app-1/xray').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.xray.session).toBeNull();
    expect(res.body.xray.available).toBe(false);
  });
});

// ─── Void route: ADMIN-only + renormalization ─────────────────────────────────

describe('POST /api/applications/admin/items/:itemId/void', () => {
  beforeEach(() => {
    primeRunEvaluation();
    // Item 'item-swipe' appears in sess-1; sess-1 has two evaluations:
    // item-swipe (1.0, about to be voided) and item-mcq (0.5, survives).
    savedEvaluations.value = [
      { sessionQuestionId: 'sq-1', sessionItemId: 'item-swipe', score: 1.0, verdict: 'CORRECT', aiLikelihood: 'LOW', voided: false },
      { sessionQuestionId: 'sq-2', sessionItemId: 'item-mcq', score: 0.5, verdict: 'PARTIAL', aiLikelihood: 'LOW', voided: false },
    ];
    sessionQuestionFindFirst.mockResolvedValue({ session: { jobId: 'job-1', job: { companyId: 'company-1' } } });
    sessionQuestionFindMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      const where = args?.where ?? {};
      if (typeof where.sessionId === 'string') return SESSION_QUESTIONS;
      if (where.itemId && typeof where.itemId === 'object') return [];
      return [{ sessionId: 'sess-1' }]; // void-affected sessions
    });
    evaluationUpdateMany.mockImplementation(async ({ where }: { where: { sessionQuestion: { itemId: string } } }) => {
      const id = where.sessionQuestion.itemId;
      const hits = savedEvaluations.value.filter((e) => e.sessionItemId === id && e.voided !== true);
      for (const row of hits) row.voided = true;
      return { count: hits.length };
    });
    evaluationFindMany.mockImplementation(async () =>
      savedEvaluations.value.filter((e) => e.voided !== true).map((e) => ({ score: e.score })),
    );
  });

  it('403s for a non-admin (route-level ADMIN enforcement)', async () => {
    mockUser.value = { ...mockUser.value, role: 'RECRUITER' };
    const res = await request(app)
      .post('/api/applications/admin/items/item-swipe/void')
      .set(auth)
      .send({ reason: 'flawed item — ambiguous options' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(voidedItemUpsert).not.toHaveBeenCalled();
    expect(evaluationUpdateMany).not.toHaveBeenCalled();
  });

  it('voids the item across sessions and re-normalizes the mean over surviving questions (PLAN §5.2 #7)', async () => {
    mockUser.value = { ...mockUser.value, role: 'ADMIN' };
    const res = await request(app)
      .post('/api/applications/admin/items/item-swipe/void')
      .set(auth)
      .send({ reason: 'flawed item — ambiguous options' });

    expect(res.status).toBe(200);
    expect(res.body.void).toMatchObject({ itemId: 'item-swipe', jobId: 'job-1', evaluationsVoided: 1, sessionsRenormalized: 1 });

    // The void ledger row: who, why, which job.
    expect(voidedItemUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { itemId: 'item-swipe' },
        create: { itemId: 'item-swipe', jobId: 'job-1', reason: 'flawed item — ambiguous options', voidedBy: 'user-1' },
      }),
    );

    // Every evaluation of the item is marked voided.
    expect(evaluationUpdateMany).toHaveBeenCalledWith({
      where: { sessionQuestion: { itemId: 'item-swipe' } },
      data: { voided: true },
    });

    // Renormalized: mean over the SURVIVING evaluation only (0.5, not 0.75).
    // Two upserts are expected post-QA-wave-8: the immediate in-transaction
    // mean, then the full rollup refresh (F3) — both must carry 0.5.
    expect(sessionAssessmentUpsert.mock.calls.length).toBeGreaterThanOrEqual(1);
    for (const call of sessionAssessmentUpsert.mock.calls) {
      const arg = call[0] as { where: { sessionId: string }; create: { totalScore: number }; update: { totalScore: number } };
      expect(arg.where.sessionId).toBe('sess-1');
      expect(arg.create.totalScore).toBeCloseTo(0.5);
      expect(arg.update.totalScore).toBeCloseTo(0.5);
    }
  });

  it('404s for an item that appeared in no session', async () => {
    mockUser.value = { ...mockUser.value, role: 'ADMIN' };
    sessionQuestionFindFirst.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/applications/admin/items/item-ghost/void')
      .set(auth)
      .send({ reason: 'never appeared anywhere' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('400s without a meaningful reason (fair-hiring policy)', async () => {
    mockUser.value = { ...mockUser.value, role: 'ADMIN' };
    const res = await request(app)
      .post('/api/applications/admin/items/item-swipe/void')
      .set(auth)
      .send({ reason: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(voidedItemUpsert).not.toHaveBeenCalled();
  });
});

// ─── runEvaluation (worker): deterministic happy path, idempotency, collusion ──

describe('runEvaluation — swipe+mcq happy path (no LLM configured)', () => {
  beforeEach(() => primeRunEvaluation());

  it('decrypts the active pool, upserts DETERMINISTIC evaluations, writes the mean assessment', async () => {
    await runEvaluation('sess-1');

    // Pool probe: active pool for THIS job, scalars only (no relations).
    expect(poolFindFirst).toHaveBeenCalledTimes(1);
    const poolArg = poolFindFirst.mock.calls[0]![0] as { where: Record<string, unknown>; select: Record<string, boolean> };
    expect(poolArg.where).toEqual({ jobId: 'job-1', isActive: true });
    expect(Object.keys(poolArg.select)).toEqual(['itemsEncrypted']);

    // No provider was configured → the adapter probe failed closed, no LLM call.
    // TENANCY NEVER-REGRESS (V2-2 / D20): the probe MUST be scoped to the
    // session's company — an unscoped or wrongly-scoped where here is exactly
    // how one tenant's provider would grade another tenant's candidates.
    expect(llmProviderFindFirst).toHaveBeenCalledTimes(1);
    const providerArg = llmProviderFindFirst.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      orderBy: Record<string, string>;
    };
    expect(providerArg.where).toEqual({ companyId: 'company-1', isActive: true });
    expect(providerArg.orderBy).toEqual({ createdAt: 'asc' });

    // Two evaluations, both DETERMINISTIC, truth data from the decrypted pool.
    expect(evaluationUpsert).toHaveBeenCalledTimes(2);
    const swipeArg = evaluationUpsert.mock.calls[0]![0] as { where: { sessionQuestionId: string }; create: Record<string, unknown> };
    expect(swipeArg.where.sessionQuestionId).toBe('sq-1');
    expect(swipeArg.create).toMatchObject({ verdict: 'CORRECT', score: 1, method: 'DETERMINISTIC', aiLikelihood: 'LOW' });
    expect((swipeArg.create.detail as { hits: Array<{ correct: boolean }> }).hits.every((h) => h.correct)).toBe(true);

    const mcqArg = evaluationUpsert.mock.calls[1]![0] as { where: { sessionQuestionId: string }; create: Record<string, unknown> };
    expect(mcqArg.where.sessionQuestionId).toBe('sq-2');
    expect(mcqArg.create).toMatchObject({ verdict: 'INCORRECT', score: 0, method: 'DETERMINISTIC', aiLikelihood: 'LOW' });
    expect(mcqArg.create.detail).toEqual({ selectedOptionId: 'b', correctOptionId: 'a' });

    // Assessment: mean of (1, 0) over 2 scored items, deterministic rollup.
    expect(sessionAssessmentUpsert).toHaveBeenCalledTimes(1);
    const assessment = sessionAssessmentUpsert.mock.calls[0]![0] as { where: { sessionId: string }; create: Record<string, unknown> };
    expect(assessment.where.sessionId).toBe('sess-1');
    expect(assessment.create.totalScore).toBeCloseTo(0.5);
    expect(assessment.create.strengths).toBe('linux (1/1)');
    expect(assessment.create.gaps).toBe('http (0/1)');
    expect(assessment.create.recommendation).toContain('humans'); // advisory, never a decision
    expect(assessment.create.flagSummary).toMatchObject({ aiHigh: 0, aiMedium: 0, collusion: [] });
    expect((assessment.create.flagSummary as { signals: Record<string, number> }).signals).toEqual({ TAB_SWITCH: 2, LARGE_PASTE: 1 });

    // FLAG, NEVER AUTO-REJECT (never-regress #1): the evaluation job never
    // touches the application row — no status change from an AI verdict.
    expect(applicationUpdate).not.toHaveBeenCalled();
  });

  it('is idempotent: a second run skips every existing evaluation (upsert count unchanged)', async () => {
    await runEvaluation('sess-1');
    expect(evaluationUpsert).toHaveBeenCalledTimes(2);
    expect(sessionAssessmentUpsert).toHaveBeenCalledTimes(1);

    await runEvaluation('sess-1');
    expect(evaluationUpsert).toHaveBeenCalledTimes(2); // nothing re-scored
    expect(sessionAssessmentUpsert).toHaveBeenCalledTimes(2); // rollup recomputed, same value
    const assessment = sessionAssessmentUpsert.mock.calls[1]![0] as { create: { totalScore: number } };
    expect(assessment.create.totalScore).toBeCloseTo(0.5);
  });

  it('skips questions whose item is voided across sessions, and the mean excludes them', async () => {
    voidedItemFindMany.mockResolvedValue([{ itemId: 'item-swipe' }]); // the swipe item is voided
    // Per-question re-check (QA wave-8 F2) must agree with the snapshot.
    voidedItemFindUnique.mockImplementation(async ({ where }: { where: { itemId: string } }) =>
      where.itemId === 'item-swipe' ? { itemId: 'item-swipe' } : null,
    );
    await runEvaluation('sess-1');

    expect(evaluationUpsert).toHaveBeenCalledTimes(1); // only the MCQ row
    expect((evaluationUpsert.mock.calls[0]![0] as { where: { sessionQuestionId: string } }).where.sessionQuestionId).toBe('sq-2');
    const assessment = sessionAssessmentUpsert.mock.calls[0]![0] as { create: { totalScore: number } };
    expect(assessment.create.totalScore).toBeCloseTo(0); // mean over the surviving (wrong) MCQ only
  });

  it('refuses to evaluate a session that is not SUBMITTED', async () => {
    testSessionFindUnique.mockResolvedValue({ id: 'sess-1', jobId: 'job-1', status: 'STARTED', job: { companyId: 'company-1' } });
    await expect(runEvaluation('sess-1')).rejects.toMatchObject({ statusCode: 409, code: 'SESSION_NOT_SUBMITTED' });
    expect(evaluationUpsert).not.toHaveBeenCalled();
  });

  it('retries later instead of zero-scoring when no active pool exists (mid-reseal)', async () => {
    poolFindFirst.mockResolvedValue(null);
    await expect(runEvaluation('sess-1')).rejects.toMatchObject({ statusCode: 503, code: 'POOL_UNAVAILABLE' });
    expect(evaluationUpsert).not.toHaveBeenCalled();
  });

  it('excludes pool-drifted items from scoring instead of penalizing them (fairness)', async () => {
    // Active pool no longer contains the swipe item (re-sealed after the draw).
    poolFindFirst.mockResolvedValue({
      itemsEncrypted: encryptSecret(JSON.stringify(POOL_ITEMS.filter((i) => i.id !== 'item-swipe'))),
    });
    await runEvaluation('sess-1');

    expect(evaluationUpsert).toHaveBeenCalledTimes(1); // MCQ only
    const assessment = sessionAssessmentUpsert.mock.calls[0]![0] as { create: Record<string, unknown> };
    expect((assessment.create.flagSummary as { unscoredItemIds: string[] }).unscoredItemIds).toEqual(['item-swipe']);
    expect(assessment.create.totalScore).toBeCloseTo(0);
  });
});

// ─── runEvaluation: collusion v1 (identical written answers across sessions) ──

describe('runEvaluation — collusion flag (exact-match, flag only)', () => {
  beforeEach(() => {
    primeRunEvaluation();
    const writtenQuestions = [
      {
        id: 'sq-w',
        order: 1,
        format: 'WRITTEN',
        itemId: 'item-written',
        answer: swipeAnswerRow({ text: 'Measure first, then isolate the database.' }),
      },
    ];
    sessionQuestionFindMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      const where = args?.where ?? {};
      if (typeof where.sessionId === 'string') return writtenQuestions;
      if (where.itemId && typeof where.itemId === 'object') {
        // Same-job SUBMITTED session with the byte-identical answer (the pair).
        return [
          {
            itemId: 'item-written',
            sessionId: 'sess-2',
            answer: { content: { text: 'Measure first, then isolate the database.' } },
          },
        ];
      }
      return [];
    });
  });

  it('flags — and only flags — byte-identical written answers across sessions', async () => {
    await runEvaluation('sess-1');

    // The collusion probe ran against the same job's submitted sessions.
    const probe = sessionQuestionFindMany.mock.calls.find(
      (call) => call[0].where.itemId && typeof call[0].where.itemId === 'object',
    ) as unknown as [{ where: { itemId: { in: string[] }; sessionId: { not: string }; session: { jobId: string; status: string } } }];
    expect(probe[0].where.itemId.in).toEqual(['item-written']);
    expect(probe[0].where.sessionId.not).toBe('sess-1');
    expect(probe[0].where.session).toEqual({ jobId: 'job-1', status: 'SUBMITTED' });

    // No provider → the written answer itself is fairly skipped, not zeroed.
    expect(evaluationUpsert).not.toHaveBeenCalled();

    const assessment = sessionAssessmentUpsert.mock.calls[0]![0] as { create: Record<string, unknown> };
    const flags = assessment.create.flagSummary as { collusion: string[]; unscoredItemIds?: string[] };
    expect(flags.collusion).toEqual(['sess-2']);
    expect(flags.unscoredItemIds).toEqual(['item-written']);
    expect(assessment.create.recommendation).toContain('collusion');
    // FLAG, NEVER AUTO-REJECT: nothing but the assessment row was written.
    expect(applicationUpdate).not.toHaveBeenCalled();
  });

  it('raises no collusion flag when no other session shares the answer', async () => {
    sessionQuestionFindMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      const where = args?.where ?? {};
      if (typeof where.sessionId === 'string') {
        return [
          {
            id: 'sq-w',
            order: 1,
            format: 'WRITTEN',
            itemId: 'item-written',
            answer: swipeAnswerRow({ text: 'An original answer.' }),
          },
        ];
      }
      return []; // no other sessions answered this item
    });

    await runEvaluation('sess-1');
    const assessment = sessionAssessmentUpsert.mock.calls[0]![0] as { create: Record<string, unknown> };
    expect((assessment.create.flagSummary as { collusion: string[] }).collusion).toEqual([]);
    expect(assessment.create.recommendation).not.toContain('collusion');
  });
});

// ─── runEvaluation: CODE format via the sandbox path (wave-8 QA F7 owed test) ──
//
// runEvaluation builds its executor lazily with a hardcoded
// createExecutor('docker') — the service (not editable here) has no injection
// seam for it. So this describe — the LAST in the file — re-imports the
// service under vi.doMock of '../src/lib/sandbox', swapping createExecutor for
// a FakeExecutor. The file-level prisma vi.mock registry survives
// vi.resetModules, so the re-imported service runs against the same shared
// mock fns primed above; existing tests are untouched (the executor is lazy
// and no earlier fixture is CODE format).
describe('runEvaluation — CODE format (sandbox path, no LLM configured)', () => {
  it('executes code against hidden cases, writes the ExecutionResult, and scores SANDBOX with a skipped-LLM note', async () => {
    primeRunEvaluation();

    // One submitted CODE answer; the pool carries its item in a real crypto box.
    const codeItem: AssessmentItem = {
      id: 'item-code',
      format: 'CODE',
      prompt: 'Print the sum of two integers given as argv arguments.',
      language: 'NODE',
      hiddenCases: [
        { name: 'basic', args: ['2', '3'], expectedStdout: '5' },
        { name: 'negative', args: ['-1', '1'], expectedStdout: '0' },
        { name: 'large', args: ['1000000', '1'], expectedStdout: '1000001' },
      ],
      difficulty: 'MEDIUM',
      topics: ['node'],
    };
    poolFindFirst.mockResolvedValue({ itemsEncrypted: encryptSecret(JSON.stringify([codeItem])) });
    sessionQuestionFindMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      const where = args?.where ?? {};
      if (typeof where.sessionId === 'string') {
        return [
          {
            id: 'sq-c',
            order: 1,
            format: 'CODE',
            itemId: 'item-code',
            answer: swipeAnswerRow({ text: 'console.log(Number(process.argv[2]) + Number(process.argv[3]))' }),
          },
        ];
      }
      if (where.itemId && typeof where.itemId === 'object') return []; // collusion probe
      return [];
    });

    // The fake sandbox answers the service's production executor request:
    // 2 of the 3 hidden cases pass.
    const createExecutorArgs: unknown[][] = [];
    vi.resetModules();
    vi.doMock('../src/lib/sandbox', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/lib/sandbox')>();
      return {
        ...actual,
        createExecutor: (...args: unknown[]) => {
          createExecutorArgs.push(args);
          return new actual.FakeExecutor(() => ({
            outcomes: [
              { name: 'basic', passed: true },
              { name: 'negative', passed: true },
              { name: 'large', passed: false, expectedStdoutExcerpt: '1000001', actualStdoutExcerpt: 'NaN' },
            ],
            allPassed: false,
            stdout: '5\n0\n',
            stderr: '',
            exitCode: 0,
            durationMs: 12,
            truncated: false,
          }));
        },
      };
    });
    const { runEvaluation: runEvaluationWithFakeSandbox } = await import('../src/modules/applications/evaluation.service');

    await runEvaluationWithFakeSandbox('sess-1');

    // The service asked for its production executor kind exactly once (lazy:
    // one CODE question → one executor); the fake answered it.
    expect(createExecutorArgs).toEqual([['docker']]);

    // ExecutionResult written verbatim from the sandbox response.
    expect(executionResultUpsert).toHaveBeenCalledTimes(1);
    const execArg = executionResultUpsert.mock.calls[0]![0] as {
      where: { sessionQuestionId: string };
      create: Record<string, unknown>;
    };
    expect(execArg.where.sessionQuestionId).toBe('sq-c');
    expect(execArg.create).toMatchObject({ exitCode: 0, durationMs: 12, truncated: false, stdout: '5\n0\n', stderr: '' });
    expect(execArg.create.caseResults).toHaveLength(3);

    // Evaluation: deterministic sandbox score (2/3 → PARTIAL), LLM review
    // explicitly skipped, aiLikelihood stays LOW (no evidence — never guessed).
    expect(evaluationUpsert).toHaveBeenCalledTimes(1);
    const evalArg = evaluationUpsert.mock.calls[0]![0] as { create: Record<string, unknown> };
    expect(evalArg.create).toMatchObject({ verdict: 'PARTIAL', method: 'SANDBOX', aiLikelihood: 'LOW' });
    expect(evalArg.create.score).toBeCloseTo(2 / 3);
    const detail = evalArg.create.detail as { note?: string; passed: number; total: number };
    expect(detail.passed).toBe(2);
    expect(detail.total).toBe(3);
    expect(detail.note).toContain('no active provider');
    expect(evalArg.create.qualityNotes).toBeUndefined();

    // Rollup includes the sandbox score; FLAG, NEVER AUTO-REJECT.
    const assessment = sessionAssessmentUpsert.mock.calls[0]![0] as { create: Record<string, unknown> };
    expect(assessment.create.totalScore).toBeCloseTo(2 / 3);
    expect(assessment.create.gaps).toBe('node (0/1)'); // PARTIAL is not CORRECT
    expect(assessment.create.recommendation).toContain('humans');
    expect(applicationUpdate).not.toHaveBeenCalled();

    // Hygiene: restore the module registry (nothing runs after this file's
    // last describe, but leave the world as we found it).
    vi.doUnmock('../src/lib/sandbox');
    vi.resetModules();
  });
});
