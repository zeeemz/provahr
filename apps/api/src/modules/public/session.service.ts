// Candidate test-session engine (PLAN.md Phase 5, §4 loop step 4, §5.2
// mechanisms 1–5, §8) — the API side of the proctored session: start (draw +
// variants), answer upserts, bounded-review revisions, signal ingestion,
// submit, and the never-pausing clock. Web and mobile consume this exact
// contract (PLAN §7).
//
// DISCIPLINE (docs/TESTING.md §6 never-regress #2, #3, #6):
// - Every lookup goes through the token HASH — never the plain token — and
//   bad shape / unknown token answer the same 404 as every other test-link
//   endpoint (no validity oracle).
// - Pool items are decrypted in exactly ONE place (startSession's fresh-start
//   path) and the plaintext array never leaves that function's stack.
// - The candidate-visible surface is SessionQuestion.presented. No endpoint
//   here returns pool items, truth flags, rubrics, hidden cases, scores, or
//   feedback — the candidate sees their own answers and nothing else.
//
// CLOCK (never-regress #5): deadlineAt is set once at start. Re-entry, answer
// revisions and the review pass never move it. Past the deadline every
// mutation — and the question view itself — fails 409 SESSION_EXPIRED, except
// submit which accepts a 60s late arrival for the auto-submit race. No
// worker: expiry checks are inline (lazy); an ISSUED link past its TTL is
// flipped to EXPIRED on first touch.

import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma';
import { AppError } from '../../lib/http';
import { hashTestToken, isTokenShapeValid } from '../../lib/testTokens';
import { enqueue } from '../../lib/queue';
import { decryptSecret } from '../../lib/crypto';
import {
  assessmentItemSchema,
  blueprintSectionSchema,
  type AssessmentItem,
  type BlueprintSection,
} from '../../lib/assessment/item';
import { drawSession, realizeVariant, seededRng, type PresentedQuestion } from '../../lib/session/draw';
import { deadlineFor, isExpired, withinSubmitGrace } from '../../lib/session/clock';
import type { SignalsInput } from './session.schema';

/** Hard cap on stored proctoring signals per session — excess is dropped. */
const MAX_SIGNALS_PER_SESSION = 500;
/** Written/code answers are capped (chars) — long-form is not the format. */
const MAX_TEXT_LENGTH = 10_000;

// ─── Token-scoped session lookup (hash-only, uniform 404) ─────────────────────

const sessionSelect = {
  id: true,
  jobId: true,
  status: true,
  expiresAt: true,
  startedAt: true,
  deadlineAt: true,
  job: { select: { blueprint: { select: { sections: true, timeLimitMin: true } } } },
} satisfies Prisma.TestSessionSelect;

type SessionRow = Prisma.TestSessionGetPayload<{ select: typeof sessionSelect }>;

/** The one 404 every test-link endpoint shares — no shape/existence oracle. */
function tokenNotFound(): AppError {
  return new AppError(404, 'Test link not found', 'NOT_FOUND');
}

async function findSession(token: string): Promise<SessionRow> {
  if (!isTokenShapeValid(token)) throw tokenNotFound();
  const session = await prisma.testSession.findUnique({
    where: { tokenHash: hashTestToken(token) }, // hash-only lookup
    select: sessionSelect,
  });
  if (!session) throw tokenNotFound();
  return session;
}

/** Link-TTL expiry applies to never-started links only (PLAN §4 step 3). */
function linkExpired(session: SessionRow): boolean {
  return (
    session.status === 'EXPIRED' ||
    (session.status === 'ISSUED' && session.expiresAt.getTime() <= Date.now())
  );
}

function assertNotSubmitted(session: SessionRow): void {
  if (session.status === 'SUBMITTED') {
    throw new AppError(409, 'This test was already submitted', 'SESSION_SUBMITTED');
  }
}

