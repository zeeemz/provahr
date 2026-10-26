// IDE code runs (founder request 2026-10): the Run button on CODE questions.
// Covers the public routes' gates (uniform 404, STARTED + never-pausing clock,
// CODE-only, saved-answer requirement, per-session run cap, token-keyed rate
// limit), the sanitizer that whitelists argv tokens, and the worker handler's
// contract (hardened executor receives ONLY cleaned args; outcome lands on the
// CodeRun row; SANDBOX_UNAVAILABLE rethrows for the queue retry). House style:
// prisma mocked model-by-model; sandbox + template loader mocked at the seam.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { AppError } from '../src/lib/http';

const {
  testSessionFindUnique,
  sessionQuestionFindUnique,
  answerFindUnique,
  codeRunCount,
  codeRunCreate,
  codeRunFindMany,
  codeRunFindUnique,
  codeRunUpdate,
  enqueueMock,
  createExecutorMock,
  loadTemplateImagesMock,
} = vi.hoisted(() => ({
  testSessionFindUnique: vi.fn(),
  sessionQuestionFindUnique: vi.fn(),
  answerFindUnique: vi.fn(),
  codeRunCount: vi.fn(),
  codeRunCreate: vi.fn(),
  codeRunFindMany: vi.fn(),
  codeRunFindUnique: vi.fn(),
  codeRunUpdate: vi.fn(),
  enqueueMock: vi.fn(),
  createExecutorMock: vi.fn(),
  loadTemplateImagesMock: vi.fn(),
}));

vi.mock('../src/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    testSession: { findUnique: testSessionFindUnique },
    sessionQuestion: { findUnique: sessionQuestionFindUnique },
    answer: { findUnique: answerFindUnique },
    codeRun: {
      count: codeRunCount,
      create: codeRunCreate,
      findMany: codeRunFindMany,
      findUnique: codeRunFindUnique,
      update: codeRunUpdate,
    },
  },
}));

vi.mock('../src/lib/queue', () => ({ enqueue: enqueueMock }));
vi.mock('../src/lib/sandbox', () => ({ createExecutor: createExecutorMock }));
vi.mock('../src/modules/applications/evaluation.service', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadTemplateImages: loadTemplateImagesMock,
}));

import { createApp } from '../src/app';
import { runCodeRun } from '../src/modules/public/code-run.service';

const app = createApp();

// Distinct valid-shaped tokens per test — the run limiter is token-keyed and
// in-memory, so reusing one token across tests would burn its budget.
function token(n: string): string {
  // 43-char base64url-ish shape (32 random bytes); deterministic per test name.
  const pad = `${n}0123456789abcdefghijklmnopqrstuv`.replace(/[^A-Za-z0-9_-]/g, '');
  return (pad + 'wxyzWXYZ456789_-xyzwXYZ').slice(0, 43);
}

const FUTURE = new Date(Date.now() + 30 * 60_000);

function liveSession() {
  return {
    id: 'sess-1',
    jobId: 'job-1',
    status: 'STARTED',
    expiresAt: FUTURE,
    startedAt: new Date(Date.now() - 60_000),
    deadlineAt: FUTURE,
    job: { blueprint: { sections: [], timeLimitMin: 30 } },
  };
}

function prime() {
  vi.clearAllMocks();
  testSessionFindUnique.mockResolvedValue(liveSession());
  sessionQuestionFindUnique.mockResolvedValue({ id: 'sq-1', format: 'CODE' });
  answerFindUnique.mockResolvedValue({ content: { text: 'print("hi")' } });
  codeRunCount.mockResolvedValue(0);
  codeRunCreate.mockResolvedValue({ id: 'run-1', status: 'QUEUED' });
  enqueueMock.mockResolvedValue({ id: 'q-1' });
}

