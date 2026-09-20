// Immediate post-submit marking (founder decision 2026-09-21): MCQ/SWIPE_MCQ
// are marked deterministically at submit and via GET /test/:token/marking;
// WRITTEN/CODE surface as PENDING_EVALUATION; voided items are NOT_COUNTED;
// pool-drift items are never marked wrong. Real crypto round-trip on the pool
// box (house style from session-routes.test.ts).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { encryptSecret } from '../src/lib/crypto';
import { assessmentItemSchema, newItemId, type AssessmentItem } from '../src/lib/assessment/item';

const {
  testSessionFindUnique,
  testSessionUpdate,
  sessionQuestionFindMany,
  poolFindFirst,
  voidedFindMany,
  jobQueueCreate,
} = vi.hoisted(() => ({
  testSessionFindUnique: vi.fn(),
  testSessionUpdate: vi.fn(),
  sessionQuestionFindMany: vi.fn(),
  poolFindFirst: vi.fn(),
  voidedFindMany: vi.fn(),
  jobQueueCreate: vi.fn().mockResolvedValue({ id: 'q-1' }),
}));

vi.mock('../src/prisma', () => ({
  prisma: {
    testSession: { findUnique: testSessionFindUnique, update: testSessionUpdate },
    sessionQuestion: { findMany: sessionQuestionFindMany },
    sealedQuestionPool: { findFirst: poolFindFirst },
    voidedItem: { findMany: voidedFindMany },
    jobQueue: { create: jobQueueCreate },
    $transaction: (arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : (arg as () => Promise<unknown>)()),
  },
}));

import { createApp } from '../src/app';

const app = createApp();

const TOKEN = 'AbCdEf1234567890_-AbCdEf1234567890_-AbCdEf1'; // valid shape (43 chars)
expect(TOKEN).toHaveLength(43);

function mcq(id: string, correctOptionId: string): AssessmentItem {
  return assessmentItemSchema.parse({
    id,
    format: 'MCQ',
    prompt: `Question ${id}`,
    options: [
      { id: 'a', text: 'Answer A' },
      { id: 'b', text: 'Answer B' },
      { id: 'c', text: 'Answer C' },
    ],
    correctOptionId,
    difficulty: 'EASY',
    topics: ['api-design'],
  }) as AssessmentItem;
}

function swipe(id: string): AssessmentItem {
  return assessmentItemSchema.parse({
    id,
    format: 'SWIPE_MCQ',
    prompt: `Select-all ${id}`,
    options: [
      { id: 'a', text: 'True statement', truth: true },
      { id: 'b', text: 'False statement', truth: false },
      { id: 'c', text: 'Another true statement', truth: true },
    ],
    difficulty: 'EASY',
    topics: ['api-design'],
  }) as AssessmentItem;
}

function written(id: string): AssessmentItem {
  return assessmentItemSchema.parse({
    id,
    format: 'WRITTEN',
    prompt: `Explain ${id}`,
    rubric: 'Mentions the relevant concept clearly.',
    difficulty: 'MEDIUM',
    topics: ['api-design'],
  }) as AssessmentItem;
}

const ITEMS = [mcq('mcq-ok', 'a'), mcq('mcq-bad', 'a'), swipe('swipe-half'), written('w-1')];
const ENCRYPTED_POOL = encryptSecret(JSON.stringify(ITEMS));

/** The four drawn questions: one right MCQ, one wrong MCQ, a half-credit
 *  swipe (only the true option liked), and an open written answer. */
const QUESTIONS = [
  { order: 1, format: 'MCQ', itemId: 'mcq-ok', answer: { content: { optionId: 'a' } } },
  { order: 2, format: 'MCQ', itemId: 'mcq-bad', answer: { content: { optionId: 'b' } } },
  { order: 3, format: 'SWIPE_MCQ', itemId: 'swipe-half', answer: { content: { a: 'LIKE' } } },
  { order: 4, format: 'WRITTEN', itemId: 'w-1', answer: { content: { text: 'words' } } },
];

function primeSubmitted(overrides: { voided?: string[]; items?: AssessmentItem[] } = {}) {
  vi.clearAllMocks();
  jobQueueCreate.mockResolvedValue({ id: 'q-1' });
  testSessionFindUnique.mockResolvedValue({
    id: 'sess-1',
    jobId: 'job-1',
    status: 'SUBMITTED',
    // submit path fields (findLiveStartedSession reads the same row):
    expiresAt: new Date(Date.now() + 86_400_000),
    startedAt: new Date(),
    deadlineAt: new Date(Date.now() + 60_000),
    job: { blueprint: BLUEPRINT },
  });
  testSessionUpdate.mockResolvedValue({});
  sessionQuestionFindMany.mockResolvedValue(QUESTIONS);
  poolFindFirst.mockResolvedValue({ itemsEncrypted: encryptSecret(JSON.stringify(overrides.items ?? ITEMS)) });
  voidedFindMany.mockResolvedValue((overrides.voided ?? []).map((itemId) => ({ itemId })));
}

const BLUEPRINT = { sections: [{ topics: ['api-design'], formats: { MCQ: 2 } }], timeLimitMin: 30 };

