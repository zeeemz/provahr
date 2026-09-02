// LLM evaluation pipeline + HR X-ray + void-with-renormalization
// (PLAN.md Phase 8, §4 loop step 6, §5.2 #7, §8, §9, §12 D2/D5).
//
// THE ASYMMETRIC OUTCOME (PLAN §4 step 7): the candidate saw "submitted ✓" and
// nothing else; everything below is HR-ONLY. No function here is reachable
// from a public/candidate route, and nothing here ever writes Application
// status — FLAG, NEVER AUTO-REJECT is the law (PLAN §2.1, docs/TESTING.md §6
// #1): AI output (verdicts, aiLikelihood, collusion) is evidence for a human.
//
// POOL DECRYPTION SITE #2 (documented, sanctioned): besides the session-start
// draw site (modules/public/session.service.ts), the ACTIVE pool is decrypted
// exactly ONCE per evaluation run — worker-side, AFTER the session is
// SUBMITTED — to recover the truth data (truth flags, correctOptionId,
// rubrics, hidden cases) needed to score. HR never sees the pool through this
// path; the X-ray returns only per-session derived evidence.
//
// V1 POOL-DRIFT POLICY (fairness, PLAN §5.2 #7 spirit): if a session's
// itemIds are no longer in the active pool (the pool was re-sealed after the
// session started), those questions are EXCLUDED from scoring and noted in
// flagSummary.unscoredItemIds — a platform-side event must never silently
// penalize a candidate. CODE with no reachable Docker degrades the whole run
// to a retryable failure instead (AppError 503 propagates → queue retry).
//
// V2-4 (PLAN §12 D21): the session's COMPANY resolves which sandbox IMAGES run
// its CODE answers — enabled sandbox templates override the platform defaults
// (loadTemplateImages → createExecutor({images})); the argv hardening is
// identical either way (builder.ts re-asserts per resolved image).

import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma';
import { AppError } from '../../lib/http';
import { enqueue } from '../../lib/queue';
import { decryptSecret } from '../../lib/crypto';
import { scoreSwipe, type SwipeValuation } from '../../lib/scoring/swipe';
import { scoreMcq } from '../../lib/scoring/mcq';
import { CODE_LANGUAGES, type CodeLanguage } from '../../lib/assessment/item';
import { getActiveAdapter, type LlmAdapter } from '../../lib/llm';
import type { ImageOverrides, SandboxExecutor } from '../../lib/sandbox';
import { createExecutor } from '../../lib/sandbox';
import { IMAGE_ALLOW_LIST, resolveImage } from '../../lib/sandbox/templates';
import { assessmentItemSchema, type AssessmentItem } from '../../lib/assessment/item';
import {
  buildWrittenPrompt,
  buildCodeReviewPrompt,
  CODE_SYSTEM_PROMPT,
  WRITTEN_SYSTEM_PROMPT,
} from '../../prompts/evaluation';
import { composeSystem } from '../../prompts/compose';
import { getMainPrompt } from '../platform/settings.service';
import type { AuthUser } from '../../types';

// ─── Vocabulary ───────────────────────────────────────────────────────────────

type Verdict = 'CORRECT' | 'PARTIAL' | 'INCORRECT';
type AiLikelihood = 'LOW' | 'MEDIUM' | 'HIGH';

/** Method stamp on every Evaluation row — how the score was produced. */
type EvalMethod = 'DETERMINISTIC' | 'SANDBOX' | 'LLM' | 'SANDBOX_LLM';

const REVIEW_MAX_TOKENS = 1_500;

const writtenReviewSchema = z.object({
  verdict: z.enum(['CORRECT', 'PARTIAL', 'INCORRECT']),
  score: z.number().min(0).max(1),
  review: z.string().max(4_000),
  aiLikelihood: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  aiReasoning: z.string().max(2_000).optional().default(''),
});

const codeReviewSchema = z.object({
  review: z.string().max(4_000),
  aiLikelihood: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  aiReasoning: z.string().max(2_000).optional().default(''),
});

function verdictFromScore(score: number): Verdict {
  if (score >= 1) return 'CORRECT';
  if (score > 0) return 'PARTIAL';
  return 'INCORRECT';
}