describe('POST /api/public/test/:token/run', () => {
  it('404s uniformly for an unknown token (no oracle)', async () => {
    prime();
    testSessionFindUnique.mockResolvedValue(null);
    const res = await request(app).post(`/api/public/test/${token('unk')}/run`).send({ order: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('409 SESSION_NOT_STARTED before the test starts', async () => {
    prime();
    testSessionFindUnique.mockResolvedValue({ ...liveSession(), status: 'ISSUED', deadlineAt: null });
    const res = await request(app).post(`/api/public/test/${token('ns')}/run`).send({ order: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SESSION_NOT_STARTED');
  });

  it('409 SESSION_EXPIRED past the never-pausing deadline', async () => {
    prime();
    testSessionFindUnique.mockResolvedValue({ ...liveSession(), deadlineAt: new Date(Date.now() - 1_000) });
    const res = await request(app).post(`/api/public/test/${token('exp')}/run`).send({ order: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('400 NOT_A_CODE_QUESTION for non-CODE formats', async () => {
    prime();
    sessionQuestionFindUnique.mockResolvedValue({ id: 'sq-1', format: 'MCQ' });
    const res = await request(app).post(`/api/public/test/${token('mcq')}/run`).send({ order: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_A_CODE_QUESTION');
  });

  it('409 NO_SAVED_ANSWER when nothing is saved yet', async () => {
    prime();
    answerFindUnique.mockResolvedValue(null);
    const res = await request(app).post(`/api/public/test/${token('nosave')}/run`).send({ order: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_SAVED_ANSWER');
  });

  it('409 RUN_CAP_REACHED at 30 runs for the session', async () => {
    prime();
    codeRunCount.mockResolvedValue(30);
    const res = await request(app).post(`/api/public/test/${token('cap')}/run`).send({ order: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RUN_CAP_REACHED');
    expect(codeRunCreate).not.toHaveBeenCalled();
  });

  it('202 + queues CODE_RUN with sanitized args; the body never carries code', async () => {
    prime();
    const res = await request(app)
      .post(`/api/public/test/${token('ok')}/run`)
      .send({ order: 2, args: ['--flag', 'x'.repeat(50)] });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ run: { id: 'run-1', status: 'QUEUED' } });
    expect(enqueueMock).toHaveBeenCalledWith('CODE_RUN', { codeRunId: 'run-1' });
    const created = codeRunCreate.mock.calls[0][0].data;
    expect(created.sessionQuestionId).toBe('sq-1');
    expect(created.argsUsed).toEqual(['--flag', 'x'.repeat(50)]);
  });

  it('429s the 7th run on the same token inside a minute (token-keyed bucket)', async () => {
    prime();
    const t = token('rate');
    for (let i = 0; i < 6; i++) {
      const res = await request(app).post(`/api/public/test/${t}/run`).send({ order: 1 });
      expect(res.status).toBe(202);
    }
    const res = await request(app).post(`/api/public/test/${t}/run`).send({ order: 1 });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('GET /api/public/test/:token/runs', () => {
  it('returns the candidate\'s own runs, newest first, args sanitized', async () => {
    prime();
    codeRunFindMany.mockResolvedValue([
      {
        id: 'run-9',
        status: 'DONE',
        argsUsed: ['ok', 42, 'also-ok'],
        exitCode: 0,
        durationMs: 120,
        stdout: 'hi\n',
        stderr: '',
        truncated: false,
        error: null,
        createdAt: new Date(0),
        sessionQuestion: { order: 2 },
      },
    ]);
    const res = await request(app).get(`/api/public/test/${token('list')}/runs?order=2`);
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0]).toMatchObject({ id: 'run-9', order: 2, status: 'DONE', exitCode: 0 });
    expect(res.body.runs[0].argsUsed).toEqual(['ok', 'also-ok']); // non-strings dropped
    const where = codeRunFindMany.mock.calls[0][0].where;
    expect(where.sessionQuestion).toEqual({ order: 2 });
  });
});

describe('CODE_RUN worker handler (runCodeRun)', () => {
  const execute = vi.fn();

  function runRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'run-1',
      status: 'QUEUED',
      argsUsed: ['a', 7, 'b', ...Array.from({ length: 12 }, (_, i) => `x${i}`)],
      sessionQuestion: {
        id: 'sq-1',
        format: 'CODE',
        presented: { language: 'PYTHON', prompt: 'p' },
        answer: { content: { text: 'print(1)' } },
        session: { id: 'sess-1', job: { companyId: 'co-1' } },
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockReset();
    createExecutorMock.mockReturnValue({ execute });
    loadTemplateImagesMock.mockResolvedValue(undefined);
    codeRunUpdate.mockResolvedValue({});
  });

  it('executes the SAVED code with sanitized args and lands DONE with output', async () => {
    codeRunFindUnique.mockResolvedValue(runRow());
    execute.mockResolvedValue({
      outcomes: [{ name: 'run', passed: true }],
      allPassed: true,
      stdout: '1\n',
      stderr: '',
      exitCode: 0,
      durationMs: 90,
      truncated: false,
    });
    await runCodeRun('run-1');

    expect(execute).toHaveBeenCalledTimes(1);
    const req = execute.mock.calls[0][0];
    expect(req.language).toBe('PYTHON');
    expect(req.code).toBe('print(1)');
    // Whitelist survived the round-trip through the DB: plain short strings
    // only, capped at 10 — no numbers, no overflow.
    expect(req.cases[0].args).toEqual(['a', 'b', 'x0', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7']);
    expect(req.cases[0].name).toBe('run');

    const data = codeRunUpdate.mock.calls[0][0].data;
    expect(data.status).toBe('DONE');
    expect(data.stdout).toBe('1\n');
    expect(data.exitCode).toBe(0);
    expect(data.error).toBeNull();
  });

  it('multi-file answers execute as the bootstrap script (marker line, no structured files)', async () => {
    codeRunFindUnique.mockResolvedValue(
      runRow({
        sessionQuestion: {
          ...runRow().sessionQuestion,
          answer: {
            content: {
              files: [
                { path: 'util.py', content: 'def double(x):\n    return x * 2\n' },
                { path: 'main.py', content: 'from util import double\nprint(double(4))\n' },
              ],
              entry: 'main.py',
            },
          },
        },
      }),
    );
    execute.mockResolvedValue({ outcomes: [], allPassed: true, stdout: '8\n', stderr: '', exitCode: 0, durationMs: 5, truncated: false });
    await runCodeRun('run-1');

    const req = execute.mock.calls[0][0];
    expect(req.language).toBe('PYTHON');
    expect(req.files).toBeUndefined(); // strings only reach the executor
    expect(req.code.split('\n')[0]).toBe('#__provahr_multifile__');
    expect(req.code).toContain(`exec python 'main.py' "$@"`);
    expect(codeRunUpdate.mock.calls[0][0].data).toMatchObject({ status: 'DONE', stdout: '8\n' });
  });

  it('passes resolved company template images to the executor', async () => {
    codeRunFindUnique.mockResolvedValue(runRow());
    execute.mockResolvedValue({ outcomes: [], allPassed: true, stdout: '', stderr: '', exitCode: 0, durationMs: 1, truncated: false });
    loadTemplateImagesMock.mockResolvedValue({ PYTHON: 'registry.local/py:3.12' });
    await runCodeRun('run-1');
    expect(loadTemplateImagesMock).toHaveBeenCalledWith('co-1');
    expect(createExecutorMock).toHaveBeenCalledWith('docker', undefined, { images: { PYTHON: 'registry.local/py:3.12' } });
  });

  it('marks FAILED without executing when the question is not CODE', async () => {
    codeRunFindUnique.mockResolvedValue(runRow({ sessionQuestion: { ...runRow().sessionQuestion, format: 'WRITTEN' } }));
    await runCodeRun('run-1');
    expect(execute).not.toHaveBeenCalled();
    expect(codeRunUpdate.mock.calls[0][0].data).toMatchObject({ status: 'FAILED' });
  });

  it('marks FAILED and rethrows SANDBOX_UNAVAILABLE for the queue retry', async () => {
    codeRunFindUnique.mockResolvedValue(runRow());
    execute.mockRejectedValue(new AppError(503, 'docker unavailable', 'SANDBOX_UNAVAILABLE'));
    await expect(runCodeRun('run-1')).rejects.toMatchObject({ code: 'SANDBOX_UNAVAILABLE' });
    expect(codeRunUpdate.mock.calls[0][0].data).toMatchObject({ status: 'FAILED' });
  });

  it('is a no-op for already-terminal or vanished rows', async () => {
    codeRunFindUnique.mockResolvedValue(null);
    await runCodeRun('run-1');
    codeRunFindUnique.mockResolvedValue(runRow({ status: 'DONE' }));
    await runCodeRun('run-1');
    expect(execute).not.toHaveBeenCalled();
    expect(codeRunUpdate).not.toHaveBeenCalled();
  });
});
