// DB-backed job queue (PLAN.md Phase 2). Producer + consumer primitives for
// the `job_queue` table. No broker, no new dependencies — Postgres is the
// source of truth and `claimNext` uses a conditional updateMany so exactly one
// contender flips a row from PENDING to RUNNING.
//
// SINGLE-WORKER ASSUMPTION: one worker process per install (start:worker).
// claimNext is safe under accidental multi-worker (the claim is atomic), but
// fair ordering is not guaranteed, and rows orphaned in RUNNING by a crashed
// worker are only recovered by `requeueStale` at the next worker boot.

import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

export type JobType = 'JD_GENERATION' | 'SAMPLES_GENERATION' | 'POOL_SEAL' | 'EVALUATION';

/** A claimed job handed to a worker handler. */
export interface QueueJob {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

/** Inserts a PENDING row runnable immediately. */
export async function enqueue(type: JobType, payload: Record<string, unknown>): Promise<{ id: string }> {
  const row = await prisma.jobQueue.create({
    // Prisma's Json input type cannot express Record<string, unknown> even
    // though JSON objects are exactly that — cast at the boundary.
    data: { type, payload: payload as unknown as Prisma.InputJsonValue, status: 'PENDING', runAt: new Date() },
    select: { id: true },
  });
  return row;
}

/**
 * Claims the oldest due PENDING job. The claim is a conditional
 * `updateMany({ where: { id, status: 'PENDING' } })` — if another contender
 * won the row between our find and update, `count === 0` and we retry with the
 * next candidate (bounded loop; an empty queue returns null).
 *
 * Crash-loop protection (QA wave-3 F5): rows whose `attempts` have already
 * reached `maxAttempts` are FAILED on sight rather than re-executed — without
 * this, a worker that crashes mid-handler (so `fail()` never runs) can drive
 * attempts past maxAttempts on every restart.
 */
export async function claimNext(): Promise<QueueJob | null> {
  // A race loser re-reads; a pathological livelock still terminates.
  for (let tries = 0; tries < 10; tries++) {
    const candidate = await prisma.jobQueue.findFirst({
      where: { status: 'PENDING', runAt: { lte: new Date() } },
      orderBy: { runAt: 'asc' },
    });
    if (!candidate) return null;

    const claimed = await prisma.jobQueue.updateMany({
      where: { id: candidate.id, status: 'PENDING' },
      data: { status: 'RUNNING', attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue; // someone else won the race — next candidate

    if (candidate.attempts + 1 > candidate.maxAttempts) {
      // Claimed an already-exhausted row (crash-loop survivor): fail it for
      // good and look at the next candidate.
      await prisma.jobQueue.update({
        where: { id: candidate.id },
        data: { status: 'FAILED', lastError: 'Exhausted after worker crash(es) mid-execution' },
      });
      continue;
    }

    return {
      id: candidate.id,
      type: candidate.type as JobType,
      payload: (candidate.payload ?? {}) as Record<string, unknown>,
      attempts: candidate.attempts + 1,
      maxAttempts: candidate.maxAttempts,
    };
  }
  return null;
}

/** Marks a finished job DONE. */
export async function complete(id: string): Promise<void> {
  await prisma.jobQueue.update({ where: { id }, data: { status: 'DONE' } });
}

/**
 * Exponential retry backoff: 5s, 10s, 20s, ... capped at 5 minutes.
 * Pure — unit-tested without a database.
 */
export function backoffMs(attempts: number): number {
  const base = 5_000 * 2 ** (attempts - 1);
  return Math.min(base, 300_000);
}

/**
 * Records a failure: at `maxAttempts` the row is FAILED for good, otherwise it
 * goes back to PENDING with a backoff-scheduled `runAt`.
 */
export async function fail(id: string, error: unknown): Promise<void> {
  const row = await prisma.jobQueue.findUnique({ where: { id }, select: { attempts: true, maxAttempts: true } });
  const attempts = row?.attempts ?? 0;
  const maxAttempts = row?.maxAttempts ?? 3;
  const message = String(error).slice(0, 500);

  if (attempts >= maxAttempts) {
    await prisma.jobQueue.update({ where: { id }, data: { status: 'FAILED', lastError: message } });
    return;
  }
  await prisma.jobQueue.update({
    where: { id },
    data: { status: 'PENDING', lastError: message, runAt: new Date(Date.now() + backoffMs(attempts)) },
  });
}

/**
 * Recovers rows stuck in RUNNING (e.g. the worker was killed mid-job) by
 * resetting them to PENDING. Called once at worker startup — this is the
 * single-worker assumption made concrete: with N workers, one boot could
 * requeue a row another worker is still legitimately executing.
 */
export async function requeueStale(olderThanMs = 10 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const result = await prisma.jobQueue.updateMany({
    where: { status: 'RUNNING', updatedAt: { lt: cutoff } },
    data: { status: 'PENDING' },
  });
  return result.count;
}