/** Gates every in-session endpoint; returns the never-pausing deadline. */
function requireStarted(session: SessionRow): Date {
  assertNotSubmitted(session);
  if (session.status !== 'STARTED' || session.deadlineAt === null) {
    throw new AppError(409, 'Start the test before using the session', 'SESSION_NOT_STARTED');
  }
  return session.deadlineAt;
}

function assertClockRunning(deadlineAt: Date): void {
  if (isExpired(deadlineAt, new Date())) {
    throw new AppError(409, 'Session time is up — the clock never pauses', 'SESSION_EXPIRED');
  }
}

/** Shared gate for view/answers/signals/submit: live link + STARTED + clock. */
async function findLiveStartedSession(token: string): Promise<{ session: SessionRow; deadlineAt: Date }> {
  const session = await findSession(token);
  if (linkExpired(session)) throw new AppError(410, 'Test link expired', 'TEST_LINK_EXPIRED');
  const deadlineAt = requireStarted(session);
  return { session, deadlineAt };
}

// ─── The candidate view (the ONLY thing these endpoints return) ───────────────

export interface SessionQuestionView {
  order: number;
  format: string;
  presented: Prisma.JsonValue;
}

export interface SessionView {
  questions: SessionQuestionView[];
  /** Saved answer content keyed by question order — the candidate's own data only. */
  answers: Record<string, Prisma.JsonValue>;
  meta: {
    deadlineAt: Date;
    timeLimitMin: number;
    total: number;
  };
}

/** Blueprint limit if present; else derive from the persisted timestamps. */
function effectiveTimeLimit(session: SessionRow): number {
  const fromBlueprint = session.job.blueprint?.timeLimitMin;
  if (typeof fromBlueprint === 'number') return fromBlueprint;
  if (session.startedAt && session.deadlineAt) {
    return Math.max(1, Math.round((session.deadlineAt.getTime() - session.startedAt.getTime()) / 60_000));
  }
  return 0;
}

/** Builds the view from the persisted draw — identical shape on re-entry. */
async function buildView(session: SessionRow): Promise<SessionView> {
  const rows = await prisma.sessionQuestion.findMany({
    where: { sessionId: session.id },
    orderBy: { order: 'asc' },
    select: { order: true, format: true, presented: true, answer: { select: { content: true } } },
  });
  const answers: Record<string, Prisma.JsonValue> = {};
  for (const row of rows) {
    const content = row.answer?.content;
    if (content !== null && content !== undefined) answers[String(row.order)] = content;
  }
  return {
    questions: rows.map((row) => ({ order: row.order, format: row.format, presented: row.presented })),
    answers,
    meta: {
      deadlineAt: session.deadlineAt!, // callers only reach here on STARTED rows
      timeLimitMin: effectiveTimeLimit(session),
      total: rows.length,
    },
  };
}

// ─── Pool decryption (the ONE site) + blueprint revalidation ─────────────────

function parseSections(raw: Prisma.JsonValue): BlueprintSection[] {
  const parsed = z.array(blueprintSectionSchema).safeParse(raw ?? []);
  if (!parsed.success) {
    throw new AppError(500, 'Blueprint sections failed schema validation', 'BLUEPRINT_CORRUPT');
  }
  return parsed.data;
}

/**
 * Decrypts and revalidates the pool. Items were schema-valid at seal time
 * (blueprint.service worker path); the re-parse is defense against a
 * corrupted blob. Invalid entries are skipped, never repaired.
 */
function parsePoolItems(itemsEncrypted: string): AssessmentItem[] {
  let raw: unknown;
  try {
    raw = JSON.parse(decryptSecret(itemsEncrypted));
  } catch (err) {
    if (err instanceof AppError) throw err; // decryptSecret's uniform CRYPTO_ERROR
    throw new AppError(500, 'Sealed pool is unreadable', 'POOL_CORRUPT');
  }
  if (!Array.isArray(raw)) {
    throw new AppError(500, 'Sealed pool is unreadable', 'POOL_CORRUPT');
  }
  const items: AssessmentItem[] = [];
  for (const entry of raw) {
    const check = assessmentItemSchema.safeParse(entry);
    if (check.success) items.push(check.data);
  }
  return items;
}

