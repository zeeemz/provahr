// Zod schemas for the test-blueprint endpoints (PLAN.md Phase 3, §5).
//
// The blueprint is the ONLY test-shape HR controls (topics, format mix,
// counts, difficulty, time limit) — by construction it can carry no question,
// so nothing here has a free-text field an item could hide in.

import { z } from 'zod';
import { blueprintSectionSchema } from '../../lib/assessment/item';

/**
 * SWIPE_MCQ is paused for NEW test creation (founder request 2026-10-05) —
 * flip this flag to re-offer it. The pause only gates what a newly SAVED
 * blueprint may request: existing sealed pools and sessions that contain
 * swipe items keep working end-to-end (draw, immediate marking, evaluation,
 * X-ray) and are never touched by this check.
 */
export const SWIPE_DISABLED_FOR_NEW_TESTS = true;

/** PUT /api/jobs/:jobId/blueprint body. 1-6 sections, 10-180 minute clock. */
export const putBlueprintSchema = z
  .object({
    sections: z.array(blueprintSectionSchema).min(1).max(6),
    timeLimitMin: z.number().int().min(10).max(180),
  })
  .superRefine((body, ctx) => {
    if (!SWIPE_DISABLED_FOR_NEW_TESTS) return;
    body.sections.forEach((s, i) => {
      if ((s.formats.SWIPE_MCQ ?? 0) > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sections', i, 'formats', 'SWIPE_MCQ'],
          message:
            'SWIPE (like/dislike) is temporarily disabled for new tests — use MCQ, WRITTEN or CODE. Tests that already contain swipe are unaffected.',
        });
      }
    });
  });

export type PutBlueprintInput = z.infer<typeof putBlueprintSchema>;

/**
 * No-body schema for the 202-generating routes (samples / seal / reseal) —
 * same shape as `approveSchema` in jd.schema.ts.
 */
export const samplesRequestSchema = z.object({}).optional();
