import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { requireAuth, requireRole } from '../../middleware/auth';
import { activityFeed } from './activity.service';

const router = Router();

/**
 * Live background-work feed for the caller's company — what the async worker
 * (JD drafts, sample previews, pool seals, evaluations) is doing right now.
 * Recruiter+ like the rest of the HR surface; interviewers never see it.
 */
router.get(
  '/',
  requireAuth,
  requireRole('ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const raw = req.query.limit;
    const limit = raw === undefined || raw === '' ? undefined : Number(raw);
    const feed = await activityFeed(req.user!, limit);
    res.json(feed);
  }),
);

export default router;
