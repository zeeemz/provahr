import { Router } from 'express';
import type { RequestHandler } from 'express';
import { AppError, asyncHandler } from '../../lib/http';
import { createRateLimiter } from '../../lib/rateLimit';
import { listPublicJobs, getPublicJob, apply, getTestLinkInfo, saveWalkInDetails } from './public.service';
import { publicJobsQuerySchema } from './public.schema';
import { applySchema, walkInDetailsSchema } from '../applications/applications.schema';
import { answerSchema, signalsSchema, startSchema, runSchema, runsQuerySchema } from './session.schema';
import {
  getSessionView,
  recordSignals,
  startSession,
  submitSession,
  upsertAnswer,
} from './session.service';
import { objectiveMarking } from './marking.service';
import { requestRun, listRuns } from './code-run.service';

const router = Router();

// ── Rate limiting (PLAN.md §10 — public endpoints) ───────────────────────────
// In-memory, per-process, per-IP (lib/rateLimit.ts). The anonymous surface is
// the abuse surface: apply writes to the DB, and GET /test/:token doubles as
// a token oracle if left unlimited — every probe, valid shape or not, costs
// budget BEFORE the handler runs. The board/detail GETs stay unlimited
// (cheap, cacheable, no secrets). Separate buckets: applying must never eat
// a candidate's test-link budget and vice versa. The Phase 5 session
// endpoints share one bucket sized for a real test: a candidate answers
// repeatedly (one upsert per question + review-pass revisions) and clients
// flush signal batches, so 60 hits/minute covers honest traffic while still
// bounding scripted abuse of the mutating surface.
const applyLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });
const testTokenLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });
const sessionLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });
// IDE Run buckets (2026-10), TOKEN-keyed instead of IP-keyed: a walk-in office
// shares one IP, but the single-use link is the real abuse unit. POSTing a run
// spawns a container (strict); polling the result list is cheap (roomier).
const codeRunLimiter = createRateLimiter({ windowMs: 60_000, max: 6 });
const codeRunListLimiter = createRateLimiter({ windowMs: 60_000, max: 30 });

/** Wraps a limiter as Express middleware keyed by client IP. */
function ipRateLimit(allow: (key: string) => boolean): RequestHandler {
  return (req, _res, next) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    if (!allow(ip)) {
      next(new AppError(429, 'Too many requests — try again later', 'RATE_LIMITED'));
      return;
    }
    next();
  };
}

/** Same, keyed by the test token in the path (see codeRunLimiter above). */
function tokenRateLimit(allow: (key: string) => boolean): RequestHandler {
  return (req, _res, next) => {
    const key = req.params.token ?? 'unknown';
    if (!allow(key)) {
      next(new AppError(429, 'Too many runs — give it a moment', 'RATE_LIMITED'));
      return;
    }
    next();
  };
}

/** Public job board. */
router.get('/jobs', asyncHandler(async (req, res) => {
  const filters = publicJobsQuerySchema.parse(req.query);
  const jobs = await listPublicJobs(filters);
  res.json({ jobs });
}));

/** Public job detail. */
router.get('/jobs/:jobId', asyncHandler(async (req, res) => {
  const job = await getPublicJob(req.params.jobId!);
  res.json({ job });
}));

/** Submit an application — no account required. Issues the one-time test
 *  link when the job has an active sealed pool; the plain token appears in
 *  this response and nowhere else, ever. */
router.post(
  '/jobs/:jobId/apply',
  ipRateLimit(applyLimiter),
  asyncHandler(async (req, res) => {
    const input = applySchema.parse(req.body);
    const result = await apply(req.params.jobId!, input);
    res.status(201).json({
      application: {
        id: result.application.id,
        jobId: result.application.jobId,
        createdAt: result.application.createdAt,
      },
      testLink: result.testLink,
      ...(result.testLinkReason ? { testLinkReason: result.testLinkReason } : {}),
    });
  }),
);

/** Consent-screen metadata for a one-time test link (PLAN.md §9) — status,
 *  expiry, job title, time limit. NEVER items. Unknown and invalid tokens
 *  answer identically: one 404, no oracle. Walk-in links additionally carry
 *  the HR-entered identity for the candidate's details step. */
router.get(
  '/test/:token',
  ipRateLimit(testTokenLimiter),
  asyncHandler(async (req, res) => {
    const info = await getTestLinkInfo(req.params.token!);
    res.json(info);
  }),
);