// ─── Answer-content coercions (defensive — shape was validated at save time) ──

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asSwipeAnswer(content: Prisma.JsonValue | null): Record<string, SwipeValuation> | null {
  if (!isPlainObject(content)) return null;
  return content as unknown as Record<string, SwipeValuation>;
}

function asMcqAnswer(content: Prisma.JsonValue | null): { optionId: string } | null {
  if (!isPlainObject(content) || typeof content.optionId !== 'string') return null;
  return { optionId: content.optionId };
}

function asTextAnswer(content: Prisma.JsonValue | null): string | null {
  if (!isPlainObject(content) || typeof content.text !== 'string') return null;
  return content.text;
}

/** Seconds between first and last save of an answer (0 when unknown). */
function secondsSpentOn(answer: { firstAnsweredAt: Date | null; lastAnsweredAt: Date | null } | null): number {
  if (!answer?.firstAnsweredAt || !answer.lastAnsweredAt) return 0;
  return Math.max(0, Math.round((answer.lastAnsweredAt.getTime() - answer.firstAnsweredAt.getTime()) / 1000));
}

// ─── Queue producer ───────────────────────────────────────────────────────────

/**
 * Enqueues the EVALUATION job for a SUBMITTED session.
 *
 * WIRING DEFERRAL (documented): the one-line call from submitSession
 * (modules/public/session.service.ts — outside this module's file ownership)
 * lands with Phase 9's integration pass. Until then this helper is the single
 * sanctioned producer; runEvaluation itself is idempotent and safe to invoke
 * directly (tests do) or via a manually enqueued queue row.
 */
export async function enqueueEvaluation(sessionId: string): Promise<{ id: string }> {
  return enqueue('EVALUATION', { sessionId });
}

// ─── Worker: runEvaluation ────────────────────────────────────────────────────

/**
 * V2-4 (PLAN §12 D21): the company's RESOLVED sandbox template images for one
 * evaluation run — only the languages whose ENABLED template image actually
 * overrides the platform default. Resolution is an overlay, never a
 * dependency: any failure here (database blip included) degrades to the
 * defaults (undefined) so candidate evaluation cannot go down over template
 * data. resolveImage additionally drops unsafe stored refs — the default is
 * the safe direction — while buildRunArgs re-validates every override at
 * build time (SANDBOX_TEMPLATE_UNSAFE) as the fail-closed backstop.
 */
async function loadTemplateImages(companyId: string): Promise<ImageOverrides | undefined> {
  try {
    const templates = await prisma.sandboxTemplate.findMany({
      where: { companyId, enabled: true },
      select: { language: true, image: true },
    });
    const images: ImageOverrides = {};
    for (const template of templates) {
      if (!CODE_LANGUAGES.includes(template.language as CodeLanguage)) continue; // unknown language row: inert
      const language = template.language as CodeLanguage;
      const image = resolveImage(language, template); // unsafe ⇒ default (never surfaced as an override)
      if (image !== IMAGE_ALLOW_LIST[language]) images[language] = image;
    }
    return Object.keys(images).length > 0 ? images : undefined;
  } catch {
    return undefined; // template data is best-effort; the defaults stay safe
  }
}

/** Loads, decrypts and revalidates the active pool ONCE per run (site #2). */
async function loadActivePoolItems(jobId: string): Promise<Map<string, AssessmentItem>> {
  const pool = await prisma.sealedQuestionPool.findFirst({
    where: { jobId, isActive: true },
    orderBy: { sealedAt: 'desc' }, // deterministic under the documented isActive race
    select: { itemsEncrypted: true },
  });
  if (!pool) {
    // Transient (mid-reseal) — retry the job rather than zero-scoring a session.
    throw new AppError(503, 'No active pool for this job — cannot evaluate yet', 'POOL_UNAVAILABLE');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(decryptSecret(pool.itemsEncrypted));
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'Sealed pool is unreadable', 'POOL_CORRUPT');
  }
  const items = new Map<string, AssessmentItem>();
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const check = assessmentItemSchema.safeParse(entry);
      if (check.success) items.set(check.data.id, check.data);
    }
  }
  return items;
}

