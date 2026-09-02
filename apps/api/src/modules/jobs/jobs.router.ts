import express, { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http';
import { requireAuth, requireRole } from '../../middleware/auth';
import {
  listJobs,
  getJob,
  createJob,
  updateJob,
  deleteJob,
  setJobStatus,
} from './jobs.service';
import {
  createJobSchema,
  updateJobSchema,
  listJobsQuerySchema,
  setJobStatusSchema,
} from './jobs.schema';
import { listForJob } from '../applications/applications.service';
import { listApplicationsQuerySchema } from '../applications/applications.schema';
import { createIntake, getJd, editDraft, approveJd, getJobPrompt, putJobPrompt } from './jd.service';
import { intakeSchema, editDraftSchema, approveSchema } from './jd.schema';
import {
  putBlueprint,
  getBlueprint,
  requestSamples,
  getSamples,
  sealPool,
  resealPool,
  getPool,
} from './blueprint.service';
import { putBlueprintSchema, samplesRequestSchema } from './blueprint.schema';

const router = Router();

/** List the company's jobs (optionally filtered). */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const filters = listJobsQuerySchema.parse(req.query);
  const jobs = await listJobs(req.user!, filters);
  res.json({ jobs });
}));

/** Create a job (recruiter and admin). */
router.post(
  '/',
  requireAuth,
  requireRole('ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const input = createJobSchema.parse(req.body);
    const job = await createJob(req.user!, input);
    res.status(201).json({ job });
  }),
);

// Role intake → JD generation (PLAN.md Phase 2). Mounted BEFORE the /:jobId
// routes so '/intake' is not captured by the parameterized paths below.
// Route-scoped body parser: screenshots are base64 and blow past the app's
// 1mb default (the global parser skips this path — QA wave-3 F2).
router.post(
  '/intake',
  express.json({ limit: '16mb' }),
  requireAuth,
  requireRole('ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const input = intakeSchema.parse(req.body);
    const { job, queued } = await createIntake(req.user!, input);
    res.status(201).json({ job, queued });
  }),
);

/** JD status / draft view for an intake job. */
router.get(
  '/:jobId/jd',
  requireAuth,
  requireRole('ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const jd = await getJd(req.user!, req.params.jobId!);
    res.json({ jd });
  }),
);

/** HR edits the generated draft (only while it is in review). */
router.patch(
  '/:jobId/jd',
  requireAuth,
  requireRole('ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const patch = editDraftSchema.parse(req.body);
    const draft = await editDraft(req.user!, req.params.jobId!, patch);
    res.json({ draft });
  }),
);

/** HR approves the draft — its fields become the job's fields. */
router.post(
  '/:jobId/jd/approve',
  requireAuth,
  requireRole('ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    approveSchema.parse(req.body);
    const job = await approveJd(req.user!, req.params.jobId!);
    res.json({ job });
  }),
);

// ── Job-specific prompt tier (founder requirement: two-tier prompts) ─────
// The role-specific overlay HR writes for THIS job; the platform MAIN prompt
// comes back read-only for display (only the super admin can edit that one,
// via PUT /api/platform/prompts/main).

/** PUT body — 0..8000 chars; null clears the overlay. */
const putJobPromptSchema = z.object({
  jobPrompt: z.string().max(8_000, 'jobPrompt must be at most 8000 characters').nullable(),
});

/** The role-specific prompt (+ the platform main prompt, read-only). */
router.get(
  '/:jobId/prompt',
  requireAuth,
  asyncHandler(async (req, res) => {
    const view = await getJobPrompt(req.user!, req.params.jobId!);
    res.json(view);
  }),
);

/** Set / clear the role-specific prompt (recruiter and admin; null clears). */
router.put(
  '/:jobId/prompt',
  requireAuth,
  requireRole('ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const input = putJobPromptSchema.parse(req.body);
    const view = await putJobPrompt(req.user!, req.params.jobId!, input.jobPrompt);
    res.json(view);
  }),
);

