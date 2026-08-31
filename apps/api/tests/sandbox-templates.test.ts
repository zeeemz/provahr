// V2-4 (PLAN.md §12 D21, §12.1) — company-scoped sandbox image templates.
//
// Three tiers, mirroring the house style:
// 1. PURE: resolveImage / isSafeImageRef (templates.ts has zero side effects —
//    these tests ARE the resolution contract: enabled+safe template overrides,
//    everything else falls back to the platform default).
// 2. Pure HARDENING interplay with the builder lives in sandbox-builder.test.ts
//    (template-image battery against assertHardenedArgs).
// 3. The EVALUATION THREADING describe at the bottom (mocked prisma + a doMock
//    of the sandbox module, house pattern from evaluation-routes.test.ts):
//    proof that runEvaluation resolves the session's COMPANY templates and
//    threads them into createExecutor — and that no-template runs keep the
//    exact historical createExecutor('docker') call.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  IMAGE_ALLOW_LIST,
  isSafeImageRef,
  MAX_IMAGE_REF_LENGTH,
  resolveImage,
} from '../src/lib/sandbox/templates';
import { CODE_LANGUAGES, type CodeLanguage } from '../src/lib/assessment/item';
import { AppError } from '../src/lib/http';
import { buildRunArgs } from '../src/lib/sandbox/builder';

// ─── 1. isSafeImageRef — the shape guard (SAVE-time + BUILD-time check) ───────

describe('isSafeImageRef', () => {
  it('accepts the three platform defaults', () => {
    for (const image of Object.values(IMAGE_ALLOW_LIST)) {
      expect(isSafeImageRef(image)).toBe(true);
    }
  });

  it('accepts registry-qualified refs with port, path and tag', () => {
    expect(isSafeImageRef('registry.example.com:5000/team/app:v1.2')).toBe(true);
    expect(isSafeImageRef('ghcr.io/acme/java-exercises:21')).toBe(true);
    expect(isSafeImageRef('docker.internal/java-21-maven:latest')).toBe(true);
  });

  it('accepts untagged and single-component refs', () => {
    expect(isSafeImageRef('myimg')).toBe(true);
    expect(isSafeImageRef('team/image')).toBe(true);
  });

  it('rejects uppercase (docker repos are lowercase)', () => {
    expect(isSafeImageRef('Node:20')).toBe(false);
    expect(isSafeImageRef('acme/Java:21')).toBe(false);
    expect(isSafeImageRef('BASH:5.2')).toBe(false);
  });

  it('rejects flag-like strings (could parse as docker flags)', () => {
    expect(isSafeImageRef('--flag')).toBe(false);
    expect(isSafeImageRef('-v')).toBe(false);
    expect(isSafeImageRef('--privileged')).toBe(false);
    expect(isSafeImageRef('--network')).toBe(false);
  });

  it('rejects shell/flag metacharacters anywhere', () => {
    expect(isSafeImageRef('evil.com/a:b$c')).toBe(false);
    expect(isSafeImageRef('a b')).toBe(false); // whitespace
    expect(isSafeImageRef('a;b')).toBe(false);
    expect(isSafeImageRef('a`id`b')).toBe(false);
    expect(isSafeImageRef('a=b')).toBe(false);
    expect(isSafeImageRef('a,b')).toBe(false);
    expect(isSafeImageRef('app@sha256:abc')).toBe(false); // digests unsupported by design
  });

  it('rejects empty and over-length refs', () => {
    expect(isSafeImageRef('')).toBe(false);
    expect(isSafeImageRef('a'.repeat(MAX_IMAGE_REF_LENGTH + 1) + ':1')).toBe(false);
    // …while exactly at the ceiling still passes (boundary).
    expect(isSafeImageRef('a'.repeat(MAX_IMAGE_REF_LENGTH - 2) + ':1')).toBe(true);
  });

  it('rejects malformed docker refs (grammar, not just charset)', () => {
    expect(isSafeImageRef(':tag')).toBe(false); // no name
    expect(isSafeImageRef('app:')).toBe(false); // empty tag
    expect(isSafeImageRef('/leading/slash')).toBe(false);
    expect(isSafeImageRef('trailing/')).toBe(false);
    expect(isSafeImageRef('a//b')).toBe(false); // empty path component
  });

  it('rejects non-strings (defensive: unknown input never passes)', () => {
    expect(isSafeImageRef(42)).toBe(false);
    expect(isSafeImageRef(null)).toBe(false);
    expect(isSafeImageRef(undefined)).toBe(false);
    expect(isSafeImageRef({ image: 'bash:5.2' })).toBe(false);
    expect(isSafeImageRef(['bash:5.2'])).toBe(false);
  });
});

