// Prompts for the Phase 8 evaluation LLM passes (PLAN.md §4 loop step 6,
// §8 Evaluation) — written-answer grading and code quality review. Pure string
// builders: no imports beyond node-free vocabulary, no side effects.
//
// OUTPUT SHAPE (same discipline as prompts/pool.ts): `jsonMode` requires a
// top-level JSON OBJECT on every adapter, so both system prompts demand a
// single strict JSON object with exact keys.
//
// UNTRUSTED INPUT: answer text / code and rubrics travel inside delimited
// blocks whose markers are neutralized (QA wave-4 F6 pattern) so embedded
// "=== ANSWER END ===" strings cannot forge a boundary and smuggle
// instructions.
//
// AI-LIKELIHOOD POLICY (PLAN §2.1, §12 D2 — the LAW): aiLikelihood is a signal
// for a HUMAN reviewer, never a decision. The prompts judge only whether the
// TEXT looks human-composed given the time/revision signals provided; the
// platform never auto-rejects on it.

import type { CodeLanguage } from '../lib/assessment/item';

// ─── Written answers ──────────────────────────────────────────────────────────

export const WRITTEN_SYSTEM_PROMPT = `You are a rigorous but fair hiring-test grader evaluating a candidate's WRITTEN answer.
The candidate wrote this answer live, in a time-boxed proctored test. Grade what is on the page.

Rules you must never break:
1. Output STRICT JSON and nothing else — no markdown fences, no commentary. The response is a single JSON object with EXACTLY these keys:
   {"verdict":"CORRECT|PARTIAL|INCORRECT","score":0.0-1.0,"review":"markdown","aiLikelihood":"LOW|MEDIUM|HIGH","aiReasoning":"short text"}
2. Ground the verdict and score in the RUBRIC given in the user message. The rubric lists concrete, checkable points; count how many the answer actually covers. All points covered ⇒ CORRECT/score 1; some ⇒ PARTIAL with a proportional score; none or off-topic ⇒ INCORRECT/score 0.
3. score is a number between 0 and 1 consistent with verdict: CORRECT = 0.8-1.0, PARTIAL = 0.2-0.8, INCORRECT = 0-0.2.
4. review is concise markdown (max ~150 words) for the HR reviewer: which rubric points are covered, which are missing, and any factual errors. Quote nothing longer than a phrase.
5. aiLikelihood judges whether the TEXT looks human-composed GIVEN the time and revision signals provided in the user message. Consider: length vs seconds available (a 400-word polished essay in 40 seconds is suspicious), tell-tale LLM phrasing (bullet-point perfection, hedging boilerplate, "As a ..."), and revision count. LOW = looks human; MEDIUM = ambiguous; HIGH = strongly suggests external generation. When signals are missing or inconclusive, choose LOW — an unexplained flag is worse than a missed hint.
6. aiReasoning (max ~60 words) explains the aiLikelihood call, citing the concrete signals. Empty string is fine for LOW.
7. You are producing a FLAG for a human, not a verdict on the candidate. Never recommend hiring or rejecting; grading and flagging only.`;

/** Strips the delimiter markers from untrusted text so boundaries cannot be forged. */
function neutralize(text: string, cap: number): string {
  return (
    text
      .slice(0, cap)
      .replace(/={2,}\s*(ANSWER|RUBRIC|QUESTION|CODE|CASE RESULTS?)\s*(START|END)\s*={2,}/gi, '[marker removed]')
      .trim() || '(empty)'
  );
}

export interface WrittenPromptInput {
  prompt: string;
  rubric: string;
  answerText: string;
  /** Seconds between first and last save of this answer (0 when unknown). */
  secondsSpent: number;
  /** Review-pass revision count for this answer. */
  revisions: number;
}

/** Builds the user message for grading one WRITTEN answer. Pure. */
export function buildWrittenPrompt(input: WrittenPromptInput): string {
  return [
    'Grade this written answer against its rubric.',
    '',
    '=== QUESTION START ===',
    neutralize(input.prompt, 4_000),
    '=== QUESTION END ===',
    '',
    '=== RUBRIC START ===',
    neutralize(input.rubric, 2_000),
    '=== RUBRIC END ===',
    '',
    '=== ANSWER START ===',
    neutralize(input.answerText, 12_000),
    '=== ANSWER END ===',
    '',
    'Session signals for this answer:',
    `- Seconds spent (first to last save): ${input.secondsSpent}`,
    `- Revisions during the review pass: ${input.revisions}`,
    '',
    'Respond with the strict JSON object now.',
  ].join('\n');
}

// ─── Code quality review ──────────────────────────────────────────────────────

export const CODE_SYSTEM_PROMPT = `You are a senior engineer reviewing a candidate's test-submitted code for a hiring evaluation.
Deterministic hidden-case results are ALREADY computed and provided to you — your review is a QUALITY and HONESTY layer on top, never a re-run.

Rules you must never break:
1. Output STRICT JSON and nothing else — no markdown fences, no commentary. The response is a single JSON object with EXACTLY these keys:
   {"review":"markdown","aiLikelihood":"LOW|MEDIUM|HIGH","aiReasoning":"short text"}
2. review is concise markdown (max ~150 words) for the HR reviewer: code quality (structure, naming, error handling), how it achieves (or fails) the task, and anything a grader should double-check. Do NOT restate every case result.
3. aiLikelihood judges whether the CODE looks human-composed GIVEN the time and revision signals provided. Consider: length/complexity vs seconds available, tell-tale generated-code patterns (over-commenting, boilerplate error handling far beyond task scope, library imports the task never mentioned), and revision count. LOW = looks human; MEDIUM = ambiguous; HIGH = strongly suggests external generation. When signals are missing or inconclusive, choose LOW — an unexplained flag is worse than a missed hint.
4. aiReasoning (max ~60 words) explains the aiLikelihood call, citing concrete signals. Empty string is fine for LOW.
5. You are producing a FLAG for a human, not a verdict on the candidate. Never recommend hiring or rejecting; review and flag only.`;

export interface CodeReviewPromptInput {
  prompt: string;
  language: CodeLanguage;
  code: string;
  /** Per-case outcomes from the sandbox run (only name/passed/note are used). */
  caseOutcomes: ReadonlyArray<{ name: string; passed: boolean; note?: string }>;
  /** Seconds between first and last save of this answer (0 when unknown). */
  secondsSpent: number;
  /** Review-pass revision count for this answer. */
  revisions: number;
}

/** Builds the user message for reviewing one CODE answer. Pure. */
export function buildCodeReviewPrompt(input: CodeReviewPromptInput): string {
  const caseLines = input.caseOutcomes.map(
    (c) => `- ${c.name}: ${c.passed ? 'PASS' : 'FAIL'}${c.note ? ` (${c.note})` : ''}`,
  );
  return [
    'Review this test-submitted code. The hidden-case results below are already final — describe quality, do not re-judge correctness.',
    '',
    '=== QUESTION START ===',
    neutralize(input.prompt, 4_000),
    '=== QUESTION END ===',
    '',
    `Language: ${input.language}`,
    '',
    '=== CODE START ===',
    neutralize(input.code, 12_000),
    '=== CODE END ===',
    '',
    '=== CASE RESULTS START ===',
    ...(caseLines.length > 0 ? caseLines : ['- (no cases ran)']),
    '=== CASE RESULTS END ===',
    '',
    'Session signals for this answer:',
    `- Seconds spent (first to last save): ${input.secondsSpent}`,
    `- Revisions during the review pass: ${input.revisions}`,
    '',
    'Respond with the strict JSON object now.',
  ].join('\n');
}
