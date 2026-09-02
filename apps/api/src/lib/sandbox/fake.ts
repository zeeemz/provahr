// Deterministic FakeExecutor for tests (docs/TESTING.md §1 "deterministic by
// default"; Phase 8 evaluation fixtures). No docker, no clock, no I/O — either
// a caller-supplied script produces the SandboxResponse, or the default
// "canned echo" script: it pretends the candidate's program echoed every
// case's expectations exactly (stdout matches, exit code matches, no
// timeout), so every case passes. That default gives Phase 8+ tests a
// provably-green executor without touching a container.

import { compareCase, summarize } from './judge';
import type { SandboxExecutor, SandboxRequest, SandboxResponse } from './types';

/** A pluggable executor behavior — async allowed, deterministic expected. */
export type FakeScript = (req: SandboxRequest) => SandboxResponse | Promise<SandboxResponse>;

/** Default behavior: every case passes (expectations echoed back verbatim). */
function cannedEcho(req: SandboxRequest): SandboxResponse {
  const outcomes = req.cases.map((testCase) =>
    compareCase(testCase, {
      stdout: testCase.expectedStdout ?? '',
      exitCode: testCase.expectedExit ?? 0,
      timedOut: false,
    }),
  );
  return {
    outcomes,
    ...summarize(outcomes),
    stdout: req.cases.map((c) => c.expectedStdout ?? '').join(''),
    stderr: '',
    exitCode: req.cases.length === 0 ? null : (req.cases[req.cases.length - 1]!.expectedExit ?? 0),
    durationMs: 0,
    truncated: false,
  };
}

export class FakeExecutor implements SandboxExecutor {
  constructor(private readonly script: FakeScript = cannedEcho) {}

  async execute(req: SandboxRequest): Promise<SandboxResponse> {
    return this.script(req);
  }
}
