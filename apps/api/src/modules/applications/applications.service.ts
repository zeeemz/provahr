import type { Application, Prisma, Stage, ApplicationStatus } from '@prisma/client';
import { prisma } from '../../prisma';
import { AppError } from '../../lib/http';
import {
  canTransition,
  canReject,
  canWithdraw,
  canReopen,
  statusAfter,
} from '../../rules/pipeline';
import { generateTestToken, hashTestToken, TEST_LINK_TTL_MS } from '../../lib/testTokens';
import type { AuthUser } from '../../types';
import type { ApplyInput, StatusAction, WalkInInput } from './applications.schema';

/**
 * Loads an application and enforces tenant isolation. Returns a 404 (not 403)
 * for other companies' applications so their existence is not leaked.
 */
async function getScopedApplication(applicationId: string, user: AuthUser) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { job: true, candidate: true },
  });
  if (!application || application.job.companyId !== user.companyId) {
    throw new AppError(404, 'Application not found', 'NOT_FOUND');
  }
  return application;
}

/** Pipeline list for a job (used by the kanban board). */
export async function listForJob(
  user: AuthUser,
  jobId: string,
  filters: { stage?: Stage; status?: ApplicationStatus } = {},
) {
  const job = await prisma.job.findFirst({ where: { id: jobId, companyId: user.companyId! } });
  if (!job) throw new AppError(404, 'Job not found', 'NOT_FOUND');

  const where: Prisma.ApplicationWhereInput = { jobId, ...filters };
  return prisma.application.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      candidate: true,
      job: { select: { id: true, title: true } },
      interviews: { select: { id: true, type: true, scheduledAt: true, status: true } },
    },
  });
}

/** Full application detail: history, interviews, scorecards. */
export async function getDetail(user: AuthUser, applicationId: string) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: {
      job: true,
      candidate: true,
      stageEvents: {
        include: { actor: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      },
      interviews: {
        include: {
          interviewer: { select: { id: true, name: true } },
          scorecards: {
            include: { author: { select: { id: true, name: true } } },
          },
        },
        orderBy: { scheduledAt: 'asc' },
      },
      scorecards: {
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!application || application.job.companyId !== user.companyId) {
    throw new AppError(404, 'Application not found', 'NOT_FOUND');
  }
  return application;
}

/** Moves an application to a new stage and records the audit event. */
export async function moveStage(user: AuthUser, applicationId: string, toStage: Stage) {
  const application = await getScopedApplication(applicationId, user);
  const fromStage = application.stage;

  if (fromStage === toStage) {
    throw new AppError(400, `Application is already in stage ${toStage}`, 'INVALID_TRANSITION');
  }
  if (!canTransition(fromStage, toStage)) {
    throw new AppError(400, `Cannot move an application from ${fromStage} to ${toStage}`, 'INVALID_TRANSITION');
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.application.update({
      where: { id: applicationId },
      data: {
        stage: toStage,
        // Reaching HIRED closes the loop on the status too.
        ...(toStage === 'HIRED' && application.status === 'ACTIVE'
          ? { status: 'HIRED' as const }
          : {}),
      },
      include: { job: { select: { id: true, title: true } }, candidate: true },
    });
    await tx.stageEvent.create({
      data: { applicationId, fromStage, toStage, actorId: user.id },
    });
    return updated;
  });
}

/** Rejects / withdraws / reopens an application (stage stays where it is). */
export async function changeStatus(
  user: AuthUser,
  applicationId: string,
  action: StatusAction,
  reason?: string,
) {
  const application = await getScopedApplication(applicationId, user);
  const { stage, status } = application;

  if (action === 'REJECT') {
    if (!canReject(stage, status)) {
      throw new AppError(400, 'Only active applications that have not been hired can be rejected', 'INVALID_ACTION');
    }
    if (!reason || reason.trim().length < 3) {
      throw new AppError(400, 'A rejection reason is required (fair-hiring policy)', 'REASON_REQUIRED');
    }
  }
  if (action === 'WITHDRAW' && !canWithdraw(status)) {
    throw new AppError(400, 'Only active applications can be withdrawn', 'INVALID_ACTION');
  }
  if (action === 'REOPEN' && !canReopen(status)) {
    throw new AppError(400, 'Only rejected or withdrawn applications can be reopened', 'INVALID_ACTION');
  }

  const newStatus = statusAfter(action);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.application.update({
      where: { id: applicationId },
      data: {
        status: newStatus,
        rejectionReason: action === 'REJECT' ? reason!.trim() : null,
      },
      include: { job: { select: { id: true, title: true } }, candidate: true },
    });
    await tx.stageEvent.create({
      data: {
        applicationId,
        fromStage: stage,
        toStage: stage,
        actorId: user.id,
        note:
          action === 'REJECT'
            ? `Rejected: ${reason!.trim()}`
            : action === 'WITHDRAW'
              ? 'Withdrawn by candidate'
              : 'Reopened',
      },
    });
    return updated;
  });
}

