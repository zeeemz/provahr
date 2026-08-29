// Candidate session routes over HTTP (PLAN.md Phase 5, §9): start (draw +
// variants + clock), view, answer upserts, signals, submit. Mock house style
// from apply-mint.test.ts — the prisma module is mocked model-by-model; NO
// $transaction is needed (the service never opens one). The start path runs
// the REAL crypto round-trip: the mock pool row carries itemsEncrypted =
// encryptSecret(JSON.stringify(fixture pool)) and tests/setup.ts leaves
// SECRETS_KEY unset so crypto falls back to the env default.
//
// Ordering note: these routes share one 60/min per-IP session bucket, so this
// file keeps its total request count well under the limit — except the final
// limiter test, which deliberately trips it (and therefore runs LAST).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { encryptSecret } from '../src/lib/crypto';
import { assessmentItemSchema, newItemId, type AssessmentItem } from '../src/lib/assessment/item';

const {
  testSessionFindUnique,
  testSessionUpdate,
  sessionQuestionCreateMany,
  sessionQuestionFindMany,
  sessionQuestionFindFirst,
  answerUpsert,
  signalCount,
  signalCreateMany,
  jobQueueCreate,
  poolFindFirst,
} = vi.hoisted(() => ({
  testSessionFindUnique: vi.fn(),
  testSessionUpdate: vi.fn(),
  sessionQuestionCreateMany: vi.fn(),
  sessionQuestionFindMany: vi.fn(),
  sessionQuestionFindFirst: vi.fn(),
  answerUpsert: vi.fn(),
  signalCount: vi.fn(),
  signalCreateMany: vi.fn(),
  jobQueueCreate: vi.fn().mockResolvedValue({ id: 'q-1' }),
  poolFindFirst: vi.fn(),
}));

vi.mock('../src/prisma', () => ({
  prisma: {
    testSession: { findUnique: testSessionFindUnique, update: testSessionUpdate },
    sessionQuestion: { createMany: sessionQuestionCreateMany, findMany: sessionQuestionFindMany, findFirst: sessionQuestionFindFirst },
    answer: { upsert: answerUpsert },
    sessionSignal: { count: signalCount, createMany: signalCreateMany },
    sealedQuestionPool: { findFirst: poolFindFirst },
    // Submit wires the evaluation worker (QA wave-8 F1).
    jobQueue: { create: jobQueueCreate },
    // Array form (start writes questions + status flip atomically — QA
    // wave-6 F2): await all promises; the interactive form is unused here.
    $transaction: (arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : (arg as () => Promise<unknown>)()),
  },
}));

import { createApp } from '../src/app';

const app = createApp();

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TOKEN = 'AbCdEf1234567890_-AbCdEf1234567890_-AbCdEf1'; // valid shape (43 chars)
expect(TOKEN).toHaveLength(43);

/** 12 schema-valid MCQ items = exactly 6x the draw size of { MCQ: 2 }. */
const POOL_ITEMS: AssessmentItem[] = Array.from({ length: 12 }, () =>
  assessmentItemSchema.parse({
    id: newItemId(),
    format: 'MCQ',
    prompt: 'Which HTTP status should a well-formed idempotent replay return?',
    options: [
      { id: 'a', text: '200 with the original result body' },
      { id: 'b', text: '409 Conflict' },
      { id: 'c', text: '500 Internal Server Error' },
    ],
    correctOptionId: 'a',
    difficulty: 'EASY',
    topics: ['api-design'],
  }) as AssessmentItem,
);
const POOL_IDS = new Set(POOL_ITEMS.map((i) => i.id));

/** Real AES-256-GCM box — startSession must decrypt it for the draw. */
const ENCRYPTED_POOL = encryptSecret(JSON.stringify(POOL_ITEMS));

const BLUEPRINT = {
  sections: [{ topics: ['api-design'], formats: { MCQ: 2 } }],
  timeLimitMin: 30,
};

/** A session row shaped exactly like the service's select. */
function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    jobId: 'job-1',
    status: 'ISSUED',
    expiresAt: new Date(Date.now() + 86_400_000),
    startedAt: null,
    deadlineAt: null,
    job: { blueprint: BLUEPRINT },
    ...overrides,
  };
}