// ─── 2. resolveImage — the resolution matrix ──────────────────────────────────

describe('resolveImage', () => {
  it('returns the platform default for every language when no template exists', () => {
    for (const language of CODE_LANGUAGES) {
      expect(resolveImage(language)).toBe(IMAGE_ALLOW_LIST[language]);
      expect(resolveImage(language, null)).toBe(IMAGE_ALLOW_LIST[language]);
    }
  });

  it('overrides with an enabled, safe template image', () => {
    expect(resolveImage('NODE', { image: 'registry.acme.test/node:20-ci', enabled: true })).toBe(
      'registry.acme.test/node:20-ci',
    );
  });

  it('treats a missing `enabled` field as enabled (model default true)', () => {
    expect(resolveImage('PYTHON', { image: 'acme/python-ci:3.12' })).toBe('acme/python-ci:3.12');
  });

  it('falls back to the default for a DISABLED template (enabled=false is the off-switch)', () => {
    expect(resolveImage('NODE', { image: 'registry.acme.test/node:20-ci', enabled: false })).toBe(
      IMAGE_ALLOW_LIST.NODE,
    );
  });

  it('falls back to the default when the stored image is UNSAFE (fail toward the safe image)', () => {
    for (const unsafe of ['--privileged', 'Node:20', 'a b', 'evil.com/a:b$c', '']) {
      expect(resolveImage('BASH', { image: unsafe, enabled: true })).toBe(IMAGE_ALLOW_LIST.BASH);
    }
  });

  it('a template equal to the default resolves to the default (no-op override)', () => {
    expect(resolveImage('BASH', { image: IMAGE_ALLOW_LIST.BASH, enabled: true })).toBe(IMAGE_ALLOW_LIST.BASH);
  });

  it('throws SANDBOX_LANGUAGE_UNSUPPORTED for a language with no allow-list entry', () => {
    for (const bad of ['RUST' as CodeLanguage, 'JAVA' as CodeLanguage, '__proto__' as never]) {
      try {
        resolveImage(bad);
        throw new Error(`expected AppError for ${String(bad)} — nothing threw`);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('SANDBOX_LANGUAGE_UNSUPPORTED');
      }
    }
  });

  it('round-trips into buildRunArgs: a resolved override lands in the image slot', () => {
    const image = resolveImage('NODE', { image: 'registry.acme.test/node:20-ci' });
    const args = buildRunArgs({ language: 'NODE' }, { image });
    expect(args[args.length - 2]).toBe('node'); // interpreter stays put…
    expect(args).toContain('registry.acme.test/node:20-ci'); // …image swapped in
    expect(args).not.toContain(IMAGE_ALLOW_LIST.NODE);
  });
});

// ─── 3. Evaluation threading (mocked prisma + doMock'd sandbox) ───────────────
//
// The prisma mock registry (hoisted) covers exactly the models runEvaluation
// touches; the sandbox module is doMock'd per test so createExecutor's ARGS
// are observable. The CODE pool row runs the REAL crypto round-trip (house
// style from evaluation-routes.test.ts).

const {
  testSessionFindUnique,
  sessionQuestionFindMany,
  poolFindFirst,
  voidedItemFindMany,
  voidedItemFindUnique,
  llmProviderFindFirst,
  evaluationFindUnique,
  evaluationUpsert,
  evaluationFindMany,
  executionResultUpsert,
  sessionAssessmentUpsert,
  sessionSignalFindMany,
  sandboxTemplateFindMany,
} = vi.hoisted(() => ({
  testSessionFindUnique: vi.fn(),
  sessionQuestionFindMany: vi.fn(),
  poolFindFirst: vi.fn(),
  voidedItemFindMany: vi.fn(),
  voidedItemFindUnique: vi.fn(),
  llmProviderFindFirst: vi.fn(),
  evaluationFindUnique: vi.fn(),
  evaluationUpsert: vi.fn(),
  evaluationFindMany: vi.fn(),
  executionResultUpsert: vi.fn(),
  sessionAssessmentUpsert: vi.fn(),
  sessionSignalFindMany: vi.fn(),
  sandboxTemplateFindMany: vi.fn(),
}));

