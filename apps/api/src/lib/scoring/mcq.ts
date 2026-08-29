// PURE classic-MCQ scoring (PLAN.md Phase 8; docs/TESTING.md T1). Exactly one
// option is correct (enforced at pool-seal time by assessmentItemSchema);
// scoring is therefore all-or-nothing: 1 or 0. No I/O, no clock, no database.
//
// UNANSWERED = WRONG (PLAN Phase 8 spec): a null answer scores 0.

/** Minimal item surface this scorer needs. */
export interface McqItemLike {
  options: Array<{ id: string }>;
  correctOptionId: string;
}

/** The answer shape persisted in `answers.content` for MCQ questions. */
export interface McqAnswerLike {
  optionId: string;
}

export interface McqScore {
  /** 1 when the selected option is the correct one, else 0. */
  score: number;
  correct: boolean;
}

/**
 * Scores a classic-MCQ answer: 1 iff `answer.optionId === item.correctOptionId`.
 * A null answer (no answer row / unanswered question) scores 0.
 */
export function scoreMcq(item: McqItemLike, answer: McqAnswerLike | null): McqScore {
  const correct = answer !== null && answer.optionId === item.correctOptionId;
  return { score: correct ? 1 : 0, correct };
}
