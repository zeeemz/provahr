// Zod schemas for the Phase 5 candidate session endpoints (PLAN.md §9 public
// test routes). Format-level answer validation lives in the service — it needs
// the question's `presented` view (option ids) which no schema can know.

import { z } from 'zod';

/** The proctoring signal vocabulary (PLAN.md §4 loop step 4, §8 SessionSignal).
 *  CODE_RUN (2026-10): the candidate executed their own code via the IDE Run
 *  button — evidence of live iteration, not suspicion. */
export const SIGNAL_TYPES = [
  'TAB_SWITCH',
  'APP_BACKGROUND',
  'BLUR',
  'LARGE_PASTE',
  'COPY',
  'TIMING_ANOMALY',
  'CODE_RUN',
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

/** POST /test/:token/start takes no body — the token in the path is the input. */
export const startSchema = z.object({});

/** POST /test/:token/answers — one question per call; content is format-checked in the service. */
export const answerSchema = z.object({
  order: z.number().int().min(1),
  content: z.unknown(),
});

/** POST /test/:token/run (IDE Run button): execute the SAVED code for this
 *  question with the candidate's own args. Args mirror the hidden-case shape
 *  (argv tokens); stdin stays a v1 sandbox limitation. */
export const runSchema = z.object({
  order: z.number().int().min(1),
  args: z.array(z.string().min(1).max(1_000)).max(10).optional(),
});

/** GET /test/:token/runs query — optionally scoped to one question. */
export const runsQuerySchema = z.object({
  order: z.coerce.number().int().min(1).optional(),
});

const signalDetailSchema = z
  .record(z.unknown())
  .refine((detail) => Object.keys(detail).length <= 5, {
    message: 'Signal detail may carry at most 5 keys',
  });

/** POST /test/:token/signals — batched client-flushed proctoring events. */
export const signalsSchema = z.object({
  signals: z
    .array(
      z.object({
        type: z.enum(SIGNAL_TYPES),
        at: z.coerce.date(),
        detail: signalDetailSchema.optional(),
      }),
    )
    .max(100),
});

export type AnswerInput = z.infer<typeof answerSchema>;
export type SignalsInput = z.infer<typeof signalsSchema>;
export type RunInput = z.infer<typeof runSchema>;
