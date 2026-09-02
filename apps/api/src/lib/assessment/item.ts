// The canonical assessment-item vocabulary (PLAN.md Phase 3 + §5).
//
// Everything that touches a question speaks this one vocabulary: validation at
// the LLM boundary (sample preview + pool sealing), the sealed-pool size math
// (§5.2 mechanism 1: pool >= 6x the draw size), and — Phase 5 — the
// per-session draw + variant realization.
//
// Items live in exactly three places: encrypted inside
// `sealed_question_pools.itemsEncrypted` (decrypted only at the sanctioned
// session-start draw site), realized
// as session questions at draw time, and — PREVIEW-ONLY, never drawn — in
// `sample_items`. No API endpoint returns pool items to any role.

import { randomUUID } from 'node:crypto';
import { z } from 'zod';

// ─── Question vocabulary ──────────────────────────────────────────────────────

export type QuestionFormat = 'SWIPE_MCQ' | 'MCQ' | 'WRITTEN' | 'CODE';

/** Every format in stable order — round-robin generation and tests rely on it. */
export const QUESTION_FORMATS: readonly QuestionFormat[] = ['SWIPE_MCQ', 'MCQ', 'WRITTEN', 'CODE'] as const;

export const QUESTION_DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
export type QuestionDifficulty = (typeof QUESTION_DIFFICULTIES)[number];

export const CODE_LANGUAGES = ['BASH', 'NODE', 'PYTHON'] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

/** Server-assigned item id. The LLM never mints ids — the worker stamps them. */
export function newItemId(): string {
  return randomUUID();
}

// ─── Item schemas ─────────────────────────────────────────────────────────────

// Short stable option ids ('a', 'b', ...) — answers reference them.
const shortId = z.string().trim().min(1).max(12);
const optionText = z.string().trim().min(1).max(500);

/** SWIPE_MCQ option: a self-contained claim the candidate likes/dislikes. */
export const swipeOptionSchema = z.object({
  id: shortId,
  text: optionText,
  truth: z.boolean(),
});

/** Classic MCQ option: correctness lives on the item (`correctOptionId`). */
export const mcqOptionSchema = z.object({
  id: shortId,
  text: optionText,
});

/**
 * Hidden sandbox case for CODE items (PLAN.md §5.2 mechanism 3): graded via
 * stdout and/or exit code against inputs the candidate has never seen.
 * `args`/`stdin` feed the program; the expectations judge it.
 */
export const hiddenCaseSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    stdin: z.string().max(5_000).optional(),
    args: z.array(z.string().max(1_000)).max(10).optional(),
    expectedStdout: z.string().max(5_000).optional(),
    expectedExit: z.number().int().min(0).max(255).optional(),
  })
  .refine((c) => c.expectedStdout !== undefined || c.expectedExit !== undefined, {
    message: 'A hidden case must expect something (expectedStdout and/or expectedExit)',
    path: [],
  });

const promptText = z.string().trim().min(10).max(2_000);
const topicsSchema = z.array(z.string().trim().min(2).max(60)).min(1).max(3);
const difficultySchema = z.enum(QUESTION_DIFFICULTIES);
const itemId = z.string().min(1);

// NOTE: cross-field rules (SWIPE truth mix, MCQ correctOptionId) live in a
// union-level superRefine below — discriminatedUnion members must stay plain
// ZodObjects or zod cannot extract the discriminator.
const swipeMcqItem = z.object({
  id: itemId,
  format: z.literal('SWIPE_MCQ'),
  prompt: promptText,
  options: z.array(swipeOptionSchema).min(3).max(6),
  difficulty: difficultySchema,
  topics: topicsSchema,
});

const mcqItem = z.object({
  id: itemId,
  format: z.literal('MCQ'),
  prompt: promptText,
  options: z.array(mcqOptionSchema).min(3).max(6),
  correctOptionId: shortId,
  difficulty: difficultySchema,
  topics: topicsSchema,
});

const writtenItem = z.object({
  id: itemId,
  format: z.literal('WRITTEN'),
  prompt: promptText,
  rubric: z.string().trim().min(20).max(1_000),
  difficulty: difficultySchema,
  topics: topicsSchema,
});

const codeItem = z.object({
  id: itemId,
  format: z.literal('CODE'),
  prompt: promptText,
  language: z.enum(CODE_LANGUAGES),
  starterCode: z.string().max(5_000).optional(),
  hiddenCases: z.array(hiddenCaseSchema).min(2).max(5),
  difficulty: difficultySchema,
  topics: topicsSchema,
});

/**
 * One assessment item in any of the four v1 formats (PLAN.md §12 D4). This is
 * the shape sealed inside the pool AND the shape drawn into sessions; the
 * only difference at draw time is per-session variant parameters (Phase 5).
 */