describe('GET /api/public/test/:token/marking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobQueueCreate.mockResolvedValue({ id: 'q-1' });
  });

  it('marks objective answers, keeps open formats pending, summarizes honestly', async () => {
    primeSubmitted();

    const res = await request(app).get(`/api/public/test/${TOKEN}/marking`);

    expect(res.status).toBe(200);
    const items = res.body.items as Array<{
      order: number; status: string; correct?: boolean; score?: number; correctOptionId?: string;
    }>;
    expect(items).toHaveLength(4);

    const mcqOk = items.find((i) => i.order === 1)!;
    expect(mcqOk.status).toBe('MARKED');
    expect(mcqOk.correct).toBe(true);
    expect(mcqOk.correctOptionId).toBe('a');

    const mcqBad = items.find((i) => i.order === 2)!;
    expect(mcqBad.status).toBe('MARKED');
    expect(mcqBad.correct).toBe(false);
    expect(mcqBad.score).toBe(0);

    const swipeHalf = items.find((i) => i.order === 3)!;
    expect(swipeHalf.status).toBe('MARKED');
    expect(swipeHalf.correct).toBe(false); // partial ≠ full credit
    expect(swipeHalf.score).toBeGreaterThan(0);

    const open = items.find((i) => i.order === 4)!;
    expect(open.status).toBe('PENDING_EVALUATION');

    expect(res.body.summary).toEqual({ marked: 3, correct: 1, partial: 1 });
  });

  it('counts voided items as NOT_COUNTED — never marked wrong', async () => {
    primeSubmitted({ voided: ['mcq-bad'] });
    const res = await request(app).get(`/api/public/test/${TOKEN}/marking`);
    expect(res.status).toBe(200);
    const voided = (res.body.items as Array<{ order: number; status: string }>).find((i) => i.order === 2)!;
    expect(voided.status).toBe('NOT_COUNTED');
    expect(res.body.summary.marked).toBe(2); // the voided one left the objective set
  });

  it('never marks pool-drifted items wrong (re-seal after the session started)', async () => {
    // Active pool no longer contains mcq-ok.
    primeSubmitted({ items: ITEMS.filter((i) => i.id !== 'mcq-ok') });
    const res = await request(app).get(`/api/public/test/${TOKEN}/marking`);
    expect(res.status).toBe(200);
    const drifted = (res.body.items as Array<{ order: number; status: string }>).find((i) => i.order === 1)!;
    expect(drifted.status).toBe('PENDING_EVALUATION');
  });

  it('uniform 404 for malformed and unknown tokens; 409 before submission', async () => {
    primeSubmitted();
    const malformed = await request(app).get('/api/public/test/short/marking');
    expect(malformed.status).toBe(404);

    testSessionFindUnique.mockResolvedValue(null);
    const unknown = await request(app).get(`/api/public/test/${TOKEN}/marking`);
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual(malformed.body); // no oracle

    testSessionFindUnique.mockResolvedValue({ id: 'sess-1', jobId: 'job-1', status: 'STARTED' });
    const live = await request(app).get(`/api/public/test/${TOKEN}/marking`);
    expect(live.status).toBe(409);
    expect(live.body.error.code).toBe('SESSION_NOT_SUBMITTED');
  });
});

describe('POST /api/public/test/:token/submit — marking rides the response', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobQueueCreate.mockResolvedValue({ id: 'q-1' });
  });

  /** The two sequential findUnique calls inside submit: the live-session gate
   *  reads STARTED, then the marking lookup re-reads the flipped SUBMITTED. */
  function primeSubmitSequence(secondLookup: unknown): void {
    testSessionFindUnique
      .mockResolvedValueOnce({
        id: 'sess-1',
        jobId: 'job-1',
        status: 'STARTED',
        expiresAt: new Date(Date.now() + 86_400_000),
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60_000),
        job: { blueprint: BLUEPRINT },
      })
      .mockResolvedValueOnce(secondLookup);
    testSessionUpdate.mockResolvedValue({});
    sessionQuestionFindMany.mockResolvedValue(QUESTIONS);
    poolFindFirst.mockResolvedValue({ itemsEncrypted: ENCRYPTED_POOL });
    voidedFindMany.mockResolvedValue([]);
  }

  it('includes the marking when the pool is available', async () => {
    primeSubmitSequence({ id: 'sess-1', jobId: 'job-1', status: 'SUBMITTED' });

    const res = await request(app).post(`/api/public/test/${TOKEN}/submit`);

    expect(res.status).toBe(200);
    expect(res.body.submitted).toBe(true);
    expect(res.body.marking.summary).toEqual({ marked: 3, correct: 1, partial: 1 });
    expect(res.body.marking.items).toHaveLength(4);
  });

  it('omits the marking entirely when the pool is transiently unavailable (mid-reseal)', async () => {
    primeSubmitSequence({ id: 'sess-1', jobId: 'job-1', status: 'SUBMITTED' });
    poolFindFirst.mockResolvedValue(null); // POOL_UNAVAILABLE inside submit → best-effort omit

    const res = await request(app).post(`/api/public/test/${TOKEN}/submit`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ submitted: true });
    expect(Object.keys(res.body)).toEqual(['submitted']);
  });
});
