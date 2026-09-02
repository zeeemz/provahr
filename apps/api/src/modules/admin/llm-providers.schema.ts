import { z } from 'zod';

// Activation is deliberately NOT part of the update schema: exactly-one-active
// is an invariant, and the only path that changes it is POST /:id/activate.
export const createProviderSchema = z.object({
  kind: z.enum(['OPENAI_COMPATIBLE', 'ANTHROPIC', 'AZURE_OPENAI']),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(8).max(500),
  textModel: z.string().trim().min(1).max(200),
  visionModel: z.string().trim().min(1).max(200).optional(),
  isActive: z.boolean().default(false),
});

export const updateProviderSchema = z.object({
  baseUrl: z.string().url().optional(),
  // Absent = keep the existing key (never re-sent by clients that don't rotate it).
  apiKey: z.string().min(8).max(500).optional(),
  textModel: z.string().trim().min(1).max(200).optional(),
  visionModel: z.string().trim().min(1).max(200).optional(),
});

export type CreateProviderInput = z.infer<typeof createProviderSchema>;
export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;