// ── Test blueprint & sealed pool (PLAN.md Phase 3, §5) ──────────────────
// The blueprint is the only test-shape HR controls; the pool endpoints report
// counts ONLY — no route anywhere returns unsealed future-session items.
// Sample items are preview-only by construction and never drawn.

/** Create or replace the test blueprint (requires an approved JD). */
router.put(
  '/:jobId/blueprint',
  requireAuth,
  requireRole('ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const input = putBlueprintSchema.parse(req.body);
    const { blueprint } = await putBlueprint(req.user!, req.params.jobId!, input);
    res.json({ blueprint });
  }),
);

/** Blueprint + sealed-pool status (counts only — never items). */
router.get(
  '/:jobId/blueprint',
  requireAuth,
  requireRole('ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const view = await getBlueprint(req.user!, req.params.jobId!);
    res.json(view);
  }),
);

/** Queue sample-preview generation (preview-only items, never drawn). */
router.post(
  '/:jobId/blueprint/samples',
  requireAuth,
  requireRole('ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    samplesRequestSchema.parse(req.body);
    await requestSamples(req.user!, req.params.jobId!);
    res.status(202).json({ queued: true });
  }),
);

/** HR preview of generated samples (visible by design; never drawn). */
router.get(
  '/:jobId/blueprint/samples',
  requireAuth,
  requireRole('ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const { samples } = await getSamples(req.user!, req.params.jobId!);
    res.json({ samples });
  }),
);

/** Generate + seal the question pool (first seal; 202 — the worker runs it). */
router.post(
  '/:jobId/pool/seal',
  requireAuth,
  requireRole('ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    samplesRequestSchema.parse(req.body); // no-body route, same empty-object shape
    await sealPool(req.user!, req.params.jobId!);
    res.status(202).json({ queued: true });
  }),
);

/** Destroy the current pool and regenerate it from the current blueprint. */
router.post(
  '/:jobId/pool/reseal',
  requireAuth,
  requireRole('ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    samplesRequestSchema.parse(req.body); // no-body route, same empty-object shape
    await resealPool(req.user!, req.params.jobId!);
    res.status(202).json({ queued: true });
  }),
);

/** Sealed-pool status — counts only, nothing else, ever (PLAN.md §5.1). */
router.get(
  '/:jobId/pool',
  requireAuth,
  requireRole('ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const { pool } = await getPool(req.user!, req.params.jobId!);
    res.json({ pool });
  }),
);

/** Job detail. */
router.get('/:jobId', requireAuth, asyncHandler(async (req, res) => {
  const job = await getJob(req.user!, req.params.jobId!);
  res.json({ job });
}));

/** Update a job (recruiter and admin). */
router.patch(
  '/:jobId',
  requireAuth,
  requireRole('ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const input = updateJobSchema.parse(req.body);
    const job = await updateJob(req.user!, req.params.jobId!, input);
    res.json({ job });
  }),
);

/** Delete a job and its applications (recruiter and admin). */
router.delete(
  '/:jobId',
  requireAuth,
  requireRole('ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    await deleteJob(req.user!, req.params.jobId!);
    res.status(204).send();
  }),
);

/** Publish / pause / close a job (recruiter and admin). */
router.post(
  '/:jobId/status',
  requireAuth,
  requireRole('ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const { status } = setJobStatusSchema.parse(req.body);
    const job = await setJobStatus(req.user!, req.params.jobId!, status);
    res.json({ job });
  }),
);

/** Pipeline board: all applications for a job, filterable by stage/status. */
router.get('/:jobId/applications', requireAuth, asyncHandler(async (req, res) => {
  const filters = listApplicationsQuerySchema.parse(req.query);
  const applications = await listForJob(req.user!, req.params.jobId!, filters);
  res.json({ applications });
}));

export default router;
