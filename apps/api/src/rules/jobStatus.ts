import type { JobStatus } from '@prisma/client';

/** Lifecycle of a job posting. Only OPEN jobs are visible on the public board. */
const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  DRAFT: ['OPEN'],
  OPEN: ['PAUSED', 'CLOSED'],
  PAUSED: ['OPEN', 'CLOSED'],
  CLOSED: [],
};

export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === 'string' && value in TRANSITIONS;
}

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  if (from === to) return false;
  return TRANSITIONS[from].includes(to);
}
