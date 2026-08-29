import { z } from 'zod';

/**
 * POST /api/applications/admin/items/:itemId/void — an admin voiding a flawed
 * item across all sessions (PLAN.md §5.2 #7). A reason is mandatory, mirroring
 * the fair-hiring rejection rule: every irreversible, candidate-affecting
 * action must carry a human explanation.
 */
export const voidItemSchema = z.object({
  reason: z.string().trim().min(3, 'A void reason is required (fair-hiring policy)').max(1000),
});

export type VoidItemInput = z.infer<typeof voidItemSchema>;
