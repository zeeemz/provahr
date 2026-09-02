// PURE Swipe-MCQ scoring (PLAN.md §12 D14, docs/TESTING.md T1 + T8
// "scoring monotonicity: better valuations ⇒ score never decreases").
//
// A SWIPE_MCQ item presents 3–6 self-contained claims; the candidate likes or
// dislikes EACH one. Scoring is per option against the sealed pool's truth
// flags — partial credit by construction. No I/O, no clock, no database: the
// item and the answer come in, { score, hits } come out.
//
// UNANSWERED = WRONG: a skipped option is scored as a wrong valuation (PLAN
// Phase 8 spec) — liking/disliking everything or skipping cannot game the
// score, because the correct valuation for a true claim is LIKE and for a
// false claim DISLIKE, and silence matches neither.

/** The per-option answer shape persisted in `answers.content`. */
export type SwipeValuation = 'LIKE' | 'DISLIKE';

/** Minimal item surface this scorer needs (the sealed item carries more). */
export interface SwipeItemLike {
  options: Array<{ id: string; truth: boolean }>;
}

/** One option's judging record — persisted in `evaluations.detail.hits`. */
export interface SwipeHit {
  optionId: string;
  /** What the candidate valued — null when the option was left unanswered. */
  valuation: SwipeValuation | null;
  /** The pool's truth flag for the option. */
  truth: boolean;
  /** valuation === (truth ? 'LIKE' : 'DISLIKE'). */
  correct: boolean;
}

export interface SwipeScore {
  /** Fraction of options valued correctly — 0..1 (0 when the item has no options). */
  score: number;
  hits: SwipeHit[];
}

/**
 * Scores a swipe answer against the item's truth flags. `answer` maps
 * optionId → LIKE | DISLIKE and may be null (no answer row at all) or a
 * subset (options skipped during the session) — every missing valuation is
 * counted as wrong, so score = correct / total options.
 */
export function scoreSwipe(
  item: SwipeItemLike,
  answer: Record<string, SwipeValuation> | null,
): SwipeScore {
  const total = item.options.length;
  if (total === 0) return { score: 0, hits: [] };

  let correct = 0;
  const hits: SwipeHit[] = item.options.map((option) => {
    const valuation = answer?.[option.id] ?? null;
    const expected = option.truth ? 'LIKE' : 'DISLIKE';
    const isCorrect = valuation === expected;
    if (isCorrect) correct++;
    return { optionId: option.id, valuation, truth: option.truth, correct: isCorrect };
  });
  return { score: correct / total, hits };
}
