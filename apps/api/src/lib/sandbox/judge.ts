// PURE case judging for the sandbox (PLAN.md Phase 7, §5.2 mechanism 3;
// docs/TESTING.md T4 "hidden test-case harness"). No I/O, no clock, no docker:
// given a SandboxCase and what actually happened, decide pass/fail. This is
// where "a memorized or ChatGPT'd answer must still EXECUTE correctly against
// cases it has never seen" becomes a boolean.

import type { CaseOutcome, SandboxCase } from './types';

/** Excerpt cap for expected/actual stdout stored in CaseOutcome (chars). */
export const EXCERPT_CAP = 200;

/**
 * Canonical stdout form for comparison: CRLF → LF, per-line trailing
 * whitespace (spaces/tabs) trimmed, trailing blank lines dropped, and exactly
 * one trailing newline on non-empty output. Candidates on any OS produce
 * comparable text; missing/extra trailing newlines never fail a case.
 */
export function normalizeStdout(s: string): string {
  const lines = s
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/**
 * Pure helper: cap `s` at EXCERPT_CAP characters, ending with an ellipsis
 * character when truncated. Total length never exceeds EXCERPT_CAP.
 */
export function excerpt(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  if (s.length <= EXCERPT_CAP) return s;
  return `${s.slice(0, EXCERPT_CAP - 1)}…`;
}

/**
 * Judges one hidden case against the actual run:
 *   passed = !timedOut
 *         AND (expectedStdout absent OR normalizeStdout-equal)
 *         AND (expectedExit absent ⇒ exitCode === 0; present ⇒ exact match).
 * The item schema guarantees at least one expectation; a case with NEITHER
 * (schema-impossible) degrades to "ran cleanly" (exit 0) — the judge never
 * throws on case shape. Timeout always fails, even with matching output.
 */
export function compareCase(
  c: SandboxCase,
  actual: { stdout: string; exitCode: number | null; timedOut: boolean },
): CaseOutcome {
  const stdoutOk =
    c.expectedStdout === undefined ||
    normalizeStdout(actual.stdout) === normalizeStdout(c.expectedStdout);
  const exitOk =
    c.expectedExit === undefined ? actual.exitCode === 0 : actual.exitCode === c.expectedExit;

  return {
    name: c.name,
    passed: !actual.timedOut && stdoutOk && exitOk,
    expectedStdoutExcerpt: excerpt(c.expectedStdout),
    actualStdoutExcerpt: excerpt(actual.stdout),
    expectedExit: c.expectedExit,
    actualExit: actual.exitCode ?? undefined,
    timedOut: actual.timedOut,
  };
}

/** The aggregate verdict over all cases (feeds SandboxResponse.allPassed). */
export function summarize(outcomes: CaseOutcome[]): { allPassed: boolean } {
  return { allPassed: outcomes.every((o) => o.passed) };
}

/**
 * Outcome for a case the v1 executor CANNOT run (case.stdin — see
 * builder.buildRunArgs / types.ts header). Fails closed WITH a note so the
 * Phase 8 X-ray explains the zero instead of showing a mystery failure.
 */
export function stdinUnsupportedOutcome(c: SandboxCase): CaseOutcome {
  return {
    name: c.name,
    passed: false,
    expectedStdoutExcerpt: excerpt(c.expectedStdout),
    actualStdoutExcerpt: undefined,
    expectedExit: c.expectedExit,
    actualExit: undefined,
    timedOut: false,
    note: 'Case feeds the program via stdin — not executable in sandbox v1 (args-only cases are supported).',
  };
}
