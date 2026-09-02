// PURE deterministic scoring (PLAN.md Phase 8; docs/TESTING.md T1, phase-8
// row: "Swipe-MCQ scoring incl. partial credit + revision semantics" and the
// T8 property "better valuations ⇒ score never decreases"). No mocks, no I/O.

import { describe, it, expect } from 'vitest';
import { scoreSwipe, type SwipeValuation } from '../src/lib/scoring/swipe';
import { scoreMcq } from '../src/lib/scoring/mcq';

// ─── Swipe MCQ (per-option partial credit against truth flags, D14) ──────────

/** Mixed-truth item (schema requires at least one true and one false claim). */
const SWIPE_ITEM = {
  options: [
    { id: 'a', truth: true },
    { id: 'b', truth: false },
    { id: 'c', truth: true },
    { id: 'd', truth: false },
  ],
};
const PERFECT_SWIPE: Record<string, SwipeValuation> = { a: 'LIKE', b: 'DISLIKE', c: 'LIKE', d: 'DISLIKE' };

describe('scoreSwipe', () => {
  it('scores a perfect valuing 1.0 with every hit correct', () => {
    const { score, hits } = scoreSwipe(SWIPE_ITEM, PERFECT_SWIPE);
    expect(score).toBe(1);
    expect(hits).toHaveLength(4);
    expect(hits.every((h) => h.correct)).toBe(true);
  });

  it('scores half-right exactly 0.5 (partial credit)', () => {
    const { score, hits } = scoreSwipe(SWIPE_ITEM, { a: 'LIKE', b: 'LIKE', c: 'DISLIKE', d: 'DISLIKE' });
    expect(score).toBe(0.5);
    expect(hits.map((h) => h.correct)).toEqual([true, false, false, true]);
  });

  it('scores the fully inverted valuing 0.0 (truth-inversion case)', () => {
    // Every valuation flipped: LIKE where DISLIKE was correct and vice versa.
    const inverted: Record<string, SwipeValuation> = { a: 'DISLIKE', b: 'LIKE', c: 'DISLIKE', d: 'LIKE' };
    const { score, hits } = scoreSwipe(SWIPE_ITEM, inverted);
    expect(score).toBe(0);
    expect(hits.every((h) => !h.correct)).toBe(true);
  });

  it('scores a null answer 0.0 — unanswered options count as wrong', () => {
    const { score, hits } = scoreSwipe(SWIPE_ITEM, null);
    expect(score).toBe(0);
    expect(hits.every((h) => h.valuation === null && !h.correct)).toBe(true);
  });

  it('counts skipped options as wrong inside an otherwise-perfect answer', () => {
    // Only 3 of 4 options valued — the skipped 'd' (truth=false) is wrong.
    const { score, hits } = scoreSwipe(SWIPE_ITEM, { a: 'LIKE', b: 'DISLIKE', c: 'LIKE' });
    expect(score).toBe(0.75);
    expect(hits.find((h) => h.optionId === 'd')).toMatchObject({ valuation: null, correct: false });
  });

  it('never rewards liking everything or disliking everything (mixed-truth guard)', () => {
    const allLike: Record<string, SwipeValuation> = { a: 'LIKE', b: 'LIKE', c: 'LIKE', d: 'LIKE' };
    const allDislike: Record<string, SwipeValuation> = { a: 'DISLIKE', b: 'DISLIKE', c: 'DISLIKE', d: 'DISLIKE' };
    expect(scoreSwipe(SWIPE_ITEM, allLike).score).toBe(0.5);
    expect(scoreSwipe(SWIPE_ITEM, allDislike).score).toBe(0.5);
  });

  it('records truth and valuation per hit for the HR detail view', () => {
    const { hits } = scoreSwipe(SWIPE_ITEM, { a: 'DISLIKE' });
    expect(hits.find((h) => h.optionId === 'a')).toEqual({
      optionId: 'a',
      valuation: 'DISLIKE',
      truth: true,
      correct: false,
    });
  });

  it('is monotone: fixing one valuation never lowers the score (T8 property)', () => {
    const partial: Record<string, SwipeValuation> = { a: 'LIKE', b: 'LIKE', c: 'DISLIKE', d: 'DISLIKE' };
    const better: Record<string, SwipeValuation> = { ...partial, c: 'LIKE' }; // one more correct valuation
    expect(scoreSwipe(SWIPE_ITEM, better).score).toBeGreaterThanOrEqual(scoreSwipe(SWIPE_ITEM, partial).score);
  });

  it('returns 0 for a degenerate optionless item instead of dividing by zero', () => {
    expect(scoreSwipe({ options: [] }, null)).toEqual({ score: 0, hits: [] });
  });
});

// ─── Classic MCQ (all-or-nothing) ─────────────────────────────────────────────

const MCQ_ITEM = {
  options: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  correctOptionId: 'a',
};

describe('scoreMcq', () => {
  it('scores the exact correct option 1', () => {
    expect(scoreMcq(MCQ_ITEM, { optionId: 'a' })).toEqual({ score: 1, correct: true });
  });

  it('scores a wrong option 0 — no partial credit', () => {
    expect(scoreMcq(MCQ_ITEM, { optionId: 'b' })).toEqual({ score: 0, correct: false });
    expect(scoreMcq(MCQ_ITEM, { optionId: 'c' })).toEqual({ score: 0, correct: false });
  });

  it('scores a null answer 0 — unanswered counts as wrong', () => {
    expect(scoreMcq(MCQ_ITEM, null)).toEqual({ score: 0, correct: false });
  });

  it('matches on the correctOptionId exactly, not by option position', () => {
    const reordered = { options: [{ id: 'z' }, { id: 'a' }, { id: 'q' }], correctOptionId: 'a' };
    expect(scoreMcq(reordered, { optionId: 'a' }).score).toBe(1);
    expect(scoreMcq(reordered, { optionId: 'z' }).score).toBe(0);
  });
});
