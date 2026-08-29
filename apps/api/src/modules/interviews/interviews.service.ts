import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { AppError } from '../../lib/http';
import type { AuthUser } from '../../types';
import type {
  CreateInterviewInput,
  UpdateInterviewInput,
  ScorecardInput,
} from './interviews.schema';

/** Loads an interview with its application + job, enforcing tenant isolation. */
async function getScopedInterview(interviewId: string, user: AuthUser) {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: { application: { include: { job: true } }, interviewer: true },
  });
  if (!interview || interview.application.job.companyId !== user.companyId) {
    throw new AppError(404, 'Interview not found', 'NOT_FOUND');
  }
  return interview;
}

/** Same scope check for an application (used by nested routes). */
async function getScopedApplicationId(applicationId: string, user: AuthUser): Promise<string> {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { job: { select: { companyId: true } } },
  });
  if (!application || application.job.companyId !== user.companyId) {
    throw new AppError(404, 'Application not found', 'NOT_FOUND');
  }
  return application.id;
}

export async function listInterviewsForApplication(user: AuthUser, applicationId: string) {
  await getScopedApplicationId(applicationId, user);
  return prisma.interview.findMany({
    where: { applicationId },
    orderBy: { scheduledAt: 'asc' },
    include: {
      interviewer: { select: { id: true, name: true } },
      scorecards: { include: { author: { select: { id: true, name: true } } } },
    },
  });
}

export async function createInterview(
  user: AuthUser,
  applicationId: string,
  input: CreateInterviewInput,
) {
  await getScopedApplicationId(applicationId, user);

  if (input.interviewerId) {
    const interviewer = await prisma.user.findUnique({ where: { id: input.interviewerId } });
    if (!interviewer || interviewer.companyId !== user.companyId) {
      throw new AppError(400, 'Interviewer must be a member of your company', 'INVALID_INTERVIEWER');
    }
  }

  return prisma.interview.create({
    data: {
      applicationId,
      type: input.type,
      scheduledAt: input.scheduledAt,
      durationMinutes: input.durationMinutes,
      interviewerId: input.interviewerId,
      locationOrLink: input.locationOrLink,
      notes: input.notes,
    },
    include: {
      interviewer: { select: { id: true, name: true } },
      application: { include: { job: { select: { id: true, title: true } }, candidate: { select: { id: true, name: true } } } },
    },
  });
}

export async function updateInterview(
  user: AuthUser,
  interviewId: string,
  input: UpdateInterviewInput,
) {
  await getScopedInterview(interviewId, user);
  if (input.interviewerId) {
    const interviewer = await prisma.user.findUnique({ where: { id: input.interviewerId } });
    if (!interviewer || interviewer.companyId !== user.companyId) {
      throw new AppError(400, 'Interviewer must be a member of your company', 'INVALID_INTERVIEWER');
    }
  }
  return prisma.interview.update({
    where: { id: interviewId },
    data: input as Prisma.InterviewUpdateInput,
    include: { interviewer: { select: { id: true, name: true } } },
  });
}

/**
 * Submits a scorecard against an interview. One scorecard per author per
 * application (enforced by a unique constraint); submitting also marks the
 * interview completed if it was still scheduled.
 */
export async function submitScorecard(
  user: AuthUser,
  interviewId: string,
  input: ScorecardInput,
) {
  const interview = await getScopedInterview(interviewId, user);
  const applicationId = interview.applicationId;

  const existing = await prisma.scorecard.findUnique({
    where: { applicationId_authorId: { applicationId, authorId: user.id } },
  });
  if (existing) {
    throw new AppError(409, 'You have already submitted a scorecard for this application', 'DUPLICATE_SCORECARD');
  }

  const [scorecard] = await prisma.$transaction([
    prisma.scorecard.create({
      data: {
        applicationId,
        authorId: user.id,
        interviewId,
        ...input,
      },
      include: { author: { select: { id: true, name: true } } },
    }),
    prisma.interview.updateMany({
      where: { id: interviewId, status: 'SCHEDULED' },
      data: { status: 'COMPLETED' },
    }),
  ]);
  return scorecard;
}
