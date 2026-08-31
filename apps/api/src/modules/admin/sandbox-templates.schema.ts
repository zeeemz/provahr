import { z } from 'zod';
import { CODE_LANGUAGES } from '../../lib/assessment/item';
import { MAX_IMAGE_REF_LENGTH, isSafeImageRef } from '../../lib/sandbox/templates';

// V2-4 (PLAN.md §12 D21): the PUT boundary is where an unsafe image ref is
// FIRST refused — the refine reuses the builder's own shape guard
// (isSafeImageRef), so what zod accepts here is exactly what buildRunArgs
// will accept at spawn time. The admin UI mirrors the same hint; the platform
// defaults are offered as placeholders.

/** Why an image ref was refused — shown by the admin UI verbatim. */
export const UNSAFE_IMAGE_MESSAGE =
  `Image must be a lowercase docker reference (registry/host, optional :port, path, optional :tag — ` +
  `letters, digits, dots, dashes, underscores, slashes), at most ${MAX_IMAGE_REF_LENGTH} characters. ` +
  `No uppercase, no flag characters, no digests.`;

export const putSandboxTemplateSchema = z.object({
  language: z.enum(CODE_LANGUAGES),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  image: z.string().trim().min(1).max(MAX_IMAGE_REF_LENGTH).refine(isSafeImageRef, {
    message: UNSAFE_IMAGE_MESSAGE,
  }),
  enabled: z.boolean(),
});

export type PutSandboxTemplateInput = z.infer<typeof putSandboxTemplateSchema>;
