// IDE-style candidate code runs (founder request 2026-10): the Run button on
// CODE questions executes the candidate's OWN SAVED code in the same hardened
// sandbox evaluation uses and shows them the output — because a test that
// feels like an IDE measures doing, not remembering.
//
// DISCIPLINE (docs/TESTING.md §6 #2/#6):
// - Runs execute ONLY the candidate's saved answer with THEIR OWN args. The
//   hidden cases (and their expectations) stay sealed until evaluation — no
//   endpoint here reads or returns pool truth. The language comes from the
//   session question's `presented` view, so runs never decrypt the pool.
// - Gating mirrors answers exactly: hash-only token lookup, uniform 404,
//   STARTED + never-pausing clock. Plus a strict per-token rate limit (route)
//   and a per-session run cap — a Run spawns a real container, so it must not
//   be spammable.
// - Execution happens in the WORKER (CODE_RUN queue job), never in the API
//   process: the API container holds no Docker socket, and the single-worker
//   queue already serializes container load (a run may wait behind an
//   evaluation — seconds, acceptable).

import { prisma } from '../../prisma';
import { AppError } from '../../lib/http';
import { enqueue } from '../../lib/queue';
import { createExecutor } from '../../lib/sandbox';
import { programFor } from '../../lib/sandbox/builder';
import { normalizeCodeAnswer } from '../../lib/assessment/codeAnswer';
import type { SandboxExecutor } from '../../lib/sandbox/types';
import type { ImageOverrides } from '../../lib/sandbox/docker';
import { CODE_LANGUAGES, type CodeLanguage } from '../../lib/assessment/item';
import { loadTemplateImages } from '../applications/evaluation.service';
import { findLiveStartedSession, assertClockRunning } from './session.service';
import type { RunInput } from './session.schema';

/** Hard cap on runs per session — a Run is a real container; 30 is a generous
 *  IDE budget for a time-boxed test while bounding host load. */
export const MAX_RUNS_PER_SESSION = 30;

/** How many recent runs a candidate may list/poll per question. */
const RUNS_LISTED = 10;

/** Arg token limits — identical to runSchema; enforced AGAIN here because the
 *  worker re-reads args from the DB row, and every value reaching the sandbox
 *  must pass this whitelist regardless of where it came from. */
const MAX_ARGS = 10;
const MAX_ARG_LENGTH = 1_000;

export interface CodeRunView {
  id: string;
  order: number;
  status: string;
  argsUsed: string[] | null;
  exitCode: number | null;
  durationMs: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  error: string | null;
  createdAt: Date;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Pure whitelist: only short plain strings survive, count-capped. Anything
 *  else is dropped — the sandbox receives inert argv tokens, never shell
 *  text (the executor never builds a shell line at all). */
function sanitizeArgs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is string => typeof a === 'string' && a.length > 0 && a.length <= MAX_ARG_LENGTH)
    .slice(0, MAX_ARGS);
}

/** POST /test/:token/run — enqueue one run of the SAVED answer (never trusts
 *  client-sent code: the body carries only the question order and args). */
export async function requestRun(token: string, input: RunInput): Promise<{ run: { id: string; status: string } }> {
  const { session, deadlineAt } = await findLiveStartedSession(token);
  assertClockRunning(deadlineAt); // a run is a mutation: the clock never pauses

  const question = await prisma.sessionQuestion.findUnique({
    where: { sessionId_order: { sessionId: session.id, order: input.order } },
    select: { id: true, format: true },
  });
  if (!question) throw new AppError(404, 'Question not found', 'NOT_FOUND');
  if (question.format !== 'CODE') {
    throw new AppError(400, 'Runs are only available on coding tasks', 'NOT_A_CODE_QUESTION');
  }

  const answer = await prisma.answer.findUnique({
    where: { sessionQuestionId: question.id },
    select: { content: true },
  });
  // Either arm counts as runnable: {text} with non-empty text, or a
  // multi-file workspace with at least one non-empty file.
  const runnable = normalizeCodeAnswer(answer?.content ?? null, '');
  const hasCode =
    runnable !== null &&
    (runnable.kind === 'text'
      ? runnable.text.trim() !== ''
      : runnable.files.some((f) => f.content.trim() !== ''));
  if (!hasCode) {
    throw new AppError(409, 'Save your code first, then run it', 'NO_SAVED_ANSWER');
  }

  const runCount = await prisma.codeRun.count({ where: { sessionId: session.id } });
  if (runCount >= MAX_RUNS_PER_SESSION) {
    throw new AppError(409, `Run limit reached for this test (${MAX_RUNS_PER_SESSION})`, 'RUN_CAP_REACHED');
  }

  const run = await prisma.codeRun.create({
    data: { sessionId: session.id, sessionQuestionId: question.id, argsUsed: sanitizeArgs(input.args) },
    select: { id: true, status: true },
  });
  await enqueue('CODE_RUN', { codeRunId: run.id });
  return { run: { id: run.id, status: run.status } };
}

