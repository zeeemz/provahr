import type { Prisma, JobStatus } from '@prisma/client';
import { prisma } from '../../prisma';
import { AppError } from '../../lib/http';
import { canTransitionJob } from '../../rules/jobStatus';
import type { AuthUser } from '../../types';
import type { CreateJobInput, UpdateJobInput } from './jobs.schema';

/** Every job read/write in this module is scoped to the caller's company. */

export async function listJobs(
  user: AuthUser,
  filters: { status?: JobStatus; roleFamily?: string; q?: string } = {},
) {
  const where: Prisma.JobWhereInput = { companyId: user.companyId! };
  if (filters.status) where.status = filters.status;
  if (filters.roleFamily) where.roleFamily = filters.roleFamily as Prisma.EnumRoleFamilyFilter['equals'];
  if (filters.q) {
    where.OR = [
      { title: { contains: filters.q, mode: 'insensitive' } },
      { department: { contains: filters.q, mode: 'insensitive' } },
      { location: { contains: filters.q, mode: 'insensitive' } },
    ];
  }
  return prisma.job.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: {
          applications: { where: { status: 'ACTIVE' } },
        },
      },
    },
  });
}

export async function getJob(user: AuthUser, jobId: string) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, companyId: user.companyId! },
    include: {
      _count: {
        select: {
          applications: true,
        },
      },
    },
  });
  if (!job) throw new AppError(404, 'Job not found', 'NOT_FOUND');
  return job;
}

export async function createJob(user: AuthUser, input: CreateJobInput) {
  return prisma.job.create({
    data: { ...input, companyId: user.companyId! },
  });
}

export async function updateJob(user: AuthUser, jobId: string, input: UpdateJobInput) {
  await getJob(user, jobId); // scope check
  return prisma.job.update({ where: { id: jobId }, data: input });
}

export async function deleteJob(user: AuthUser, jobId: string) {
  const job = await getJob(user, jobId); // scope check
  if (job.status !== 'DRAFT') {
    // A published role carries applications and the append-only stage-event
    // audit trail (fair-hiring, PLAN §8) — it is closed, never deleted.
    throw new AppError(
      409,
      'Only draft roles can be deleted. Close the role instead once it has been published.',
      'JOB_NOT_DRAFT',
    );
  }
  // Cancel any in-flight work for this draft (JD generation, samples, a
  // running seal) BEFORE the delete: the rows flip to terminal CANCELLED —
  // the same contract as POST /:jobId/pool/cancel — and the worker's guards
  // (assertNotAborted, the CANCELLED checks in complete()/fail()) turn the
  // mid-flight handler into a no-op, so deleting under a running seal is safe.
  await prisma.jobQueue.updateMany({
    where: {
      status: { in: ['PENDING', 'RUNNING'] },
      payload: { path: ['jobId'], equals: jobId },
    },
    data: { status: 'CANCELLED', lastError: `Draft deleted by ${user.name}` },
  });
  await prisma.job.delete({ where: { id: jobId } }); // blueprint/pools/samples cascade
}

export async function setJobStatus(user: AuthUser, jobId: string, to: JobStatus) {
  const job = await getJob(user, jobId);
  if (!canTransitionJob(job.status, to)) {
    throw new AppError(400, `Cannot change job status from ${job.status} to ${to}`, 'INVALID_TRANSITION');
  }
  return prisma.job.update({ where: { id: jobId }, data: { status: to } });
}