export const assessmentItemSchema = z
  .discriminatedUnion('format', [swipeMcqItem, mcqItem, writtenItem, codeItem])
  .superRefine((item, ctx) => {
    if (item.format === 'SWIPE_MCQ') {
      // Scored per option against truth flags — a one-sided option set would
      // make liking (or disliking) everything the winning strategy.
      const hasTrue = item.options.some((o) => o.truth);
      const hasFalse = item.options.some((o) => !o.truth);
      if (!hasTrue || !hasFalse) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['options'],
          message: 'SWIPE_MCQ options must mix true and false claims (at least one of each)',
        });
      }
      // Duplicate option ids would make like/dislike and scoring ambiguous
      // (QA wave-4 F2).
      if (new Set(item.options.map((o) => o.id)).size !== item.options.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['options'],
          message: 'SWIPE_MCQ option ids must be unique',
        });
      }
    }
    if (item.format === 'MCQ') {
      if (!item.options.some((o) => o.id === item.correctOptionId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['correctOptionId'],
          message: 'correctOptionId must match one of the option ids',
        });
      }
      if (new Set(item.options.map((o) => o.id)).size !== item.options.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['options'],
          message: 'MCQ option ids must be unique',
        });
      }
    }
  });

export type AssessmentItem = z.infer<typeof assessmentItemSchema>;

// ─── Blueprint sections ───────────────────────────────────────────────────────

/** One section of a test blueprint — WHAT to cover, never a question. */
export interface BlueprintSection {
  title?: string;
  topics: string[];
  formats: Partial<Record<QuestionFormat, number>>;
  difficultyMix?: 'EASY_HEAVY' | 'BALANCED' | 'HARD_HEAVY';
}

const formatCount = z.number().int().min(1).max(10);

const formatsShape: { [K in QuestionFormat]: z.ZodOptional<typeof formatCount> } = {
  SWIPE_MCQ: formatCount.optional(),
  MCQ: formatCount.optional(),
  WRITTEN: formatCount.optional(),
  CODE: formatCount.optional(),
};

export const blueprintSectionSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  topics: z.array(z.string().trim().min(2).max(60)).min(1).max(5),
  formats: z.object(formatsShape).refine((f) => QUESTION_FORMATS.some((fmt) => (f[fmt] ?? 0) > 0), {
    message: 'At least one format with a count of 1 or more is required',
    path: ['formats'],
  }),
  difficultyMix: z.enum(['EASY_HEAVY', 'BALANCED', 'HARD_HEAVY']).optional(),
});

// ─── Pool math (pure — PLAN.md §5.2 mechanism 1) ─────────────────────────────

/** Sums the blueprint's per-format counts: how many items a session DRAWS. */
export function drawSizes(blueprint: { sections: BlueprintSection[] }): Record<QuestionFormat, number> {
  const out: Record<QuestionFormat, number> = { SWIPE_MCQ: 0, MCQ: 0, WRITTEN: 0, CODE: 0 };
  for (const section of blueprint.sections) {
    for (const format of QUESTION_FORMATS) {
      out[format] += section.formats[format] ?? 0;
    }
  }
  return out;
}

/**
 * How many items the sealed pool must HOLD per format: draw size x multiplier
 * (default 6). A session's random draw can never exhaust the pool's variety,
 * and no candidate's set reveals another's.
 */
export function requiredPoolSizes(
  draw: Record<QuestionFormat, number>,
  multiplier = 6,
): Record<QuestionFormat, number> {
  const out: Record<QuestionFormat, number> = { SWIPE_MCQ: 0, MCQ: 0, WRITTEN: 0, CODE: 0 };
  for (const format of QUESTION_FORMATS) {
    out[format] = draw[format] * multiplier;
  }
  return out;
}

/** Tallies a set of items per format (zeros for absent formats). */
export function countByFormat(items: AssessmentItem[]): Record<QuestionFormat, number> {
  const out: Record<QuestionFormat, number> = { SWIPE_MCQ: 0, MCQ: 0, WRITTEN: 0, CODE: 0 };
  for (const item of items) {
    out[item.format] += 1;
  }
  return out;
}

/**
 * Checks a candidate pool against the blueprint: counts items per format vs
 * the required (>= 6x draw) sizes. `shortfalls[f]` is how many MORE items of
 * format f are needed; `ok` is true iff every shortfall is zero.
 */
export function poolSatisfiesBlueprint(
  items: AssessmentItem[],
  blueprint: { sections: BlueprintSection[] },
): { ok: boolean; shortfalls: Partial<Record<QuestionFormat, number>> } {
  const required = requiredPoolSizes(drawSizes(blueprint));
  const counts = countByFormat(items);
  const shortfalls: Partial<Record<QuestionFormat, number>> = {};
  let ok = true;
  for (const format of QUESTION_FORMATS) {
    const missing = required[format] - counts[format];
    if (missing > 0) {
      shortfalls[format] = missing;
      ok = false;
    }
  }
  return { ok, shortfalls };
}
