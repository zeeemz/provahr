// Docker-backed SandboxExecutor (PLAN.md Phase 7, §10 "Sandbox hardening
// (v1 Docker)"; docs/TESTING.md T4). Spawns `docker run` per hidden case with
// argv built EXCLUSIVELY by builder.buildRunArgs — this file never assembles a
// docker flag itself, never builds a shell string (spawn takes an argv array),
// and re-runs builder.assertHardenedArgs before every single spawn plus once
// at construction (fail fast at boot).
//
// LIVE-DOCKER VERIFICATION IS DEFERRED TO PHASE 10 deploy testing: the Docker
// daemon does not run on dev machines, so this adapter is verified here only
// through its pure argv construction (tests/sandbox-builder.test.ts) and the
// judging logic (tests/sandbox-judge.test.ts). The spawn plumbing below is
// intentionally boring and standard child_process usage.
//
// v1 stdin policy (decision, types.ts header): the PROGRAM travels via stdin
// (`<interpreter> -`), so a case that ALSO wants to feed the program stdin
// cannot run — builder.buildRunArgs throws SANDBOX_V1_NO_STDIN and the case is
// judged failed-with-note (judge.stdinUnsupportedOutcome) instead of failing
// the whole execution. Cases drive programs via argv only.
//
// Known v1 gap (revisit with Phase 10 live testing): on timeout we SIGKILL
// the docker CLI client; the container itself is terminated by dockerd's
// --stop-timeout backstop and reaped by --rm. Phase 10 must verify containers
// actually die on runaway code (docs/TESTING.md T4 "limits kill runaway code").
//
// V2-4 (PLAN §12 D21): the constructor accepts per-language image overrides
// (the caller's RESOLVED company templates — ImageOverrides). Every build and
// every assert uses the same resolution context, so a template image lands in
// the argv exactly where the platform default would, under byte-identical
// hardening flags.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { CODE_LANGUAGES, type CodeLanguage } from '../assessment/item';
import { AppError } from '../http';
import { assertHardenedArgs, buildRunArgs, stdinPayload } from './builder';
import { compareCase, stdinUnsupportedOutcome, summarize } from './judge';
import {
  OUTPUT_CAP_BYTES,
  PER_CASE_TIMEOUT_MS,
  type CaseOutcome,
  type SandboxExecutor,
  type SandboxRequest,
  type SandboxResponse,
} from './types';

/**
 * V2-4 (D21): per-language image overrides for ONE evaluation run — the
 * company's resolved sandbox templates (evaluation.service builds this from
 * resolveImage output). Languages absent from the map resolve to the platform
 * default; present entries are validated by buildRunArgs (unsafe →
 * SANDBOX_TEMPLATE_UNSAFE) before anything is spawned.
 */
export type ImageOverrides = Partial<Record<CodeLanguage, string>>;

/** One `docker run` outcome (per case) before judging. */
interface SingleRun {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
}

/** Byte-capped accumulator for one output stream. */
class CappedBuffer {
  private chunks: Buffer[] = [];
  private length = 0;
  truncated = false;

  push(chunk: Buffer): void {
    if (this.length >= OUTPUT_CAP_BYTES) {
      this.truncated = true; // keep draining so the child never blocks on a full pipe
      return;
    }
    this.chunks.push(chunk);
    this.length += chunk.length;
    if (this.length > OUTPUT_CAP_BYTES) this.truncated = true;
  }

  /** The first OUTPUT_CAP_BYTES bytes as UTF-8 (already-capped stream). */
  text(): string {
    return Buffer.concat(this.chunks).subarray(0, OUTPUT_CAP_BYTES).toString('utf8');
  }
}

export class DockerExecutor implements SandboxExecutor {
  constructor(
    private readonly timeoutMs: number = PER_CASE_TIMEOUT_MS,
    private readonly images: ImageOverrides = {},
  ) {
    // Boot-time fail-fast: prove the argv this class would build for EVERY
    // language satisfies the hardening invariants, ONCE — a regression in
    // builder.ts kills the process at startup instead of at candidate expense.
    // (Default images only: template images arrive per run and are validated
    // below on every build — unsafe ones throw before any spawn.)
    for (const language of CODE_LANGUAGES) {
      assertHardenedArgs(buildRunArgs({ language }, { timeoutMs }));
    }
  }