/**
 * Resolves the company's active LLM adapter ONCE, or null when the company has
 * no provider configured (deterministic scoring proceeds; LLM-only grading
 * degrades — see runEvaluation). Any other failure propagates for a queue
 * retry.
 */
async function tryGetAdapter(companyId: string): Promise<LlmAdapter | null> {
  try {
    return (await getActiveAdapter(companyId)).adapter;
  } catch (err) {
    if (err instanceof AppError && err.code === 'NO_PROVIDER') return null;
    throw err;
  }
}

/** One strict-JSON LLM call; parse failure is a retryable error, not a zero. */
async function chatJson(adapter: LlmAdapter, system: string, user: string): Promise<unknown> {
  const res = await adapter.chat({
    system,
    messages: [{ role: 'user', content: user }],
    jsonMode: true,
    maxTokens: REVIEW_MAX_TOKENS,
  });
  return JSON.parse(res.text); // throws on bad JSON → job retry
}

/** A session question with its answer, as loaded by runEvaluation. */
interface QuestionRow {
  id: string;
  order: number;
  format: string;
  itemId: string;
  answer: { content: Prisma.JsonValue | null; revisions: number; firstAnsweredAt: Date | null; lastAnsweredAt: Date | null } | null;
}

/**
 * Scores every answer of a SUBMITTED session, writes one Evaluation (and one
 * ExecutionResult per executed code answer), then rolls everything up into a
 * SessionAssessment. Idempotent: questions that already have an Evaluation row
 * (voided ones included — a void is the authority, re-running must not
 * resurrect it) are skipped, so queue retries resume where they left off.
 *
 * NEVER sets any Application status — flags only (PLAN §2.1).
 */
export async function runEvaluation(sessionId: string): Promise<void> {
  const session = await prisma.testSession.findUnique({
    where: { id: sessionId },
    // job.companyId rides along (V2-2): the session's company decides which
    // tenant's LLM provider grades it — one select, no extra round trip.
    // job.jobPrompt rides along too (two-tier prompts): the role-specific
    // overlay for the review LLM calls below.
    select: { id: true, jobId: true, status: true, job: { select: { companyId: true, jobPrompt: true } } },
  });
  if (!session) return; // session vanished — nothing to evaluate (queue no-op)
  if (session.status !== 'SUBMITTED') {
    // Mis-enqueued or raced with an expiry flip — fail loudly, do not score a
    // live session behind the candidate's back.
    throw new AppError(409, 'Session is not SUBMITTED — refusing to evaluate', 'SESSION_NOT_SUBMITTED');
  }

  const questions = await prisma.sessionQuestion.findMany({
    where: { sessionId },
    orderBy: { order: 'asc' },
    select: {
      id: true,
      order: true,
      format: true,
      itemId: true,
      answer: { select: { content: true, revisions: true, firstAnsweredAt: true, lastAnsweredAt: true } },
    },
  });

  // Pool truth (decrypt site #2) + the job's void ledger, both loaded once.
  const poolItems = await loadActivePoolItems(session.jobId);
  const voidedRows = await prisma.voidedItem.findMany({
    where: { jobId: session.jobId },
    select: { itemId: true },
  });
  const voidedItemIds = new Set(voidedRows.map((r) => r.itemId));

  const adapter = await tryGetAdapter(session.job.companyId);
  // Two-tier prompts (founder requirement): the platform MAIN prompt + this
  // job's overlay, composed ahead of the review system prompts. One cached
  // read per run (10s cache — putMainPrompt refreshes it on edit).
  const tiered = { mainPrompt: await getMainPrompt(), jobPrompt: session.job.jobPrompt };
  // V2-4 (D21): the company's sandbox template overrides, loaded ONCE and only
  // when a CODE answer will actually need an executor (swipe/mcq-only sessions
  // never query the table). Undefined ⇒ no overrides ⇒ the exact pre-V2-4
  // createExecutor('docker') call happens (tests pin that seam).
  const templateImages = questions.some((q) => q.format === 'CODE')
    ? await loadTemplateImages(session.job.companyId)
    : undefined;
  let executor: SandboxExecutor | null = null; // lazy: built on the first CODE answer

  /** Item ids that cannot be fairly scored this run (pool drift / needs LLM). */
  const unscoredItemIds = new Set<string>();

  for (const question of questions) {
    // Idempotency: an existing row (voided included) is final for this run.
    const existing = await prisma.evaluation.findUnique({
      where: { sessionQuestionId: question.id },
      select: { id: true },
    });
    if (existing) continue;

    const item = poolItems.get(question.itemId);
    if (!item) {
      unscoredItemIds.add(question.itemId); // pool drift — never punish (see header)
      continue;
    }
    // Re-check the void ledger PER QUESTION (QA wave-8 F2): a concurrent
    // voidItem in the API process can commit while this loop is inside a
    // multi-second LLM/sandbox call; the snapshot taken above would then be
    // stale and a fresh non-voided Evaluation would resurrect the voided
    // item's score.
    const voidedNow = await prisma.voidedItem.findUnique({
      where: { itemId: question.itemId },
      select: { itemId: true },
    });
    if (voidedNow) {
      voidedItemIds.add(question.itemId);
      continue; // voided across sessions — no row, excluded from the mean
    }

    let create: Prisma.EvaluationUncheckedCreateInput;
    try {
      create = await evaluateQuestion(question, item, adapter, tiered, () => {
        // Production path; tests use fake/injectable seams. With company
        // templates the resolved images ride along (V2-4) — otherwise the
        // call is byte-for-byte the historical createExecutor('docker').
        executor ??=
          templateImages === undefined
            ? createExecutor('docker')
            : createExecutor('docker', undefined, { images: templateImages });
        return executor;
      });
    } catch (err) {
      if (err instanceof NeedsLlmError) {
        // Ungradable without a provider — fairly skipped, noted for HR (header).
        unscoredItemIds.add(err.itemId);
        continue;
      }
      throw err;
    }
    await prisma.evaluation.upsert({
      where: { sessionQuestionId: question.id },
      create,
      update: {}, // unreachable: rows are skipped above — upsert keeps the P2002 race safe
    });
  }

  await writeAssessment(sessionId, session.jobId, questions, poolItems, unscoredItemIds);
}