/** Walk-in candidate detail completion (before consent): links, cover letter,
 *  phone — never name/email (HR-owned). Token-gated like every session route;
 *  uniform 404; only while the session is still PENDING. */
router.post(
  '/test/:token/details',
  ipRateLimit(sessionLimiter),
  asyncHandler(async (req, res) => {
    const input = walkInDetailsSchema.parse(req.body);
    await saveWalkInDetails(req.params.token!, input);
    res.json({ saved: true });
  }),
);

// ── Candidate test session (PLAN.md Phase 5, §4 loop step 4, §9) ─────────────
// All five share the session bucket; all lookups are hash-only with the same
// uniform 404 as GET /test/:token. Start answers 201 on a fresh start and
// 200 on idempotent re-entry (refresh mid-test). The candidate-facing
// responses never carry scores, verdicts, or feedback (asymmetry, §7):
// submit answers exactly { submitted: true }.

/** Start (or re-enter) the session: draws items, realizes variants, starts
 *  the never-pausing clock. */
router.post(
  '/test/:token/start',
  ipRateLimit(sessionLimiter),
  asyncHandler(async (req, res) => {
    startSchema.parse(req.body ?? {}); // no body expected; rejects non-object junk
    const { fresh, view } = await startSession(req.params.token!);
    res.status(fresh ? 201 : 200).json(view);
  }),
);

/** Refresh-safe session view: questions in order + saved answers + clock meta. */
router.get(
  '/test/:token/session',
  ipRateLimit(sessionLimiter),
  asyncHandler(async (req, res) => {
    const view = await getSessionView(req.params.token!);
    res.json(view);
  }),
);

/** Upsert one answer (linear flow + bounded review pass both land here). */
router.post(
  '/test/:token/answers',
  ipRateLimit(sessionLimiter),
  asyncHandler(async (req, res) => {
    const input = answerSchema.parse(req.body);
    await upsertAnswer(req.params.token!, input);
    res.json({ saved: true });
  }),
);

/** Ingest a batch of proctoring signals — evidence only, never status. */
router.post(
  '/test/:token/signals',
  ipRateLimit(sessionLimiter),
  asyncHandler(async (req, res) => {
    const input = signalsSchema.parse(req.body);
    const { recorded } = await recordSignals(req.params.token!, input.signals);
    res.json({ recorded });
  }),
);

/** Finalize. The candidate sees { submitted: true } plus — since the founder
 *  amendment of 2026-09-21 — immediate deterministic marking for the
 *  objective formats (MCQ/SWIPE_MCQ). Open formats stay "pending evaluation"
 *  until the HR-side run; scores/verdicts for them never appear here. */
router.post(
  '/test/:token/submit',
  ipRateLimit(sessionLimiter),
  asyncHandler(async (req, res) => {
    const result = await submitSession(req.params.token!);
    res.json(result);
  }),
);

// ── IDE code runs (founder request 2026-10) ───────────────────────────────────
// The Run button on CODE questions. Executes the candidate's OWN SAVED code
// (body carries only order + args — never code) via the worker's hardened
// sandbox; the response NEVER contains hidden-case expectations (runs judge
// nothing — output only). Gated like answers: STARTED + clock, hash-only
// token, uniform 404.

/** Enqueue one run → 202 { run: { id, status } }; poll the list below. */
router.post(
  '/test/:token/run',
  tokenRateLimit(codeRunLimiter),
  asyncHandler(async (req, res) => {
    const input = runSchema.parse(req.body);
    const result = await requestRun(req.params.token!, input);
    res.status(202).json(result);
  }),
);

/** The candidate's own recent runs (newest first; ?order= scopes to one
 *  question). Poll target until a run reaches DONE/FAILED. */
router.get(
  '/test/:token/runs',
  tokenRateLimit(codeRunListLimiter),
  asyncHandler(async (req, res) => {
    const { order } = runsQuerySchema.parse(req.query);
    const result = await listRuns(req.params.token!, order);
    res.json(result);
  }),
);

/** Post-submit marking view (re-entry / refresh of the submitted screen).
 *  Token-gated like every session endpoint; uniform 404; SUBMITTED only. */
router.get(
  '/test/:token/marking',
  ipRateLimit(sessionLimiter),
  asyncHandler(async (req, res) => {
    const marking = await objectiveMarking(req.params.token!);
    res.json(marking);
  }),
);

export default router;
