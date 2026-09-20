import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { requireAuth, requireRole } from '../../middleware/auth';
import { candidateProfile } from './candidates.service';

const router = Router();

/**
 * The candidate's cross-role test profile (founder requirement 2026-09-21):
 * every application to this company, each test's outcome, and the aggregate.
 * Recruiter+ like the rest of the HR evidence surface; interviewers never
 * see it (the pipeline row remains their ceiling).
 */
router.get(
  '/:candidateId/profile',
  requireAuth,
  requireRole('ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const profile = await candidateProfile(req.user!, req.params.candidateId!);
    res.json(profile);
  }),
);

export default router;
