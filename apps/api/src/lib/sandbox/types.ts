// Sandbox executor vocabulary (PLAN.md Phase 7, §5.2 mechanism 3 — hidden
// test cases; §10 "Sandbox hardening (v1 Docker)"; docs/TESTING.md T4).
//
// This module runs UNTRUSTED candidate code. The contract below is kept
// deliberately small: an executor takes the candidate's program plus the
// item's hidden cases and returns per-case outcomes plus capped process
// output. ALL container hardening lives in builder.ts (pure, exhaustively
// tested); docker.ts only spawns what builder.ts produced — never a shell
// string, never a hand-rolled argv.
//
// V1 LIMITATION (deliberate — see builder.ts for the decision): cases that
// feed the program via `stdin` are NOT executable in sandbox v1, because the
// program itself reaches the container through stdin (the `-` interpreter
// convention). `hiddenCaseSchema` (lib/assessment/item.ts) still allows
// `stdin`, so such cases are judged as failed-with-note (`SANDBOX_V1_NO_STDIN`)
// rather than crashing the run. Cases drive the program via `args` +
// `expectedExit`/`expectedStdout`. Live docker verification is deferred to
// Phase 10 deploy testing — the Docker daemon is not running on dev machines.

import type { CodeLanguage } from '../assessment/item';

/**
 * One hidden test case — mirrors `hiddenCaseSchema` (lib/assessment/item.ts).
 * At least one expectation (`expectedStdout`/`expectedExit`) is guaranteed by
 * the item schema; `stdin` is tolerated here but rejected by the v1 builder.
 */
export interface SandboxCase {
  name: string;
  stdin?: string;
  args?: string[];
  expectedStdout?: string;
  expectedExit?: number;
}

/**
 * Per-case verdict persisted in `execution_results.caseResults` (Prisma) and
 * shown to HR in the Phase 8 X-ray. Excerpts are capped (judge.ts excerpt()) —
 * a runaway program must not bloat the database. `note` carries executor-side
 * explanations (e.g. the v1 stdin limitation) — never judging detail.
 */
export interface CaseOutcome {
  name: string;
  passed: boolean;
  expectedStdoutExcerpt?: string;
  actualStdoutExcerpt?: string;
  expectedExit?: number;
  actualExit?: number;
  timedOut?: boolean;
  note?: string;
}

/** One file of a multi-file CODE answer (IDE wave 2). Paths are validated by
 *  the answer normalizer AND again by the bootstrap generator — both use the
 *  same traversal-free grammar (lib/assessment/codeAnswer.ts). */
export interface SandboxFile {
  path: string;
  content: string;
}

/** What the evaluation worker (Phase 8) asks the sandbox to run. */
export interface SandboxRequest {
  language: CodeLanguage;
  /** The program: raw single-file source, or a pre-built bootstrap script
   *  (multi-file) recognizable by builder.ts's BOOTSTRAP_MARKER first line. */
  code: string;
  cases: SandboxCase[];
  /** Multi-file arm (IDE wave 2): materialized in-container by a bootstrap. */
  files?: SandboxFile[];
  /** Entry path within `files` that the interpreter executes. */
  entry?: string;
}

/** Aggregate over all cases — feeds the ExecutionResult row verbatim. */
export interface SandboxResponse {
  outcomes: CaseOutcome[];
  allPassed: boolean;
  /** Concatenated per-case output, byte-capped (OUTPUT_CAP_BYTES). */
  stdout: string;
  stderr: string;
  /** Exit code of the LAST executed case (docker run's exit status). */
  exitCode: number | null;
  durationMs: number;
  truncated: boolean;
}

/**
 * The executor seam. Production: DockerExecutor (docker.ts). Tests and Phase 8
 * fixtures: FakeExecutor (fake.ts). Only builder-validated argv is ever
 * spawned — see builder.assertHardenedArgs.
 */
export interface SandboxExecutor {
  execute(req: SandboxRequest): Promise<SandboxResponse>;
}

/** Per-stream output ceiling: stdout and stderr are each capped at 64 KiB. */
export const OUTPUT_CAP_BYTES = 65_536;

/** Wall-clock budget per hidden case (docker --stop-timeout mirrors this). */
export const PER_CASE_TIMEOUT_MS = 10_000;