function startedRow(overrides: Record<string, unknown> = {}) {
  return sessionRow({
    status: 'STARTED',
    startedAt: new Date(Date.now() - 60_000),
    deadlineAt: new Date(Date.now() + 29 * 60_000),
    ...overrides,
  });
}

const PRESENTED_MCQ = {
  prompt: 'Which HTTP status should a well-formed idempotent replay return?',
  options: [
    { id: 'a', text: '200 with the original result body' },
    { id: 'b', text: '409 Conflict' },
    { id: 'c', text: '500 Internal Server Error' },
  ],
};

function primeSession(row: Record<string, unknown>) {
  vi.clearAllMocks();
  testSessionFindUnique.mockResolvedValue(row);
  testSessionUpdate.mockResolvedValue({});
  sessionQuestionCreateMany.mockResolvedValue({ count: 0 });
  sessionQuestionFindMany.mockResolvedValue([]);
  sessionQuestionFindFirst.mockResolvedValue(null);
  answerUpsert.mockResolvedValue({});
  signalCount.mockResolvedValue(0);
  signalCreateMany.mockResolvedValue({ count: 0 });
  poolFindFirst.mockResolvedValue({ id: 'pool-1', itemsEncrypted: ENCRYPTED_POOL });
}

// ─── Uniform 404 (no token oracle — same discipline as GET /test/:token) ──────