/**
 * Scores one question and returns the Evaluation create payload. Pure w.r.t.
 * the database except the sandbox execution (and its ExecutionResult write)
 * for CODE answers, and the LLM review calls for CODE/WRITTEN. `tiered`
 * carries the two-tier system prompts composed ahead of the review prompts.
 */
async function evaluateQuestion(
  question: QuestionRow,
  item: AssessmentItem,
  adapter: LlmAdapter | null,
  tiered: { mainPrompt: string; jobPrompt: string | null },
  getExecutor: () => SandboxExecutor,
): Promise<Prisma.EvaluationUncheckedCreateInput> {
  const answer = question.answer;
  const base = { sessionQuestionId: question.id };

  // ── SWIPE_MCQ: per-option partial credit against truth flags ──────────────
  if (item.format === 'SWIPE_MCQ') {
    const { score, hits } = scoreSwipe(item, asSwipeAnswer(answer?.content ?? null));
    return {
      ...base,
      verdict: verdictFromScore(score),
      score,
      method: 'DETERMINISTIC',
      detail: { hits } as unknown as Prisma.InputJsonValue,
      // Deterministic formats carry no text to judge — timing anomalies live
      // in the session's signal rollup instead (PLAN §8), never an LLM guess.
      aiLikelihood: 'LOW',
    };
  }

  // ── MCQ: all-or-nothing ────────────────────────────────────────────────────
  if (item.format === 'MCQ') {
    const selected = asMcqAnswer(answer?.content ?? null);
    const { score, correct } = scoreMcq(item, selected);
    return {
      ...base,
      verdict: correct ? 'CORRECT' : 'INCORRECT',
      score,
      method: 'DETERMINISTIC',
      detail: {
        selectedOptionId: selected?.optionId ?? null,
        correctOptionId: item.correctOptionId,
      } as unknown as Prisma.InputJsonValue,
      aiLikelihood: 'LOW',
    };
  }

  // ── CODE: sandbox hidden cases (+ optional LLM quality review) ─────────────
  if (item.format === 'CODE') {
    const code = asTextAnswer(answer?.content ?? null);
    if (code === null) {
      return {
        ...base,
        verdict: 'INCORRECT',
        score: 0,
        method: 'DETERMINISTIC',
        detail: { note: 'No code answer submitted' } as unknown as Prisma.InputJsonValue,
        aiLikelihood: 'LOW',
      };
    }

    // Production seam: docker here; the AppError 503 SANDBOX_UNAVAILABLE
    // propagates so the queue retries (FakeExecutor covers tests).
    const response = await getExecutor().execute({ language: item.language, code, cases: item.hiddenCases });
    await prisma.executionResult.upsert({
      where: { sessionQuestionId: question.id },
      create: {
        sessionQuestionId: question.id,
        exitCode: response.exitCode,
        durationMs: response.durationMs,
        truncated: response.truncated,
        stdout: response.stdout,
        stderr: response.stderr,
        caseResults: response.outcomes as unknown as Prisma.InputJsonValue,
      },
      update: {},
    });

    const total = response.outcomes.length;
    const passed = response.outcomes.filter((o) => o.passed).length;
    const score = total === 0 ? 0 : passed / total;
    const detail = {
      cases: response.outcomes.map((o) => ({ name: o.name, passed: o.passed })),
      passed,
      total,
    };

    if (!adapter) {
      // Degraded (no provider): the deterministic sandbox score stands, the
      // quality review is explicitly marked as skipped — aiLikelihood stays
      // LOW (no evidence), never guessed.
      return {
        ...base,
        verdict: verdictFromScore(score),
        score,
        method: 'SANDBOX',
        detail: { ...detail, note: 'LLM quality review skipped — no active provider' } as unknown as Prisma.InputJsonValue,
        aiLikelihood: 'LOW',
      };
    }

    const review = codeReviewSchema.parse(
      await chatJson(
        adapter,
        composeSystem(CODE_SYSTEM_PROMPT, tiered.mainPrompt, tiered.jobPrompt),
        buildCodeReviewPrompt({
          prompt: item.prompt,
          language: item.language,
          code,
          caseOutcomes: response.outcomes,
          secondsSpent: secondsSpentOn(answer),
          revisions: answer?.revisions ?? 0,
        }),
      ),
    );
    return {
      ...base,
      verdict: verdictFromScore(score),
      score,
      method: 'SANDBOX_LLM',
      detail: detail as unknown as Prisma.InputJsonValue,
      qualityNotes: review.review,
      aiLikelihood: review.aiLikelihood,
      aiReasoning: review.aiReasoning,
    };
  }

  // ── WRITTEN: LLM-graded against the rubric ────────────────────────────────
  const text = asTextAnswer(answer?.content ?? null);
  if (text === null) {
    return {
      ...base,
      verdict: 'INCORRECT',
      score: 0,
      method: 'DETERMINISTIC',
      detail: { note: 'No written answer submitted' } as unknown as Prisma.InputJsonValue,
      aiLikelihood: 'LOW',
    };
  }
  if (!adapter) {
    // Degraded (no provider): there is NO honest deterministic score for
    // prose. Fairness wins over completeness — no Evaluation row is written
    // (the caller records the item in unscoredItemIds via the thrown marker
    // below), so a missing provider can never zero a candidate's essay.
    throw new NeedsLlmError(question.itemId);
  }
  const review = writtenReviewSchema.parse(
    await chatJson(
      adapter,
      composeSystem(WRITTEN_SYSTEM_PROMPT, tiered.mainPrompt, tiered.jobPrompt),
      buildWrittenPrompt({
        prompt: item.prompt,
        rubric: item.rubric,
        answerText: text,
        secondsSpent: secondsSpentOn(answer),
        revisions: answer?.revisions ?? 0,
      }),
    ),
  );
  return {
    ...base,
    verdict: review.verdict,
    score: review.score,
    method: 'LLM',
    detail: { review: review.review } as unknown as Prisma.InputJsonValue,
    qualityNotes: review.review,
    aiLikelihood: review.aiLikelihood,
    aiReasoning: review.aiReasoning,
  };
}

