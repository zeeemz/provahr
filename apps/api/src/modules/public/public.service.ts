import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { AppError } from '../../lib/http';
import {
  generateTestToken,
  hashTestToken,
  isTokenShapeValid,
  TEST_LINK_TTL_MS,
} from '../../lib/testTokens';
import { applyToJob } from '../applications/applications.service';
import type { ApplyInput, WalkInDetailsInput } from '../applications/applications.schema';
import type { z } from 'zod';
import type { publicJobsQuerySchema } from './public.schema';

/** Fields exposed on the public board — never internal notes or counts. */
const publicJobSelect = {
  id: true,
  title: true,
  department: true,
  roleFamily: true,
  location: true,
  workMode: true,
  employmentType: true,
  salaryMin: true,
  salaryMax: true,
  salaryCurrency: true,
  description: true,
  createdAt: true,
  // Existence-only probe for "does this job have a test?" — scalar id, NEVER
  // itemsEncrypted (the sealed blob must not enter the API process).
  pools: { where: { isActive: true }, select: { id: true }, take: 1 },
} satisfies Prisma.JobSelect;

/** Strips the pool-existence probe and surfaces it as the board-facing flag. */
function toPublicJobDto<T extends { pools: { id: string }[] }>(job: T): Omit<T, 'pools'> & { testRequired: boolean } {
  const { pools, ...rest } = job;
  return { ...rest, testRequired: pools.length > 0 };
}

export async function listPublicJobs(
  filters: z.infer<typeof publicJobsQuerySchema>,
) {
  const where: Prisma.JobWhereInput = { status: 'OPEN' };
  if (filters.roleFamily) where.roleFamily = filters.roleFamily;
  if (filters.workMode) where.workMode = filters.workMode;
  if (filters.q) {
    where.OR = [
      { title: { contains: filters.q, mode: 'insensitive' } },
      { department: { contains: filters.q, mode: 'insensitive' } },
      { location: { contains: filters.q, mode: 'insensitive' } },
      { description: { contains: filters.q, mode: 'insensitive' } },
    ];
  }
  const jobs = await prisma.job.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: publicJobSelect,
  });
  return jobs.map(toPublicJobDto);
}

export async function getPublicJob(jobId: string) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, status: 'OPEN' },
    select: publicJobSelect,
  });
  if (!job) throw new AppError(404, 'Job not found', 'NOT_FOUND');
  return toPublicJobDto(job);
}

// ─── Application + one-time test link (PLAN.md §4 loop step 3) ───────────────

/** The minted link. The plain token appears exactly once — in the 201 response. */
export interface TestLink {
  token: string;
  expiresAt: Date;
}

export interface ApplyResult {
  application: { id: string; jobId: string; createdAt: Date };
  testLink: TestLink | null;
  /** Present only when testLink is null — why no test was issued. */
  testLinkReason?: 'NO_POOL';
}

/**
 * Submits an application and, when the job has an active sealed pool, mints
 * the candidate's one-time test link (PLAN.md §4 step 3).
 *
 * - The application itself is unchanged: applyToJob creates the candidate
 *   (upsert by email), blocks duplicates with 409 ALREADY_APPLIED, and
 *   records the APPLIED stage event. The HR pipeline works with or without a
 *   test: no active pool → application still created, testLink null.
 * - A re-apply never mints a second token: the 409 propagates from
 *   applyToJob BEFORE any TestSession is created (never-regress #3).
 * - Only ONE link can exist per application (TestSession.applicationId is
 *   unique in the schema).
 */
export async function apply(jobId: string, input: ApplyInput): Promise<ApplyResult> {
  const application = await applyToJob(jobId, input);

  // Active-pool check: scalars only — itemsEncrypted must never be selected
  // into the API process (same discipline as blueprint.service activePoolFor).
  const pool = await prisma.sealedQuestionPool.findFirst({
    where: { jobId, isActive: true },
    orderBy: { sealedAt: 'desc' },
    select: { id: true },
  });
  if (!pool) {
    return { application, testLink: null, testLinkReason: 'NO_POOL' };
  }

  const { token, tokenHash } = generateTestToken();
  const expiresAt = new Date(Date.now() + TEST_LINK_TTL_MS);
  await prisma.testSession.create({
    data: { applicationId: application.id, jobId, tokenHash, expiresAt },
  });
  // The ONLY time the plain token leaves the system.
  return { application, testLink: { token, expiresAt } };
}