vi.mock('../src/prisma', () => ({
  prisma: {
    testSession: { findUnique: testSessionFindUnique },
    sessionQuestion: { findMany: sessionQuestionFindMany },
    sealedQuestionPool: { findFirst: poolFindFirst },
    voidedItem: { findMany: voidedItemFindMany, findUnique: voidedItemFindUnique },
    llmProvider: { findFirst: llmProviderFindFirst },
    evaluation: { findUnique: evaluationFindUnique, findMany: evaluationFindMany, upsert: evaluationUpsert },
    executionResult: { upsert: executionResultUpsert },
    sessionAssessment: { upsert: sessionAssessmentUpsert },
    sessionSignal: { findMany: sessionSignalFindMany },
    sandboxTemplate: { findMany: sandboxTemplateFindMany },
  },
}));

import { encryptSecret } from '../src/lib/crypto';
import type { AssessmentItem } from '../src/lib/assessment/item';

/** One submitted CODE session belonging to company-1 (V2-2 companyId seam). */
function primeCodeSession(): void {
  testSessionFindUnique.mockResolvedValue({
    id: 'sess-1',
    jobId: 'job-1',
    status: 'SUBMITTED',
    job: { companyId: 'company-1' },
  });
  const item: AssessmentItem = {
    id: 'item-code',
    format: 'CODE',
    prompt: 'Sum two argv ints.',
    language: 'NODE',
    hiddenCases: [
      { name: 'basic', args: ['2', '3'], expectedStdout: '5' },
      { name: 'negative', args: ['-1', '1'], expectedStdout: '0' }, // schema floor: min 2 cases
    ],
    difficulty: 'EASY',
    topics: ['node'],
  };
  poolFindFirst.mockResolvedValue({ itemsEncrypted: encryptSecret(JSON.stringify([item])) });
  sessionQuestionFindMany.mockImplementation(
    async (args: { where: Record<string, unknown> }) => {
      const where = args?.where ?? {};
      if (typeof where.sessionId === 'string') {
        return [
          {
            id: 'sq-c',
            order: 1,
            format: 'CODE',
            itemId: 'item-code',
            answer: {
              content: { text: 'console.log(Number(process.argv[2]) + Number(process.argv[3]))' },
              revisions: 0,
              firstAnsweredAt: new Date('2026-08-29T10:00:00Z'),
              lastAnsweredAt: new Date('2026-08-29T10:00:05Z'),
            },
          },
        ];
      }
      return []; // collusion probes + rollup reads
    },
  );
  voidedItemFindMany.mockResolvedValue([]);
  voidedItemFindUnique.mockResolvedValue(null);
  llmProviderFindFirst.mockResolvedValue(null); // degraded: no LLM, deterministic scoring
  evaluationFindUnique.mockResolvedValue(null);
  evaluationUpsert.mockResolvedValue({});
  evaluationFindMany.mockResolvedValue([]);
  executionResultUpsert.mockResolvedValue({});
  sessionAssessmentUpsert.mockResolvedValue({});
  sessionSignalFindMany.mockResolvedValue([]);
}