/** Internal control-flow marker: a written answer that cannot be graded yet. */
class NeedsLlmError extends Error {
  constructor(public readonly itemId: string) {
    super('written answer needs an active LLM provider');
  }
}

// ─── Session rollup (deterministic v1 — no extra LLM call) ───────────────────

/** Aggregates verdicts by item topic: "topic (2/2)" strengths / gaps lists. */
function topicTallies(
  scored: Array<{ itemId: string; verdict: string }>,
  poolItems: Map<string, AssessmentItem>,
): { strengths: string | null; gaps: string | null } {
  const stats = new Map<string, { correct: number; total: number }>();
  for (const row of scored) {
    for (const topic of poolItems.get(row.itemId)?.topics ?? []) {
      const entry = stats.get(topic) ?? { correct: 0, total: 0 };
      entry.total++;
      if (row.verdict === 'CORRECT') entry.correct++;
      stats.set(topic, entry);
    }
  }
  const strengths: string[] = [];
  const gaps: string[] = [];
  for (const [topic, { correct, total }] of stats) {
    const label = `${topic} (${correct}/${total})`;
    if (correct === total) strengths.push(label);
    else gaps.push(label);
  }
  strengths.sort();
  gaps.sort();
  return { strengths: strengths.length > 0 ? strengths.join(', ') : null, gaps: gaps.length > 0 ? gaps.join(', ') : null };
}