/** What GET /api/public/test/:token tells the consent screen (Phase 5). */
export interface TestLinkInfo {
  status: string;
  expiresAt: Date;
  jobTitle: string;
  timeLimitMin: number | null;
  alreadyUsed: boolean;
  /** Walk-in sessions (HR-created): the candidate completes their details before consent. */
  walkIn: boolean;
  /** Present only for walk-ins — the HR-entered identity, shown read-only + prefills. */
  candidate?: {
    name: string;
    email: string;
    phone: string | null;
    resumeUrl: string | null;
    linkedinUrl: string | null;
    githubUrl: string | null;
  };
}

/**
 * Looks up a test link by plain token for the consent screen. NEVER returns
 * items, the pool, or tokenHash — meta only. Bad shape and unknown token are
 * answered identically (uniform 404) so this endpoint cannot be used as a
 * token-validity oracle.
 */
export async function getTestLinkInfo(token: string): Promise<TestLinkInfo> {
  if (!isTokenShapeValid(token)) {
    throw new AppError(404, 'Test link not found', 'NOT_FOUND');
  }

  const session = await prisma.testSession.findUnique({
    where: { tokenHash: hashTestToken(token) },
    select: {
      status: true,
      expiresAt: true,
      // Scalars only: the job title for the consent screen and the
      // blueprint's time limit — never pool contents.
      job: {
        select: { title: true, blueprint: { select: { timeLimitMin: true } } },
      },
      // Walk-in detection + the HR-entered identity for the details step.
      application: {
        select: {
          source: true,
          candidate: {
            select: { name: true, email: true, phone: true, resumeUrl: true, linkedinUrl: true, githubUrl: true },
          },
        },
      },
    },
  });
  if (!session) {
    throw new AppError(404, 'Test link not found', 'NOT_FOUND');
  }

  const expired = session.expiresAt.getTime() <= Date.now();
  const walkIn = session.application?.source === 'WALK_IN';
  return {
    status: expired ? 'EXPIRED' : session.status,
    expiresAt: session.expiresAt,
    jobTitle: session.job.title,
    timeLimitMin: session.job.blueprint?.timeLimitMin ?? null,
    alreadyUsed: session.status === 'STARTED' || session.status === 'SUBMITTED',
    walkIn,
    ...(walkIn && session.application
      ? { candidate: { name: session.application.candidate.name, email: session.application.candidate.email, phone: session.application.candidate.phone, resumeUrl: session.application.candidate.resumeUrl, linkedinUrl: session.application.candidate.linkedinUrl, githubUrl: session.application.candidate.githubUrl } }
      : {}),
  };
}

/**
 * The candidate-side half of the walk-in flow: before starting the test, the
 * candidate completes the details HR could not know (links, cover letter,
 * phone correction). Token-gated exactly like every other session endpoint —
 * uniform 404, hash-only lookup — and only while the session is still PENDING
 * (once the clock starts, identity is locked).
 */
export async function saveWalkInDetails(token: string, input: WalkInDetailsInput): Promise<void> {
  if (!isTokenShapeValid(token)) {
    throw new AppError(404, 'Test link not found', 'NOT_FOUND');
  }
  const session = await prisma.testSession.findUnique({
    where: { tokenHash: hashTestToken(token) },
    select: {
      status: true,
      applicationId: true,
      application: { select: { source: true, candidateId: true } },
    },
  });
  if (!session || session.application?.source !== 'WALK_IN') {
    // Uniform 404: unknown token and non-walk-in token answer identically.
    throw new AppError(404, 'Test link not found', 'NOT_FOUND');
  }
  if (session.status !== 'ISSUED') {
    throw new AppError(409, 'Details can only be completed before the test starts', 'DETAILS_LOCKED');
  }

  // Only provided fields are written — the candidate may skip any of them.
  const candidate: Record<string, string> = {};
  if (input.phone !== undefined) candidate.phone = input.phone;
  if (input.resumeUrl !== undefined) candidate.resumeUrl = input.resumeUrl;
  if (input.linkedinUrl !== undefined) candidate.linkedinUrl = input.linkedinUrl;
  if (input.githubUrl !== undefined) candidate.githubUrl = input.githubUrl;
  if (Object.keys(candidate).length > 0) {
    await prisma.candidate.update({
      where: { id: session.application.candidateId },
      data: candidate,
    });
  }
  if (input.coverLetter !== undefined) {
    await prisma.application.update({
      where: { id: session.applicationId },
      data: { coverLetter: input.coverLetter },
    });
  }
}
