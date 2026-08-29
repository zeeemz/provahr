import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { requireAuth, requireRole } from '../../middleware/auth';
import { getDetail, moveStage, changeStatus } from './applications.service';
import { moveStageSchema, changeStatusSchema } from './applications.schema';
import { listInterviewsForApplication, createInterview } from '../interviews/interviews.service';
import { createInterviewSchema } from '../interviews/interviews.schema';
import { getXray, voidItem } from './evaluation.service';
import { voidItemSchema } from './evaluation.schema';

const router = Router();

/** Application detail: candidate, history, interviews, scorecards. */
router.get('/:applicationId', requireAuth, asyncHandler(async (req, res) => {
  const application = await getDetail(req.user!, req.params.applicationId!);
  res.json({ application });
}));

/** Move an application between pipeline stages (recruiter and admin). */
router.patch(
  '/:applicationId/stage',
  requireAuth,
  requireRole('ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const { stage } = moveStageSchema.parse(req.body);
    const application = await moveStage(req.user!, req.params.applicationId!, stage);
    res.json({ application });
  }),
);

/** Reject / withdraw / reopen an application (recruiter and admin). */
router.post(
  '/:applicationId/status',
  requireAuth,
  requireRole('ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const { action, reason } = changeStatusSchema.parse(req.body);
    const application = await changeStatus(req.user!, req.params.applicationId!, action, reason);
    res.json({ application });
  }),
);

/** Interviews for an application. */
router.get('/:applicationId/interviews', requireAuth, asyncHandler(async (req, res) => {
  const interviews = await listInterviewsForApplication(req.user!, req.params.applicationId!);
  res.json({ interviews });
}));

/** Schedule an interview (recruiter and admin). */
router.post(
  '/:applicationId/interviews',
  requireAuth,
  requireRole('ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const input = createInterviewSchema.parse(req.body);
    const interview = await createInterview(req.user!, req.params.applicationId!, input);
    res.status(201).json({ interview });
  }),
);

// ── Phase 8: HR evaluation X-ray + item void (PLAN.md §4 step 7, §5.2 #7, §9) ──

/**
 * The asymmetric outcome, HR side (PLAN §12 D5): every answer, run, signal,
 * verdict and flag for a SUBMITTED session. Any company role — evidence is
 * read-only; flags never auto-act (PLAN §2.1). Candidate-visible surfaces
 * have no route to any of this (docs/TESTING.md §6 #6).
 */
router.get('/:applicationId/xray', requireAuth, asyncHandler(async (req, res) => {
  const xray = await getXray(req.user!, req.params.applicationId!);
  res.json({ xray });
}));

/**
 * Void a flawed item across ALL sessions + re-normalize scores (PLAN §5.2 #7).
 * ADMIN-only. NOTE (v1, documented): this lives under
 * /api/applications/admin/items/:itemId/void per the Phase 8 spec; PLAN §9
 * sketches /api/admin/items/:id/void — reconciled when the admin router is
 * consolidated (the applications mount keeps X-ray + void in one audit view).
 */
router.post(
  '/admin/items/:itemId/void',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { reason } = voidItemSchema.parse(req.body);
    const result = await voidItem(req.user!, req.params.itemId!, reason);
    res.json({ void: result });
  }),
);

export default router;
