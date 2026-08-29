// Background worker entrypoint (PLAN.md Phase 2). Mirrors src/index.ts.
//
// Runs one loop: claim a due job, dispatch by type, mark DONE/FAILED, sleep
// when idle. Graceful shutdown on SIGINT/SIGTERM stops claiming new work,
// lets the in-flight job finish, then disconnects Prisma.

import { env } from './env';
import { prisma } from './prisma';
import { claimNext, complete, fail, requeueStale } from './lib/queue';
import type { JobType, QueueJob } from './lib/queue';
import { runJdGeneration } from './modules/jobs/jd.service';
import { runSamplesGeneration, runPoolSeal } from './modules/jobs/blueprint.service';
import { runEvaluation } from './modules/applications/evaluation.service';

type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

// Exhaustive over JobType by construction; unknown DB rows (hand-edited
// `type` values) fall through to the no-handler branch in the loop.
const handlers: Record<JobType, JobHandler> = {
  JD_GENERATION: async (payload) => {
    if (typeof payload.jobId !== 'string' || payload.jobId === '') {
      // Unfixable payload — throw so fail() records it with a clear error
      // instead of the job silently "succeeding".
      throw new Error(`JD_GENERATION payload has no jobId string: ${JSON.stringify(payload).slice(0, 200)}`);
    }
    await runJdGeneration(payload.jobId);
  },
  SAMPLES_GENERATION: async (payload) => {
    if (typeof payload.jobId !== 'string' || payload.jobId === '') {
      throw new Error(`SAMPLES_GENERATION payload has no jobId string: ${JSON.stringify(payload).slice(0, 200)}`);
    }
    await runSamplesGeneration(payload.jobId);
  },
  POOL_SEAL: async (payload) => {
    if (typeof payload.jobId !== 'string' || payload.jobId === '') {
      throw new Error(`POOL_SEAL payload has no jobId string: ${JSON.stringify(payload).slice(0, 200)}`);
    }
    await runPoolSeal(payload.jobId, payload.reseal === true);
  },
  EVALUATION: async (payload) => {
    if (typeof payload.sessionId !== 'string' || payload.sessionId === '') {
      throw new Error(`EVALUATION payload has no sessionId string: ${JSON.stringify(payload).slice(0, 200)}`);
    }
    await runEvaluation(payload.sessionId);
  },
};

let running = true;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runJob(job: QueueJob): Promise<void> {
  const handler = handlers[job.type];
  if (!handler) {
    await fail(job.id, new Error(`No handler registered for job type '${job.type}'`));
    return;
  }
  try {
    await handler(job.payload);
    await complete(job.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] job ${job.id} (${job.type}) attempt ${job.attempts}/${job.maxAttempts} failed: ${message}`);
    await fail(job.id, err);
  }
}

async function main(): Promise<void> {
  console.log('ProvaHR worker started');
  // Recover rows a crashed worker left in RUNNING (single-worker assumption
  // documented in src/lib/queue.ts).
  const requeued = await requeueStale();
  if (requeued > 0) {
    console.log(`[worker] requeued ${requeued} stale job(s) from a previous run`);
  }

  // Boot-only recovery leaves rows orphaned in RUNNING until the next restart
  // when the crash-restart gap is under the staleness threshold — so also sweep
  // periodically while idle (QA wave-3 F5).
  let lastStaleSweep = Date.now();

  while (running) {
    const job = await claimNext();
    if (!job) {
      if (Date.now() - lastStaleSweep >= 60_000) {
        lastStaleSweep = Date.now();
        const swept = await requeueStale();
        if (swept > 0) console.log(`[worker] requeued ${swept} stale job(s) during idle sweep`);
      }
      await sleep(env.WORKER_POLL_MS);
      continue;
    }
    await runJob(job);
  }

  console.log('ProvaHR worker stopped');
  await prisma.$disconnect();
}

function shutdown(): void {
  if (!running) return;
  running = false;
  console.log('[worker] shutdown requested — finishing the current job, then exiting');
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  console.error('[worker] fatal:', err);
  prisma
    .$disconnect()
    .catch(() => undefined)
    .finally(() => process.exit(1));
});
