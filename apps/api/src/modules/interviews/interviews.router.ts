import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { requireAuth, requireRole } from '../../middleware/auth';
import { updateInterview, submitScorecard } from './interviews.service';
import { updateInterviewSchema, scorecardSchema } from './interviews.schema';

const router = Router();

/** Update an interview (reschedule, reassign, change status). */
router.patch(
  '/:interviewId',
  requireAuth,
  requireRole('ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const input = updateInterviewSchema.parse(req.body);
    const interview = await updateInterview(req.user!, req.params.interviewId!, input);
    res.json({ interview });
  }),
);

/** Submit a scorecard for an interview (any company member can be the author). */
router.post(
  '/:interviewId/scorecard',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = scorecardSchema.parse(req.body);
    const scorecard = await submitScorecard(req.user!, req.params.interviewId!, input);
    res.status(201).json({ scorecard });
  }),
);

export default router;