/**
 * Collusion v1 (PLAN §6 "cross-session collusion detection"): flags this
 * session when one of its CODE/WRITTEN answers is byte-identical (serialized
 * content) to another SUBMITTED session's answer for the SAME itemId — the
 * exact-match case of §5.2 mechanism 2's near-identical answer signal. FLAG
 * ONLY: the other sessionIds are listed for a human; nothing else happens.
 */
async function detectCollusion(
  sessionId: string,
  jobId: string,
  questions: QuestionRow[],
): Promise<string[]> {
  const mine = new Map<string, string>();
  for (const q of questions) {
    if (q.format !== 'CODE' && q.format !== 'WRITTEN') continue;
    if (q.answer?.content === null || q.answer?.content === undefined) continue;
    mine.set(q.itemId, JSON.stringify(q.answer.content));
  }
  if (mine.size === 0) return [];

  const others = await prisma.sessionQuestion.findMany({
    where: {
      itemId: { in: [...mine.keys()] },
      sessionId: { not: sessionId },
      session: { jobId, status: 'SUBMITTED' },
      answer: { isNot: null },
    },
    select: { itemId: true, sessionId: true, answer: { select: { content: true } } },
  });

  const partners = new Set<string>();
  for (const other of others) {
    const myContent = mine.get(other.itemId);
    if (myContent !== undefined && other.answer?.content !== undefined && JSON.stringify(other.answer.content) === myContent) {
      partners.add(other.sessionId);
    }
  }
  return [...partners].sort();
}

/**
 * Writes/upserts the SessionAssessment: mean of NON-VOIDED evaluation scores,
 * deterministic strengths/gaps, advisory recommendation, and the flag summary
 * (AI-likelihood counts, signal rollup, collusion partners, unscored items).
 */