// ─── start: draw + variants + clock ───────────────────────────────────────────

export interface StartResult {
  /** true = fresh start (HTTP 201); false = idempotent re-entry (HTTP 200). */
  fresh: boolean;
  view: SessionView;
}

/**
 * Starts (or re-enters) a candidate session.
 *
 * - ISSUED + live link + active pool: decrypts the pool (the ONLY decryption
 *   site), draws deterministically (seed `${sessionId}:${poolId}` — both
 *   persisted, so the draw is reproducible from the database alone),
 *   realizes per-question variants (rng seeded `${seed}:${itemId}`), persists
 *   SessionQuestions, flips the session to STARTED and sets the deadline.
 * - STARTED + clock running: returns the SAME view (idempotent re-entry —
 *   refresh-safe; the pool is NOT decrypted again, questions are re-read).
 * - SUBMITTED → 409; expired link → lazy-flip to EXPIRED + 410; STARTED past
 *   the deadline → 409 (the question surface closes with the clock; only the
 *   submit-with-grace door stays open).
 *
 * Concurrency: two racing starts on one token — the second sessionQuestion
 *   createMany loses on @@unique([sessionId, order]) → Prisma P2002 → 409;
 *   the status/startedAt/deadlineAt updates are identical either way.
 */
export async function startSession(token: string): Promise<StartResult> {
  const session = await findSession(token);
  assertNotSubmitted(session);

  if (linkExpired(session)) {
    // Lazy link-TTL expiry: flip ISSUED → EXPIRED on first touch, then 410.
    if (session.status === 'ISSUED') {
      await prisma.testSession.update({ where: { id: session.id }, data: { status: 'EXPIRED' } });
    }
    throw new AppError(410, 'Test link expired', 'TEST_LINK_EXPIRED');
  }

  if (session.status === 'STARTED' && session.deadlineAt !== null) {
    assertClockRunning(session.deadlineAt);
    return { fresh: false, view: await buildView(session) };
  }

  const blueprint = session.job.blueprint;
  if (!blueprint) {
    throw new AppError(409, 'No blueprint for this test', 'BLUEPRINT_NOT_FOUND');
  }
  const sections = parseSections(blueprint.sections);

  const pool = await prisma.sealedQuestionPool.findFirst({
    where: { jobId: session.jobId, isActive: true },
    orderBy: { sealedAt: 'desc' }, // deterministic under the documented isActive race
    select: { id: true, itemsEncrypted: true }, // scalars only, no relations
  });
  if (!pool) {
    // Fail closed: during a re-seal regeneration the job briefly has no active
    // pool — never draw from a pool HR believes was destroyed.
    throw new AppError(409, 'This test is no longer available', 'POOL_INACTIVE');
  }

  // The DRAW-time decryption site for pool items (lib/crypto). The only other
  // site is evaluation.service.ts (worker-side, post-SUBMITTED, for truth
  // data). The plaintext array lives on this stack and nowhere else.
  const items = parsePoolItems(pool.itemsEncrypted);
  if (items.length === 0) {
    // An empty-but-decryptable pool is corruption by another name — never
    // start a session with zero questions and a live clock (QA wave-6 F2).
    throw new AppError(500, 'Test pool is corrupt — contact the employer', 'POOL_CORRUPT');
  }

  const seed = `${session.id}:${pool.id}`;
  const drawn = drawSession({ items, blueprint: { sections }, seed });

  const startedAt = new Date();
  const deadlineAt = deadlineFor(startedAt, blueprint.timeLimitMin);

  const realized = drawn.map(({ item, order }) => ({
    order,
    format: item.format,
    itemId: item.id, // leak traceability (§5.2 #6) — internal column, never in the view
    presented: realizeVariant(item, seededRng(`${seed}:${item.id}`)),
  }));

  // Questions first, status flip second, both in ONE transaction — a crash
  // between two separate writes used to strand a STARTED session with zero
  // questions and no repair path (QA wave-6 F2). Crash now ⇒ neither landed,
  // and the ISSUED session can simply start again (same seed ⇒ same draw).
  await prisma.$transaction([
    prisma.sessionQuestion.createMany({
      data: realized.map((row) => ({
        sessionId: session.id,
        order: row.order,
        format: row.format,
        itemId: row.itemId,
        presented: row.presented as unknown as Prisma.InputJsonValue,
      })),
    }),
    prisma.testSession.update({
      where: { id: session.id },
      data: { status: 'STARTED', startedAt, deadlineAt },
    }),
  ]);

  return {
    fresh: true,
    view: {
      questions: realized.map((row) => ({
        order: row.order,
        format: row.format,
        presented: row.presented as unknown as Prisma.JsonValue,
      })),
      answers: {},
      meta: { deadlineAt, timeLimitMin: blueprint.timeLimitMin, total: realized.length },
    },
  };
}