/** GET /test/:token/runs — the candidate's own recent runs (polling target).
 *  Live gate only (same as POST): after submit the evaluation covers CODE. */
export async function listRuns(token: string, order?: number): Promise<{ runs: CodeRunView[] }> {
  const { session, deadlineAt } = await findLiveStartedSession(token);
  assertClockRunning(deadlineAt);
  const rows = await prisma.codeRun.findMany({
    where: {
      sessionId: session.id,
      ...(order !== undefined ? { sessionQuestion: { order } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: RUNS_LISTED,
    select: {
      id: true,
      status: true,
      argsUsed: true,
      exitCode: true,
      durationMs: true,
      stdout: true,
      stderr: true,
      truncated: true,
      error: true,
      createdAt: true,
      sessionQuestion: { select: { order: true } },
    },
  });
  return {
    runs: rows.map((r) => ({
      id: r.id,
      order: r.sessionQuestion.order,
      status: r.status,
      argsUsed: Array.isArray(r.argsUsed) ? sanitizeArgs(r.argsUsed) : null,
      exitCode: r.exitCode,
      durationMs: r.durationMs,
      stdout: r.stdout,
      stderr: r.stderr,
      truncated: r.truncated,
      error: r.error,
      createdAt: r.createdAt,
    })),
  };
}

// ─── Worker side (CODE_RUN handler) ───────────────────────────────────────────

function isCodeLanguage(value: unknown): value is CodeLanguage {
  return typeof value === 'string' && (CODE_LANGUAGES as readonly string[]).includes(value);
}

/** Executes one queued run: reads the SAVED answer + `presented` language,
 *  runs it in the hardened sandbox (same executor + per-company templates as
 *  evaluation), writes the outcome to the CodeRun row.
 *
 *  Failure policy: the row is marked FAILED with the reason immediately (the
 *  candidate polls it), and the error RE-THROWS only when retryable (e.g.
 *  SANDBOX_UNAVAILABLE) so the queue's backoff can still land a late DONE. */
export async function runCodeRun(codeRunId: string): Promise<void> {
  const run = await prisma.codeRun.findUnique({
    where: { id: codeRunId },
    select: {
      id: true,
      status: true,
      argsUsed: true,
      sessionQuestion: {
        select: {
          id: true,
          format: true,
          presented: true,
          answer: { select: { content: true } },
          session: { select: { id: true, job: { select: { companyId: true } } } },
        },
      },
    },
  });
  if (!run || run.status !== 'QUEUED') return; // gone or already terminal — nothing to do

  const { sessionQuestion: q } = run;
  if (q.format !== 'CODE') {
    await markFailed(run.id, 'Not a coding task');
    return;
  }
  const presented = isPlainObject(q.presented) ? q.presented : {};
  const normalized = normalizeCodeAnswer(q.answer?.content ?? null, typeof presented.language === 'string' ? presented.language : '');
  if (!isCodeLanguage(presented.language) || normalized === null || (normalized.kind === 'text' && normalized.text.trim() === '')) {
    await markFailed(run.id, 'No runnable code saved for this question');
    return;
  }
  const language: CodeLanguage = presented.language;
  // The program to pipe into the sandbox: single-file source verbatim, or the
  // multi-file workspace compiled to its server-built bootstrap script (the
  // marker first line tells the executor to run it under `sh -s --`).
  const savedText = programFor(normalized, language).code;

  try {
    let images: ImageOverrides | undefined;
    try {
      images = await loadTemplateImages(q.session.job.companyId);
    } catch {
      images = undefined; // template read degrades to platform defaults
    }
    const executor: SandboxExecutor = createExecutor(
      'docker',
      undefined,
      images === undefined ? undefined : { images },
    );
    const response = await executor.execute({
      language,
      code: savedText,
      cases: [{ name: 'run', args: sanitizeArgs(run.argsUsed) }],
    });
    await prisma.codeRun.update({
      where: { id: run.id },
      data: {
        status: 'DONE',
        exitCode: response.exitCode,
        durationMs: response.durationMs,
        stdout: response.stdout,
        stderr: response.stderr,
        truncated: response.truncated,
        error: null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(run.id, message);
    // Retryable infrastructure failures get their queue retry; the row may
    // still land DONE on a later attempt (FAILED is overwritten on success).
    if (err instanceof AppError && err.code === 'SANDBOX_UNAVAILABLE') throw err;
  }
}

async function markFailed(codeRunId: string, message: string): Promise<void> {
  await prisma.codeRun
    .update({
      where: { id: codeRunId },
      data: { status: 'FAILED', error: message.slice(0, 500) },
    })
    .catch(() => undefined); // the row may be cascade-deleted mid-run — fine
}