  /** The image override for `language` under this run's templates, if any. */
  private imageFor(language: CodeLanguage): string | undefined {
    // hasOwnProperty guard (QA wave-7 F5): '__proto__' must not resolve.
    return Object.prototype.hasOwnProperty.call(this.images, language) ? this.images[language] : undefined;
  }

  async execute(req: SandboxRequest): Promise<SandboxResponse> {
    const startedAt = Date.now();
    const outcomes: CaseOutcome[] = [];
    const stdouts: string[] = [];
    const stderrs: string[] = [];
    let truncated = false;
    let exitCode: number | null = null;

    // One resolution context for build + assert: THE SAME image (when the
    // company template overrides it) and timeout go into both, so the
    // exact-prefix checker verifies precisely the argv that was built.
    const image = this.imageFor(req.language);
    const opts: { timeoutMs: number; image?: string } = { timeoutMs: this.timeoutMs };
    if (image !== undefined) opts.image = image;

    for (const testCase of req.cases) {
      let args: string[];
      try {
        args = buildRunArgs({ language: req.language, case: testCase }, opts);
      } catch (err) {
        if (err instanceof AppError && err.code === 'SANDBOX_V1_NO_STDIN') {
          // v1 limitation: fail the case with an explanatory note, keep running
          // the item's other cases (args-only) — never abort the whole answer.
          outcomes.push(stdinUnsupportedOutcome(testCase));
          continue;
        }
        throw err; // incl. SANDBOX_TEMPLATE_UNSAFE — fail closed, queue retries
      }
      // Defense in depth: even though buildRunArgs just produced this argv,
      // the invariant checker runs again before anything is spawned —
      // parameterized over the same resolved image (V2-4).
      assertHardenedArgs(args, opts);

      const run = await this.runOne(args, stdinPayload(req, testCase));
      outcomes.push(compareCase(testCase, { stdout: run.stdout, exitCode: run.exitCode, timedOut: run.timedOut }));
      stdouts.push(run.stdout);
      stderrs.push(run.stderr);
      truncated = truncated || run.truncated;
      exitCode = run.exitCode;
    }

    const stdoutCapped = capBytes(stdouts.join(''));
    const stderrCapped = capBytes(stderrs.join(''));
    return {
      outcomes,
      ...summarize(outcomes),
      stdout: stdoutCapped.text,
      stderr: stderrCapped.text,
      exitCode,
      durationMs: Date.now() - startedAt,
      truncated: truncated || stdoutCapped.truncated || stderrCapped.truncated,
    };
  }

  /** Runs one hardened container; pipes `program` to its stdin. */
  private runOne(args: string[], program: string): Promise<SingleRun> {
    return new Promise<SingleRun>((resolve, reject) => {
      // Windows note: spawn('docker', …) resolves docker.exe through PATH when
      // Docker Desktop exists; absence surfaces as an ENOENT 'error' event.
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn('docker', ['run', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (err) {
        reject(toUnavailable(err));
        return;
      }

      const stdout = new CappedBuffer();
      const stderr = new CappedBuffer();
      let timedOut = false;
      let settled = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL'); // --stop-timeout is dockerd's container backstop
      }, this.timeoutMs);

      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      // EPIPE on stdin just means the process died early — the close event
      // carries the real exit code; never let it crash the worker.
      child.stdin.on('error', () => {});
      child.stdin.write(program);
      child.stdin.end();

      child.on('error', (err) => settle(() => reject(toUnavailable(err))));
      child.on('close', (code) =>
        settle(() =>
          resolve({
            stdout: stdout.text(),
            stderr: stderr.text(),
            exitCode: code,
            timedOut,
            truncated: stdout.truncated || stderr.truncated,
          }),
        ),
      );
    });
  }
}

/** Byte-accurate final cap for the aggregate streams. */
function capBytes(text: string): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= OUTPUT_CAP_BYTES) return { text, truncated: false };
  const bytes = Buffer.from(text, 'utf8').subarray(0, OUTPUT_CAP_BYTES);
  return { text: bytes.toString('utf8'), truncated: true };
}

/** Spawn failures mean no Docker on this host — an availability, not a judge, problem. */
function toUnavailable(err: unknown): AppError {
  const message = err instanceof Error ? err.message : String(err);
  return new AppError(
    503,
    `Docker not available on this host: ${message}`,
    'SANDBOX_UNAVAILABLE',
  );
}