async function writeAssessment(
  sessionId: string,
  jobId: string,
  questions: QuestionRow[],
  poolItems: Map<string, AssessmentItem>,
  unscoredItemIds: Set<string>,
): Promise<void> {
  const [evaluations, signalRows, collusion] = await Promise.all([
    prisma.evaluation.findMany({
      where: { sessionQuestion: { sessionId }, voided: false },
      select: { sessionQuestionId: true, verdict: true, score: true, aiLikelihood: true },
    }),
    prisma.sessionSignal.findMany({ where: { sessionId }, select: { type: true } }),
    detectCollusion(sessionId, jobId, questions),
  ]);

  const scoredCount = evaluations.length;
  const totalScore = scoredCount === 0 ? 0 : evaluations.reduce((sum, e) => sum + e.score, 0) / scoredCount;
  const aiHigh = evaluations.filter((e) => e.aiLikelihood === 'HIGH').length;
  const aiMedium = evaluations.filter((e) => e.aiLikelihood === 'MEDIUM').length;

  const signals: Record<string, number> = {};
  for (const row of signalRows) signals[row.type] = (signals[row.type] ?? 0) + 1;

  const byQuestion = new Map(questions.map((q) => [q.id, q]));
  const { strengths, gaps } = topicTallies(
    evaluations
      .map((e) => ({ itemId: byQuestion.get(e.sessionQuestionId)?.itemId ?? '', verdict: e.verdict }))
      .filter((r) => r.itemId !== ''),
    poolItems,
  );

  const recommendationParts = [`Mean score ${totalScore.toFixed(2)} across ${scoredCount} scored item(s).`];
  if (aiHigh > 0) recommendationParts.push(`${aiHigh} HIGH AI-likelihood flag(s) require human review.`);
  else if (aiMedium > 0) recommendationParts.push(`${aiMedium} MEDIUM AI-likelihood flag(s) noted.`);
  if (collusion.length > 0) {
    recommendationParts.push(`Possible answer collusion with session(s) ${collusion.join(', ')} — flagged for human review.`);
  }
  recommendationParts.push('Advisory only — hiring decisions are made by humans.');

  await prisma.sessionAssessment.upsert({
    where: { sessionId },
    create: {
      sessionId,
      totalScore,
      strengths,
      gaps,
      recommendation: recommendationParts.join(' '),
      flagSummary: {
        aiHigh,
        aiMedium,
        signals,
        collusion,
        ...(unscoredItemIds.size > 0 ? { unscoredItemIds: [...unscoredItemIds].sort() } : {}),
      } as unknown as Prisma.InputJsonValue,
    },
    update: {
      totalScore,
      strengths,
      gaps,
      recommendation: recommendationParts.join(' '),
      flagSummary: {
        aiHigh,
        aiMedium,
        signals,
        collusion,
        ...(unscoredItemIds.size > 0 ? { unscoredItemIds: [...unscoredItemIds].sort() } : {}),
      } as unknown as Prisma.InputJsonValue,
    },
  });
}

// ─── HR X-ray (PLAN §4 step 7, §9; docs/TESTING.md §6 #6 — HR-only) ──────────

/**
 * The full X-ray for one application: session meta, every presented question
 * with the candidate's answer, per-question evaluation (voided rows shown
 * WITH their void flag — the assessment holds the renormalized score), code
 * execution results, the signal rollup, and the session assessment.
 *
 * Scoped to the user's company (uniform 404, getDetail pattern). Evidence
 * arrays are empty until the session is SUBMITTED — the HR audit view opens
 * exactly when the candidate's view closes to "submitted".
 */
export async function getXray(user: AuthUser, applicationId: string) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: {
      id: true,
      stage: true,
      status: true,
      job: { select: { id: true, title: true, companyId: true } },
      candidate: { select: { id: true, name: true, email: true } },
      testSession: { select: { id: true, status: true, startedAt: true, submittedAt: true, deadlineAt: true } },
    },
  });
  if (!application || application.job.companyId !== user.companyId) {
    throw new AppError(404, 'Application not found', 'NOT_FOUND'); // no existence oracle
  }

  const session = application.testSession;
  const empty = {
    applicationId: application.id,
    job: { id: application.job.id, title: application.job.title },
    candidate: application.candidate,
    stage: application.stage,
    status: application.status,
    session: session
      ? {
          id: session.id,
          status: session.status,
          startedAt: session.startedAt,
          submittedAt: session.submittedAt,
          deadlineAt: session.deadlineAt,
        }
      : null,
    available: false, // no session yet, or not SUBMITTED — nothing to show
    questions: [],
    signals: { total: 0, byType: {} },
    assessment: null,
  };
  if (!session || session.status !== 'SUBMITTED') return empty;

  const [questions, signalRows, assessment] = await Promise.all([
    prisma.sessionQuestion.findMany({
      where: { sessionId: session.id },
      orderBy: { order: 'asc' },
      select: {
        order: true,
        format: true,
        itemId: true,
        presented: true,
        answer: { select: { content: true, revisions: true, firstAnsweredAt: true, lastAnsweredAt: true } },
        evaluation: {
          select: {
            verdict: true,
            score: true,
            method: true,
            detail: true,
            qualityNotes: true,
            aiLikelihood: true,
            aiReasoning: true,
            voided: true,
            createdAt: true,
          },
        },
        executionResult: {
          select: { exitCode: true, durationMs: true, truncated: true, stdout: true, stderr: true, caseResults: true },
        },
      },
    }),
    prisma.sessionSignal.findMany({ where: { sessionId: session.id }, select: { type: true } }),
    prisma.sessionAssessment.findUnique({ where: { sessionId: session.id } }),
  ]);

  const byType: Record<string, number> = {};
  for (const row of signalRows) byType[row.type] = (byType[row.type] ?? 0) + 1;

  return {
    ...empty,
    available: true,
    questions,
    signals: { total: signalRows.length, byType },
    assessment,
  };
}