/**
 * Candidate upsert + duplicate block + application create. Shared by the
 * public apply flow and the HR walk-in flow so both keep identical duplicate
 * semantics (409 before any test session can be minted — never-regress #3).
 */
async function upsertCandidateAndApply(
  jobId: string,
  input: ApplyInput,
  opts: { source?: string; coverLetter?: string; actorId?: string | null } = {},
): Promise<Application> {
  const candidate = await prisma.candidate.upsert({
    where: { email: input.email },
    create: {
      email: input.email,
      name: input.name,
      phone: input.phone,
      resumeUrl: input.resumeUrl,
      linkedinUrl: input.linkedinUrl,
      githubUrl: input.githubUrl,
    },
    // Latest application refreshes the profile name; other fields keep
    // whatever the candidate provided previously.
    update: { name: input.name },
  });

  const existing = await prisma.application.findUnique({
    where: { jobId_candidateId: { jobId, candidateId: candidate.id } },
  });
  if (existing) {
    throw new AppError(409, 'This candidate has already applied to this job', 'ALREADY_APPLIED');
  }

  return prisma
    .$transaction(async (tx) => {
      const application = await tx.application.create({
        data: {
          jobId,
          candidateId: candidate.id,
          source: opts.source ?? input.source,
          coverLetter: opts.coverLetter ?? input.coverLetter,
        },
        include: { job: { select: { id: true, title: true } } },
      });
      await tx.stageEvent.create({
        data: {
          applicationId: application.id,
          fromStage: null,
          toStage: 'APPLIED',
          // Walk-ins are HR-created: the stage event credits the HR user for
          // the audit trail (null for the public self-serve flow).
          actorId: opts.actorId ?? null,
        },
      });
      return application;
    })
    .catch((err: unknown) => {
      // Concurrent duplicate apply: both requests passed the pre-check, the
      // @@unique([jobId, candidateId]) loser gets P2002 — surface the friendly
      // 409 instead of the generic CONFLICT (QA wave-5 F2). The throw happens
      // inside this function, so no TestSession is ever minted for the loser.
      if ((err as { code?: string }).code === 'P2002') {
        throw new AppError(409, 'This candidate has already applied to this job', 'ALREADY_APPLIED');
      }
      throw err;
    });
}

/**
 * Public application flow (no auth). Creates or reuses the candidate profile
 * (keyed by email), blocks duplicate applications for the same job, and
 * records the initial audit event.
 */
export async function applyToJob(jobId: string, input: ApplyInput): Promise<Application> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.status !== 'OPEN') {
    throw new AppError(404, 'This job is not accepting applications', 'NOT_FOUND');
  }
  return upsertCandidateAndApply(jobId, input);
}

/** The minted link for a walk-in. Same shape as the public apply response. */
export interface WalkInResult {
  application: { id: string; jobId: string; createdAt: Date };
  testLink: { token: string; expiresAt: Date } | null;
  testLinkReason?: 'NO_POOL';
}

/**
 * HR walk-in flow (founder requirement 2026-09-20): a candidate arrives at the
 * office, HR creates the application on their behalf and the test link is
 * opened on the spot — the candidate then completes their remaining details at
 * the start of the test itself (POST /api/public/test/:token/details).
 *
 * Company-scoped like every HR route; OPEN jobs only, same duplicate semantics
 * as the public flow. The stage event credits the HR user (audit trail).
 */
export async function walkInApply(user: AuthUser, jobId: string, input: WalkInInput): Promise<WalkInResult> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, companyId: user.companyId! },
    select: { id: true, status: true },
  });
  if (!job || job.status !== 'OPEN') {
    throw new AppError(404, 'This job is not accepting applications', 'NOT_FOUND');
  }

  const application = await upsertCandidateAndApply(jobId, input, {
    source: 'WALK_IN',
    actorId: user.id,
  });

  // Active-pool check: scalars only — itemsEncrypted must never be selected
  // into the API process (same discipline as public.service apply).
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
  await prisma.testSession.create({ data: { applicationId: application.id, jobId, tokenHash, expiresAt } });
  // The ONLY time the plain token leaves the system (same contract as apply).
  return { application, testLink: { token, expiresAt } };
}
