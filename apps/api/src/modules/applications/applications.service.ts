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
import type { AuthUser } from '../../types';
import type { ApplyInput, StatusAction } from './applications.schema';

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
 * Public application flow (no auth). Creates or reuses the candidate profile
 * (keyed by email), blocks duplicate applications for the same job, and
 * records the initial audit event.
 */
export async function applyToJob(jobId: string, input: ApplyInput): Promise<Application> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.status !== 'OPEN') {
    throw new AppError(404, 'This job is not accepting applications', 'NOT_FOUND');
  }

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
    throw new AppError(409, 'You have already applied to this job', 'ALREADY_APPLIED');
  }

  return prisma
    .$transaction(async (tx) => {
      const application = await tx.application.create({
        data: {
          jobId,
          candidateId: candidate.id,
          source: input.source,
          coverLetter: input.coverLetter,
        },
        include: { job: { select: { id: true, title: true } } },
      });
    await tx.stageEvent.create({
      data: { applicationId: application.id, fromStage: null, toStage: 'APPLIED', actorId: null },
    });
    return application;
    })
    .catch((err: unknown) => {
      // Concurrent duplicate apply: both requests passed the pre-check, the
      // @@unique([jobId, candidateId]) loser gets P2002 — surface the friendly
      // 409 instead of the generic CONFLICT (QA wave-5 F2). The throw happens
      // inside this function, so no TestSession is ever minted for the loser.
      if ((err as { code?: string }).code === 'P2002') {
        throw new AppError(409, 'You have already applied to this job', 'ALREADY_APPLIED');
      }
      throw err;
    });
}