// ─── Void with renormalization (PLAN §5.2 #7) ────────────────────────────────

/**
 * Voids a pool item ACROSS ALL sessions and re-normalizes every affected
 * SessionAssessment (totalScore recomputed over the remaining non-voided
 * questions). ADMIN-only — enforced by the route's requireRole('ADMIN').
 *
 * The item must have appeared in at least one session: the X-ray is where HR
 * discovers a flawed item, and that is the itemId this route takes; the jobId
 * is recovered from the item's sessions (items are server-minted UUIDs, so an
 * itemId unbacked by any session cannot be resolved to a job).
 */
export async function voidItem(user: AuthUser, itemId: string, reason: string) {
  const appeared = await prisma.sessionQuestion.findFirst({
    where: { itemId },
    select: { session: { select: { jobId: true, job: { select: { companyId: true } } } } },
  });
  if (!appeared) {
    throw new AppError(404, 'Item not found in any session', 'NOT_FOUND');
  }
  // Tenancy discipline (QA wave-8 F4): same 404 as every other route — an
  // itemId from another install's job is indistinguishable from nonexistent.
  if (appeared.session.job.companyId !== user.companyId) {
    throw new AppError(404, 'Item not found in any session', 'NOT_FOUND');
  }
  const jobId = appeared.session.jobId;

  let evaluationsVoided = 0;
  const voidedSessionIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    await tx.voidedItem.upsert({
      where: { itemId },
      create: { itemId, jobId, reason, voidedBy: user.id },
      update: { reason, voidedBy: user.id }, // re-void updates the audit trail
    });

    const affected = await tx.sessionQuestion.findMany({
      where: { itemId },
      select: { sessionId: true },
    });
    voidedSessionIds.push(...new Set(affected.map((row) => row.sessionId)));

    // Void every evaluation of this item first, so the recompute below (and
    // any concurrent reader) never mixes voided rows into a mean.
    const marked = await tx.evaluation.updateMany({
      where: { sessionQuestion: { itemId } },
      data: { voided: true },
    });
    evaluationsVoided = marked.count;

    for (const sessionId of voidedSessionIds) {
      // Immediate consistency inside the transaction: the mean excludes
      // voided rows for any concurrent reader.
      const remaining = await tx.evaluation.findMany({
        where: { sessionQuestion: { sessionId }, voided: false },
        select: { score: true },
      });
      const totalScore =
        remaining.length === 0 ? 0 : remaining.reduce((sum, e) => sum + e.score, 0) / remaining.length;
      await tx.sessionAssessment.upsert({
        where: { sessionId },
        create: { sessionId, totalScore },
        update: { totalScore },
      });
    }
  });

  // Full deterministic rollup AFTER the transaction commits (QA wave-8 F3):
  // writeAssessment recomputes strengths/gaps/recommendation/flagSummary over
  // the survivors for every affected session — stale rollup fields that still
  // reflected the voided item would mislead HR. Best-effort in full: a
  // failure here never undoes the void (the transaction already committed)
  // and the next evaluation re-run will rebuild the rollup anyway.
  try {
    const poolItems = await loadActivePoolItems(jobId);
    for (const sessionId of voidedSessionIds) {
      const questions = (await prisma.sessionQuestion.findMany({
        where: { sessionId },
        orderBy: { order: 'asc' },
        select: {
          id: true,
          order: true,
          format: true,
          itemId: true,
          answer: { select: { content: true, revisions: true, firstAnsweredAt: true, lastAnsweredAt: true } },
        },
      })) as QuestionRow[];
      await writeAssessment(sessionId, jobId, questions, poolItems, new Set());
    }
  } catch {
    // Rollup refresh is advisory; the void itself is already durable.
  }

  return { itemId, jobId, evaluationsVoided, sessionsRenormalized: voidedSessionIds.length };
}