// ─── view: refresh-safe re-entry state ────────────────────────────────────────

export async function getSessionView(token: string): Promise<SessionView> {
  const { session } = await findLiveStartedSession(token);
  const deadlineAt = session.deadlineAt!;
  assertClockRunning(deadlineAt);
  return buildView(session);
}

// ─── answers: upsert + revision semantics ─────────────────────────────────────

export type UpsertAnswerInput = { order: number; content?: unknown };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates answer content against the question's format and its presented
 * options; returns the normalized content to persist. Throws 400
 * INVALID_ANSWER on any mismatch — a wrong-shaped answer is rejected, never
 * coerced (evidence quality beats leniency).
 */
function validateAnswerContent(format: string, presented: Prisma.JsonValue, content: unknown): Prisma.InputJsonValue {
  const invalid = (why: string) => new AppError(400, why, 'INVALID_ANSWER');
  const view = presented as unknown as PresentedQuestion; // written by realizeVariant
  const optionIds = new Set((view.options ?? []).map((option) => option.id));

  if (format === 'SWIPE_MCQ') {
    // {optionId: 'LIKE'|'DISLIKE'}; a subset (or none) is fine — skipped
    // options are simply unvalued; scoring is per option (PLAN §12 D14).
    if (!isPlainObject(content)) {
      throw invalid('SWIPE_MCQ answers must be an object of optionId → LIKE | DISLIKE');
    }
    const out: Record<string, string> = {};
    for (const [optionId, valuation] of Object.entries(content)) {
      if (!optionIds.has(optionId)) throw invalid(`Unknown option id "${optionId}"`);
      if (valuation !== 'LIKE' && valuation !== 'DISLIKE') {
        throw invalid(`Option "${optionId}" must be valued LIKE or DISLIKE`);
      }
      out[optionId] = valuation;
    }
    return out;
  }

  if (format === 'MCQ') {
    if (!isPlainObject(content) || typeof content.optionId !== 'string') {
      throw invalid('MCQ answers must be { optionId }');
    }
    if (!optionIds.has(content.optionId)) throw invalid(`Unknown option id "${content.optionId}"`);
    return { optionId: content.optionId };
  }

  if (format === 'WRITTEN' || format === 'CODE') {
    if (!isPlainObject(content) || typeof content.text !== 'string') {
      throw invalid(`${format} answers must be { text }`);
    }
    if (content.text.length > MAX_TEXT_LENGTH) {
      throw invalid(`Text answers are capped at ${MAX_TEXT_LENGTH} characters`);
    }
    return { text: content.text };
  }

  throw invalid(`Unsupported question format ${format}`);
}

/**
 * Upserts one answer. Requires STARTED + clock running — a late answer is
 * rejected with 409 SESSION_EXPIRED (no grace: the clock never pauses).
 * Revisions increment and timestamps move; firstAnsweredAt is set once —
 * the revision trail feeds Phase 8 timing signals.
 */
