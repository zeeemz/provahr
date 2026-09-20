// Immediate candidate-facing marking (founder decision 2026-09-21).
//
// At submission the candidate now sees deterministic marking for the
// OBJECTIVE formats — MCQ (all-or-nothing) and SWIPE_MCQ (partial credit) —
// computed live from the sealed pool's truth data. Open formats stay opaque:
// WRITTEN awaits LLM/recruiter evaluation and CODE awaits sandbox execution
// (both land in the HR X-ray only). This deliberately amends the strict
// "submitted ✓ and nothing else" asymmetry for the objective half — the
// marking reveals only what a finished, single-use session may safely reveal
// (the pool is ≥6× the draw and re-sealing ages any leak out).
//
// POOL DECRYPTION SITE #3 (documented, sanctioned): the ACTIVE pool is
// decrypted ONCE per marking read via the shared loader (evaluation.service
// loadActivePoolItems) to recover correctOptionId / truth flags. Never
// rubrics, never hidden cases, never the full items blob to the client.
//
// Fairness policies mirror the evaluation run: items missing from the active
// pool (re-seal drift) are NEVER marked wrong — they surface as
// PENDING_EVALUATION and the HR X-ray carries the honest unscored note; items
// voided by HR are NOT_COUNTED for anyone.

import { prisma } from '../../prisma';
import { AppError } from '../../lib/http';
import { hashTestToken, isTokenShapeValid } from '../../lib/testTokens';
import { scoreSwipe } from '../../lib/scoring/swipe';
import { scoreMcq } from '../../lib/scoring/mcq';
import { loadActivePoolItems } from '../applications/evaluation.service';

export interface MarkedItem {
  order: number;
  format: string;
  status: 'MARKED' | 'PENDING_EVALUATION' | 'NOT_COUNTED';
  /** MARKED only — the deterministic outcome. */
  correct?: boolean;
  score?: number;
  /** MCQ only: what was picked vs what was right (feedback is the point). */
  selectedOptionId?: string | null;
  correctOptionId?: string | null;
}

export interface MarkingView {
  items: MarkedItem[];
  summary: { marked: number; correct: number; partial: number };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Objective marking for a SUBMITTED session, by plain token. Token-gated like
 * every session endpoint: shape check first, hash-only lookup, uniform 404.
 */
export async function objectiveMarking(token: string): Promise<MarkingView> {
  if (!isTokenShapeValid(token)) {
    throw new AppError(404, 'Test link not found', 'NOT_FOUND');
  }
  const session = await prisma.testSession.findUnique({
    where: { tokenHash: hashTestToken(token) },
    select: { id: true, status: true, jobId: true },
  });
  if (!session) {
    throw new AppError(404, 'Test link not found', 'NOT_FOUND');
  }
  if (session.status !== 'SUBMITTED') {
    throw new AppError(409, 'Marking is available after the test is submitted', 'SESSION_NOT_SUBMITTED');
  }

  const questions = await prisma.sessionQuestion.findMany({
    where: { sessionId: session.id },
    orderBy: { order: 'asc' },
    select: { order: true, format: true, itemId: true, answer: { select: { content: true } } },
  });

  const poolItems = await loadActivePoolItems(session.jobId);
  const voidedRows = await prisma.voidedItem.findMany({
    where: { jobId: session.jobId },
    select: { itemId: true },
  });
  const voidedItemIds = new Set(voidedRows.map((r) => r.itemId));

  const items: MarkedItem[] = [];
  let marked = 0;
  let correct = 0;
  let partial = 0;

  for (const q of questions) {
    if (voidedItemIds.has(q.itemId)) {
      items.push({ order: q.order, format: q.format, status: 'NOT_COUNTED' });
      continue;
    }
    const item = poolItems.get(q.itemId);
    // Open formats, and drifted items with no recoverable truth, stay opaque.
    // Branching on item.format (not q.format) lets the AssessmentItem union
    // narrow — the two agree by construction at draw time.
    if (!item || (item.format !== 'MCQ' && item.format !== 'SWIPE_MCQ')) {
      items.push({ order: q.order, format: q.format, status: 'PENDING_EVALUATION' });
      continue;
    }

    if (item.format === 'MCQ') {
      const selected =
        isPlainObject(q.answer?.content) && typeof (q.answer!.content as Record<string, unknown>).optionId === 'string'
          ? { optionId: (q.answer!.content as Record<string, unknown>).optionId as string }
          : null;
      const outcome = scoreMcq(item, selected);
      items.push({
        order: q.order,
        format: item.format,
        status: 'MARKED',
        correct: outcome.correct,
        score: outcome.score,
        selectedOptionId: selected?.optionId ?? null,
        correctOptionId: item.correctOptionId,
      });
      marked++;
      if (outcome.correct) correct++;
    } else {
      const content = isPlainObject(q.answer?.content)
        ? (q.answer!.content as unknown as Record<string, 'LIKE' | 'DISLIKE'>)
        : null;
      const { score } = scoreSwipe(item, content);
      items.push({ order: q.order, format: item.format, status: 'MARKED', correct: score === 1, score });
      marked++;
      if (score === 1) correct++;
      else if (score > 0) partial++;
    }
  }

  return { items, summary: { marked, correct, partial } };
}