describe('runEvaluation — company sandbox template threading (V2-4, D21)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("threads the company's resolved template images into createExecutor", async () => {
    primeCodeSession();
    sandboxTemplateFindMany.mockResolvedValue([
      { language: 'NODE', image: 'registry.acme.test/node:20-ci' },
      { language: 'BASH', image: IMAGE_ALLOW_LIST.BASH }, // no-op override: not threaded
    ]);

    const createExecutorArgs: unknown[][] = [];
    vi.resetModules();
    vi.doMock('../src/lib/sandbox', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/lib/sandbox')>();
      return {
        ...actual,
        createExecutor: (...args: unknown[]) => {
          createExecutorArgs.push(args);
          return new actual.FakeExecutor(() => ({
            outcomes: [{ name: 'basic', passed: true }],
            allPassed: true,
            stdout: '5\n',
            stderr: '',
            exitCode: 0,
            durationMs: 5,
            truncated: false,
          }));
        },
      };
    });
    const { runEvaluation } = await import('../src/modules/applications/evaluation.service');
    await runEvaluation('sess-1');

    // The template lookup is company-scoped (V2-2 companyId seam)…
    expect(sandboxTemplateFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'company-1', enabled: true } }),
    );
    // …only the languages that actually OVERRIDE ride along (BASH no-op dropped)…
    expect(createExecutorArgs).toEqual([
      ['docker', undefined, { images: { NODE: 'registry.acme.test/node:20-ci' } }],
    ]);
    // …and the execution still ran + scored (fake executor answered).
    expect(executionResultUpsert).toHaveBeenCalledTimes(1);
    expect(evaluationUpsert).toHaveBeenCalledTimes(1);

    vi.doUnmock('../src/lib/sandbox');
    vi.resetModules();
  });

  it('keeps the exact historical createExecutor("docker") call when the company has no overrides', async () => {
    primeCodeSession();
    sandboxTemplateFindMany.mockResolvedValue([]); // no templates at all

    const createExecutorArgs: unknown[][] = [];
    vi.resetModules();
    vi.doMock('../src/lib/sandbox', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/lib/sandbox')>();
      return {
        ...actual,
        createExecutor: (...args: unknown[]) => {
          createExecutorArgs.push(args);
          return new actual.FakeExecutor();
        },
      };
    });
    const { runEvaluation } = await import('../src/modules/applications/evaluation.service');
    await runEvaluation('sess-1');

    expect(createExecutorArgs).toEqual([['docker']]); // byte-for-byte the pre-V2-4 seam
    vi.doUnmock('../src/lib/sandbox');
    vi.resetModules();
  });

  it('degrades an UNSAFE stored template to the default (never surfaces as an override)', async () => {
    primeCodeSession();
    sandboxTemplateFindMany.mockResolvedValue([{ language: 'NODE', image: '--privileged' }]);

    const createExecutorArgs: unknown[][] = [];
    vi.resetModules();
    vi.doMock('../src/lib/sandbox', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/lib/sandbox')>();
      return {
        ...actual,
        createExecutor: (...args: unknown[]) => {
          createExecutorArgs.push(args);
          return new actual.FakeExecutor();
        },
      };
    });
    const { runEvaluation } = await import('../src/modules/applications/evaluation.service');
    await runEvaluation('sess-1');

    // The unsafe row resolved to the default ⇒ no images map ⇒ default call.
    expect(createExecutorArgs).toEqual([['docker']]);
    vi.doUnmock('../src/lib/sandbox');
    vi.resetModules();
  });

  it('never queries templates for swipe/mcq-only sessions (lazy resolution)', async () => {
    testSessionFindUnique.mockResolvedValue({
      id: 'sess-2',
      jobId: 'job-1',
      status: 'SUBMITTED',
      job: { companyId: 'company-1' },
    });
    poolFindFirst.mockResolvedValue({
      itemsEncrypted: encryptSecret(
        JSON.stringify([
          {
            id: 'item-mcq',
            format: 'MCQ',
            prompt: '1+1?',
            options: [
              { id: 'a', text: '1' },
              { id: 'b', text: '2' },
            ],
            correctOptionId: 'b',
            difficulty: 'EASY',
            topics: ['math'],
          } satisfies AssessmentItem,
        ]),
      ),
    });
    sessionQuestionFindMany.mockImplementation(async () => [
      {
        id: 'sq-m',
        order: 1,
        format: 'MCQ',
        itemId: 'item-mcq',
        answer: { content: { optionId: 'b' }, revisions: 0, firstAnsweredAt: null, lastAnsweredAt: null },
      },
    ]);
    voidedItemFindMany.mockResolvedValue([]);
    voidedItemFindUnique.mockResolvedValue(null);
    llmProviderFindFirst.mockResolvedValue(null);
    evaluationFindUnique.mockResolvedValue(null);
    evaluationUpsert.mockResolvedValue({});
    evaluationFindMany.mockResolvedValue([]);
    sessionAssessmentUpsert.mockResolvedValue({});
    sessionSignalFindMany.mockResolvedValue([]);

    const { runEvaluation } = await import('../src/modules/applications/evaluation.service');
    await runEvaluation('sess-2');

    expect(sandboxTemplateFindMany).not.toHaveBeenCalled(); // no CODE answer, no lookup
  });
});