export async function upsertAnswer(token: string, input: UpsertAnswerInput): Promise<void> {
  const { session, deadlineAt } = await findLiveStartedSession(token);
  assertClockRunning(deadlineAt);

  const question = await prisma.sessionQuestion.findFirst({
    where: { sessionId: session.id, order: input.order },
    select: { id: true, format: true, presented: true },
  });
  if (!question) throw new AppError(404, 'Question not found', 'NOT_FOUND');

  const content = validateAnswerContent(question.format, question.presented, input.content);
  const now = new Date();
  await prisma.answer.upsert({
    where: { sessionQuestionId: question.id },
    create: {
      sessionQuestionId: question.id,
      content,
      firstAnsweredAt: now,
      lastAnsweredAt: now,
    },
    update: {
      content,
      revisions: { increment: 1 }, // review-pass revisions count (§5.2 mechanism 4)
      lastAnsweredAt: now,
    },
  });
}

// ─── signals: append-only evidence, never status-changing ─────────────────────

export type SignalInput = SignalsInput['signals'][number];

/**
 * Records a batch of proctoring signals. Signals NEVER affect session status
 * (flag, never auto-reject — PLAN §2.1): they are append-only evidence for
 * the Phase 8 evaluation. Capped at MAX_SIGNALS_PER_SESSION rows per session;
 * excess is dropped and the drop is noted on the last accepted signal's
 * detail where evaluation will see it.
 */
export async function recordSignals(token: string, signals: SignalInput[]): Promise<{ recorded: number }> {
  const { session, deadlineAt } = await findLiveStartedSession(token);
  assertClockRunning(deadlineAt); // strictly — the grace window is submit-only

  const existing = await prisma.sessionSignal.count({ where: { sessionId: session.id } });
  const room = Math.max(0, MAX_SIGNALS_PER_SESSION - existing);
  const accepted = signals.slice(0, room);
  const dropped = signals.length - accepted.length;
  if (accepted.length === 0) return { recorded: 0 };

  const rows = accepted.map((signal) => ({
    sessionId: session.id,
    type: signal.type,
    at: signal.at,
    detail: (signal.detail ?? undefined) as Prisma.InputJsonValue | undefined,
  }));
  if (dropped > 0) {
    const last = rows[rows.length - 1]!;
    last.detail = {
      ...((last.detail as Record<string, unknown> | undefined) ?? {}),
      droppedByCap: dropped,
    } as Prisma.InputJsonValue;
  }
  await prisma.sessionSignal.createMany({ data: rows });
  return { recorded: accepted.length };
}

// ─── submit: the asymmetric end ───────────────────────────────────────────────

/**
 * Finalizes the session. A submit within SUBMIT_GRACE_MS past the deadline is
 * accepted (auto-submit race — the client fired as the clock hit zero);
 * later than that → 409 SESSION_EXPIRED.
 *
 * Asymmetry (never-regress #6): the candidate response is { submitted: true }
 * and NOTHING else — no score, no verdicts, no feedback, ever.
 */
export async function submitSession(token: string): Promise<{ submitted: boolean }> {
  const { session, deadlineAt } = await findLiveStartedSession(token);
  if (!withinSubmitGrace(deadlineAt, new Date())) {
    throw new AppError(409, 'Session time is up — the clock never pauses', 'SESSION_EXPIRED');
  }
  await prisma.testSession.update({
    where: { id: session.id },
    data: { status: 'SUBMITTED', submittedAt: new Date() },
  });
  // Wire the evaluation worker (QA wave-8 F1): the candidate's loop ends at
  // "submitted"; HR's X-ray begins here. Enqueue failure must never fail the
  // submit itself — the queue's requeueStale/manual path is the backstop.
  await enqueue('EVALUATION', { sessionId: session.id }).catch((err: unknown) => {
    console.error(`[session] failed to enqueue evaluation for ${session.id}: ${String(err)}`);
  });
  return { submitted: true };
}