describe('unknown/invalid token — uniform 404 on every session endpoint', () => {
  function call(method: 'post' | 'get', url: string): request.Test {
    const req = method === 'post' ? request(app).post(url) : request(app).get(url);
    // Identically WELL-FORMED requests everywhere: body validation runs before
    // the token lookup (same order as the apply route), so the no-oracle
    // property is "same request shape ⇒ same 404 body" — a malformed body
    // 400s for valid and unknown tokens alike, revealing nothing.
    if (url.endsWith('/answers')) return req.send({ order: 1, content: { optionId: 'a' } });
    if (url.endsWith('/signals')) return req.send({ signals: [{ type: 'COPY', at: '2026-01-01T10:00:00.000Z' }] });
    return req;
  }

  const SESSION_PATHS: Array<['post' | 'get', string]> = [
    ['post', '/start'],
    ['get', '/session'],
    ['post', '/answers'],
    ['post', '/signals'],
    ['post', '/submit'],
  ];

  it('answers every endpoint with the identical 404 body', async () => {
    primeSession(sessionRow());
    testSessionFindUnique.mockResolvedValue(null);
    const bodies: string[] = [];
    for (const [method, suffix] of SESSION_PATHS) {
      const res = await call(method, `/api/public/test/${TOKEN}${suffix}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      bodies.push(JSON.stringify(res.body));
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it('rejects a badly-shaped token before any DB lookup, with the same 404', async () => {
    primeSession(sessionRow());
    const res = await request(app).get('/api/public/test/short-token/session');
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: 'NOT_FOUND', message: 'Test link not found' });
    expect(testSessionFindUnique).not.toHaveBeenCalled();
  });

  it('looks the token up BY HASH — never the plain value', async () => {
    primeSession(sessionRow());
    testSessionFindUnique.mockResolvedValue(null);
    await request(app).post(`/api/public/test/${TOKEN}/start`);
    const arg = testSessionFindUnique.mock.calls[0]![0] as { where: { tokenHash: string } };
    expect(arg.where.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(arg.where.tokenHash).not.toBe(TOKEN);
  });
});

// ─── POST /start ──────────────────────────────────────────────────────────────

describe('POST /test/:token/start — fresh start (draw + variants + clock)', () => {
  it('decrypts the active pool, draws the blueprint size, realizes variants → 201', async () => {
    primeSession(sessionRow());

    const before = Date.now();
    const res = await request(app).post(`/api/public/test/${TOKEN}/start`);
    const after = Date.now();

    expect(res.status).toBe(201);
    // Candidate view: ordered questions + empty answers + clock meta. Never
    // items, never truth, never the pool.
    expect(res.body.answers).toEqual({});
    expect(res.body.meta).toMatchObject({ timeLimitMin: 30, total: 2 });
    const deadlineMs = new Date(res.body.meta.deadlineAt).getTime();
    expect(deadlineMs).toBeGreaterThanOrEqual(before + 30 * 60_000);
    expect(deadlineMs).toBeLessThanOrEqual(after + 30 * 60_000);

    expect(res.body.questions).toHaveLength(2);
    expect(res.body.questions.map((q: { order: number }) => q.order)).toEqual([1, 2]);
    for (const q of res.body.questions) {
      expect(q.format).toBe('MCQ');
      expect(Object.keys(q.presented).sort()).toEqual(['options', 'prompt']);
      expect(new Set(q.presented.options.map((o: { id: string }) => o.id))).toEqual(new Set(['a', 'b', 'c']));
    }
    // Deep scan: no truth channel anywhere in the response.
    expect(JSON.stringify(res.body)).not.toMatch(/truth|correctOptionId|rubric|hiddenCases/);
    expect(JSON.stringify(res.body)).not.toContain('itemId');

    // Pool probe: active pool for THIS job, scalars only.
    const poolArg = poolFindFirst.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
    };
    expect(poolArg.where).toEqual({ jobId: 'job-1', isActive: true });
    expect(poolArg.select).toEqual({ id: true, itemsEncrypted: true });

    // Session flipped to STARTED with startedAt + deadlineAt exactly 30min apart.
    expect(testSessionUpdate).toHaveBeenCalledTimes(1);
    const upd = testSessionUpdate.mock.calls[0]![0] as {
      where: { id: string };
      data: { status: string; startedAt: Date; deadlineAt: Date };
    };
    expect(upd.where).toEqual({ id: 'sess-1' });
    expect(upd.data.status).toBe('STARTED');
    expect(upd.data.deadlineAt.getTime() - upd.data.startedAt.getTime()).toBe(30 * 60_000);

    // The draw was persisted: 2 rows, pool item ids, variant-realized presented.
    expect(sessionQuestionCreateMany).toHaveBeenCalledTimes(1);
    const rows = (sessionQuestionCreateMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> }).data;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.order)).toEqual([1, 2]);
    for (const row of rows) {
      expect(POOL_IDS.has(row.itemId as string)).toBe(true);
      expect(new Set(((row.presented as { options: Array<{ id: string }> }).options).map((o) => o.id))).toEqual(
        new Set(['a', 'b', 'c']),
      );
    }
  });

  it('re-entry on a live STARTED session → 200, same view, saved answers restored, NO decrypt', async () => {
    primeSession(startedRow());
    sessionQuestionFindMany.mockResolvedValue([
      { order: 1, format: 'MCQ', presented: PRESENTED_MCQ, answer: { content: { optionId: 'b' } } },
      { order: 2, format: 'MCQ', presented: PRESENTED_MCQ, answer: null },
    ]);

    const res = await request(app).post(`/api/public/test/${TOKEN}/start`);

    expect(res.status).toBe(200); // not 201 — idempotent re-entry
    expect(res.body.questions).toHaveLength(2);
    expect(res.body.answers).toEqual({ '1': { optionId: 'b' } });
    expect(res.body.meta.total).toBe(2);
    expect(res.body.meta.timeLimitMin).toBe(30);
    // The pool is decrypted on fresh starts ONLY — re-entry re-reads the draw.
    expect(poolFindFirst).not.toHaveBeenCalled();
    expect(sessionQuestionCreateMany).not.toHaveBeenCalled();
    expect(testSessionUpdate).not.toHaveBeenCalled();
  });

  it('409 SESSION_SUBMITTED on an already-submitted test', async () => {
    primeSession(startedRow({ status: 'SUBMITTED', submittedAt: new Date() }));
    const res = await request(app).post(`/api/public/test/${TOKEN}/start`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SESSION_SUBMITTED');
    expect(poolFindFirst).not.toHaveBeenCalled();
  });

  it('410 TEST_LINK_EXPIRED on an expired ISSUED link — lazily flipped to EXPIRED', async () => {
    primeSession(sessionRow({ expiresAt: new Date(Date.now() - 1000) }));
    const res = await request(app).post(`/api/public/test/${TOKEN}/start`);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('TEST_LINK_EXPIRED');
    expect(testSessionUpdate).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      data: { status: 'EXPIRED' },
    });
    expect(poolFindFirst).not.toHaveBeenCalled();
  });

  it('409 POOL_INACTIVE when the job has no active pool (fail closed)', async () => {
    primeSession(sessionRow());
    poolFindFirst.mockResolvedValue(null);
    const res = await request(app).post(`/api/public/test/${TOKEN}/start`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('POOL_INACTIVE');
    expect(sessionQuestionCreateMany).not.toHaveBeenCalled();
    expect(testSessionUpdate).not.toHaveBeenCalled();
  });

  it('409 SESSION_EXPIRED on re-entry past the deadline (the clock never pauses)', async () => {
    primeSession(startedRow({ deadlineAt: new Date(Date.now() - 1000) }));
    const res = await request(app).post(`/api/public/test/${TOKEN}/start`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
    expect(sessionQuestionFindMany).not.toHaveBeenCalled();
  });
});

// ─── GET /session ─────────────────────────────────────────────────────────────

describe('GET /test/:token/session — re-entry view', () => {
  it('returns questions in order + saved answers + meta for a live STARTED session', async () => {
    primeSession(startedRow());
    sessionQuestionFindMany.mockResolvedValue([
      { order: 1, format: 'MCQ', presented: PRESENTED_MCQ, answer: { content: { optionId: 'a' } } },
      { order: 2, format: 'MCQ', presented: PRESENTED_MCQ, answer: null },
    ]);

    const res = await request(app).get(`/api/public/test/${TOKEN}/session`);

    expect(res.status).toBe(200);
    expect(res.body.questions.map((q: { order: number }) => q.order)).toEqual([1, 2]);
    expect(res.body.answers).toEqual({ '1': { optionId: 'a' } });
    expect(new Date(res.body.meta.deadlineAt).getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(res.body)).not.toMatch(/truth|correctOptionId|rubric|hiddenCases/);
  });

  it('409 SESSION_NOT_STARTED before the test is started', async () => {
    primeSession(sessionRow());
    const res = await request(app).get(`/api/public/test/${TOKEN}/session`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SESSION_NOT_STARTED');
  });
});

// ─── POST /answers ────────────────────────────────────────────────────────────

describe('POST /test/:token/answers — upserts + validation', () => {
  function primeQuestion(format: string, presented: unknown, id = 'sq-1') {
    sessionQuestionFindFirst.mockResolvedValue({ id, format, presented });
  }

  it('saves a valid MCQ answer → exactly { saved: true }', async () => {
    primeSession(startedRow());
    primeQuestion('MCQ', PRESENTED_MCQ);

    const res = await request(app)
      .post(`/api/public/test/${TOKEN}/answers`)
      .send({ order: 1, content: { optionId: 'a' } });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['saved']);
    expect(res.body.saved).toBe(true);
    expect(answerUpsert).toHaveBeenCalledTimes(1);
    const arg = answerUpsert.mock.calls[0]![0] as {
      where: { sessionQuestionId: string };
      create: { content: unknown; firstAnsweredAt: Date };
      update: { content: unknown; revisions: { increment: number }; lastAnsweredAt: Date };
    };
    expect(arg.where).toEqual({ sessionQuestionId: 'sq-1' });
    expect(arg.create.content).toEqual({ optionId: 'a' });
    expect(arg.update.revisions).toEqual({ increment: 1 }); // review-pass revisions count
  });

  it('saves a partial SWIPE_MCQ valuation (subset of options)', async () => {
    primeSession(startedRow());
    primeQuestion('SWIPE_MCQ', {
      prompt: 'Which claims are true?',
      options: [{ id: 'a', text: 'One.' }, { id: 'b', text: 'Two.' }, { id: 'c', text: 'Three.' }],
    });

    const res = await request(app)
      .post(`/api/public/test/${TOKEN}/answers`)
      .send({ order: 1, content: { a: 'LIKE', c: 'DISLIKE' } });

    expect(res.status).toBe(200);
    const arg = answerUpsert.mock.calls[0]![0] as { create: { content: unknown } };
    expect(arg.create.content).toEqual({ a: 'LIKE', c: 'DISLIKE' });
  });

  it('saves a WRITTEN text answer at the 10k boundary, rejects 10k+1', async () => {
    primeSession(startedRow());
    primeQuestion('WRITTEN', { prompt: 'Explain.' });

    const ok = await request(app)
      .post(`/api/public/test/${TOKEN}/answers`)
      .send({ order: 1, content: { text: 'x'.repeat(10_000) } });
    expect(ok.status).toBe(200);

    const bad = await request(app)
      .post(`/api/public/test/${TOKEN}/answers`)
      .send({ order: 1, content: { text: 'x'.repeat(10_001) } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_ANSWER');
  });

  it('rejects a SWIPE valuation that is not LIKE/DISLIKE', async () => {
    primeSession(startedRow());
    primeQuestion('SWIPE_MCQ', PRESENTED_MCQ);

    const res = await request(app)
      .post(`/api/public/test/${TOKEN}/answers`)
      .send({ order: 1, content: { a: 'MAYBE' } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ANSWER');
    expect(answerUpsert).not.toHaveBeenCalled();
  });

  it('rejects an MCQ optionId outside the presented options', async () => {
    primeSession(startedRow());
    primeQuestion('MCQ', PRESENTED_MCQ);

    const res = await request(app)
      .post(`/api/public/test/${TOKEN}/answers`)
      .send({ order: 1, content: { optionId: 'zz' } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ANSWER');
  });

  it('409 SESSION_EXPIRED for a late answer (no grace — the clock never pauses)', async () => {
    primeSession(startedRow({ deadlineAt: new Date(Date.now() - 1000) }));
    const res = await request(app)
      .post(`/api/public/test/${TOKEN}/answers`)
      .send({ order: 1, content: { optionId: 'a' } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
    expect(sessionQuestionFindFirst).not.toHaveBeenCalled();
    expect(answerUpsert).not.toHaveBeenCalled();
  });

  it('404 for an order that matches no question in this session', async () => {
    primeSession(startedRow());
    sessionQuestionFindFirst.mockResolvedValue(null);
    const res = await request(app)
      .post(`/api/public/test/${TOKEN}/answers`)
      .send({ order: 99, content: { optionId: 'a' } });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('409 SESSION_SUBMITTED after submission', async () => {
    primeSession(startedRow({ status: 'SUBMITTED' }));
    const res = await request(app)
      .post(`/api/public/test/${TOKEN}/answers`)
      .send({ order: 1, content: { optionId: 'a' } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SESSION_SUBMITTED');
  });

  it('400 VALIDATION_ERROR for a non-positive order (schema layer)', async () => {
    primeSession(startedRow());
    const res = await request(app)
      .post(`/api/public/test/${TOKEN}/answers`)
      .send({ order: 0, content: {} });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─── POST /signals ────────────────────────────────────────────────────────────

describe('POST /test/:token/signals — evidence, never status', () => {
  const batch = [
    { type: 'TAB_SWITCH', at: '2026-01-01T10:01:00.000Z' },
    { type: 'LARGE_PASTE', at: '2026-01-01T10:02:00.000Z', detail: { chars: 1200 } },
  ];

  it('bulk-inserts the batch → { recorded: n }; status untouched', async () => {
    primeSession(startedRow());
    signalCount.mockResolvedValue(0);

    const res = await request(app).post(`/api/public/test/${TOKEN}/signals`).send({ signals: batch });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recorded: 2 });
    expect(signalCreateMany).toHaveBeenCalledTimes(1);
    const rows = (signalCreateMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> }).data;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.type).toBe('TAB_SWITCH');
    expect(rows[1]!.type).toBe('LARGE_PASTE');
    expect(rows[1]!.detail).toEqual({ chars: 1200 });
    expect(rows[1]!.at).toEqual(new Date('2026-01-01T10:02:00.000Z'));
    // Signals NEVER change session status (flag, never auto-reject).
    expect(testSessionUpdate).not.toHaveBeenCalled();
  });

  it('caps stored signals at 500/session: drops excess and notes it in the last accepted detail', async () => {
    primeSession(startedRow());
    signalCount.mockResolvedValue(498);

    const res = await request(app)
      .post(`/api/public/test/${TOKEN}/signals`)
      .send({
        signals: [
          { type: 'COPY', at: '2026-01-01T10:01:00.000Z' },
          { type: 'BLUR', at: '2026-01-01T10:02:00.000Z' },
          { type: 'BLUR', at: '2026-01-01T10:03:00.000Z' },
          { type: 'BLUR', at: '2026-01-01T10:04:00.000Z' },
          { type: 'BLUR', at: '2026-01-01T10:05:00.000Z' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recorded: 2 });
    const rows = (signalCreateMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> }).data;
    expect(rows).toHaveLength(2);
    expect(rows[1]!.detail).toEqual({ droppedByCap: 3 });
  });

  it('records nothing when the session is already at the cap', async () => {
    primeSession(startedRow());
    signalCount.mockResolvedValue(500);

    const res = await request(app).post(`/api/public/test/${TOKEN}/signals`).send({ signals: batch });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recorded: 0 });
    expect(signalCreateMany).not.toHaveBeenCalled();
  });

  it('409 SESSION_SUBMITTED after submission', async () => {
    primeSession(startedRow({ status: 'SUBMITTED' }));
    const res = await request(app).post(`/api/public/test/${TOKEN}/signals`).send({ signals: batch });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SESSION_SUBMITTED');
  });

  it('400 for an unknown signal type, >100 signals, or a 6-key detail', async () => {
    primeSession(startedRow());
    const badType = await request(app)
      .post(`/api/public/test/${TOKEN}/signals`)
      .send({ signals: [{ type: 'WEBCAM', at: '2026-01-01T10:00:00Z' }] });
    expect(badType.status).toBe(400);
    expect(badType.body.error.code).toBe('VALIDATION_ERROR');

    const tooMany = await request(app)
      .post(`/api/public/test/${TOKEN}/signals`)
      .send({ signals: Array.from({ length: 101 }, (_, i) => ({ type: 'COPY', at: new Date(Date.now() + i).toISOString() })) });
    expect(tooMany.status).toBe(400);

    const fatDetail = await request(app)
      .post(`/api/public/test/${TOKEN}/signals`)
      .send({
        signals: [
          { type: 'COPY', at: '2026-01-01T10:00:00Z', detail: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 } },
        ],
      });
    expect(fatDetail.status).toBe(400);
  });
});

// ─── POST /submit ─────────────────────────────────────────────────────────────

describe('POST /test/:token/submit — the asymmetric end', () => {
  it('returns EXACTLY { submitted: true } — no score, no feedback, ever', async () => {
    primeSession(startedRow());

    const res = await request(app).post(`/api/public/test/${TOKEN}/submit`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ submitted: true }); // key-set assertion via toEqual
    expect(Object.keys(res.body)).toEqual(['submitted']);
    expect(testSessionUpdate).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      data: { status: 'SUBMITTED', submittedAt: expect.any(Date) },
    });
  });

  it('accepts a submit within the 60s auto-submit grace', async () => {
    primeSession(startedRow({ deadlineAt: new Date(Date.now() - 30_000) }));
    const res = await request(app).post(`/api/public/test/${TOKEN}/submit`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ submitted: true });
  });

  it('409 SESSION_EXPIRED past the grace window', async () => {
    primeSession(startedRow({ deadlineAt: new Date(Date.now() - 61_000) }));
    const res = await request(app).post(`/api/public/test/${TOKEN}/submit`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
    expect(testSessionUpdate).not.toHaveBeenCalled();
  });

  it('409 SESSION_NOT_STARTED on an un-started link; 409 SESSION_SUBMITTED on a double submit', async () => {
    primeSession(sessionRow());
    const notStarted = await request(app).post(`/api/public/test/${TOKEN}/submit`);
    expect(notStarted.status).toBe(409);
    expect(notStarted.body.error.code).toBe('SESSION_NOT_STARTED');

    primeSession(startedRow({ status: 'SUBMITTED' }));
    const twice = await request(app).post(`/api/public/test/${TOKEN}/submit`);
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('SESSION_SUBMITTED');
  });
});

// ─── Shared session limiter (LAST — it exhausts this file's IP bucket) ────────

describe('session endpoints rate limit (shared bucket, 60/min per IP)', () => {
  it('trips to 429 RATE_LIMITED and answers probes uniformly until it does', async () => {
    primeSession(sessionRow());
    testSessionFindUnique.mockResolvedValue(null);
    let saw429 = false;
    let remaining = 45; // hard stop so a broken limiter fails the test, not the suite
    while (!saw429 && remaining > 0) {
      const res = await request(app).post('/api/public/test/probe-garbage-token-abcdef/start');
      if (res.status === 429) {
        saw429 = true;
        expect(res.body.error.code).toBe('RATE_LIMITED');
      } else {
        expect(res.status).toBe(404); // anything other than 404/429 is a bug
      }
      remaining -= 1;
    }
    expect(saw429).toBe(true);
  });
});
