import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { requireSuperAdmin } from './platform.middleware';
import { getMainPrompt, putMainPrompt } from './settings.service';

// The MAIN (platform-wide) system-prompt tier (founder requirement: two-tier
// prompts). Nested into the /api/platform mount by platform.router.ts (same
// pattern as admin/auth-config.router.ts) so app.ts keeps one router per
// mount.
//
// GATE NOTE — this tiny router deliberately breaks the platform module's
// "every route is super-admin" rule on the READ side: the founder requirement
// says USERS CAN SEE BOTH prompts, so GET /main admits ANY authenticated user
// (company users read it via their job console). Only the PUT is root-only.

const router = Router();

/** PUT body — 0..8000 chars; '' means "no platform overlay". */
export const putMainPromptSchema = z.object({
  mainPrompt: z.string().max(8_000, 'mainPrompt must be at most 8000 characters'),
});

export type PutMainPromptInput = z.infer<typeof putMainPromptSchema>;

/** GET /api/platform/prompts/main — every authenticated user (visibility). */
router.get('/main', requireAuth, asyncHandler(async (_req, res) => {
  res.json({ mainPrompt: await getMainPrompt() });
}));

/** PUT /api/platform/prompts/main — super admin only; refreshes the 10s cache. */
router.put(
  '/main',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const input = putMainPromptSchema.parse(req.body);
    res.json(await putMainPrompt(input.mainPrompt));
  }),
);

export default router;
