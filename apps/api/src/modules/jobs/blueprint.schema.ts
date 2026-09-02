// Zod schemas for the test-blueprint endpoints (PLAN.md Phase 3, §5).
//
// The blueprint is the ONLY test-shape HR controls (topics, format mix,
// counts, difficulty, time limit) — by construction it can carry no question,
// so nothing here has a free-text field an item could hide in.

import { z } from 'zod';
import { blueprintSectionSchema } from '../../lib/assessment/item';

/** PUT /api/jobs/:jobId/blueprint body. 1-6 sections, 10-180 minute clock. */
export const putBlueprintSchema = z.object({
  sections: z.array(blueprintSectionSchema).min(1).max(6),
  timeLimitMin: z.number().int().min(10).max(180),
});

export type PutBlueprintInput = z.infer<typeof putBlueprintSchema>;

/**
 * No-body schema for the 202-generating routes (samples / seal / reseal) —
 * same shape as `approveSchema` in jd.schema.ts.
 */
export const samplesRequestSchema = z.object({}).optional();
