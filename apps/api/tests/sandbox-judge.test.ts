// Pure judging tests for the sandbox (PLAN.md Phase 7, §5.2 mechanism 3 —
// hidden test cases; docs/TESTING.md T4 "hidden test-case harness"). No docker,
// no clock: every case is a fixture. Also pins the FakeExecutor contract that
// Phase 8 evaluation tests will stand on.

import { describe, it, expect } from 'vitest';
import {
  EXCERPT_CAP,
  compareCase,
  excerpt,
  normalizeStdout,
  stdinUnsupportedOutcome,
  summarize,
} from '../src/lib/sandbox/judge';
import { FakeExecutor } from '../src/lib/sandbox/fake';
import { createExecutor } from '../src/lib/sandbox/index';
import type { CaseOutcome, SandboxCase, SandboxResponse } from '../src/lib/sandbox/types';

/** Identity with the SandboxCase type attached — fixture literals get checked. */
function caseOf(c: SandboxCase): SandboxCase {
  return c;
}

// ─── normalizeStdout ──────────────────────────────────────────────────────────

describe('normalizeStdout', () => {
  it.each([
    ['hello\n', 'hello\n'], // already canonical
    ['hello', 'hello\n'], // missing trailing newline
    ['hello   \n', 'hello\n'], // trailing spaces
    ['hello\t\n', 'hello\n'], // trailing tab
    ['a\r\nb\r\n', 'a\nb\n'], // CRLF (candidate on Windows)
    ['hello\n\n\n', 'hello\n'], // extra trailing newlines collapse to one
    ['', ''], // no output at all
    ['\n', ''], // a lone blank line is no output
    ['a\n\nb\n', 'a\n\nb\n'], // interior blank line is MEANINGFUL and kept
    ['  leading kept\n', '  leading kept\n'], // leading whitespace is significant
  ])('%j ⇒ %j', (input, expected) => {
    expect(normalizeStdout(input)).toBe(expected);
  });

  it('equates the classic cross-OS pair (LF vs CRLF + padding)', () => {
    expect(normalizeStdout('0\n')).toBe(normalizeStdout('0  \r\n'));
  });
});

// ─── compareCase ──────────────────────────────────────────────────────────────

describe('compareCase — passes', () => {
  it('exact stdout + exact exit match passes', () => {
    const outcome = compareCase(
      caseOf({ name: 'c1', expectedStdout: '0\n', expectedExit: 0 }),
      { stdout: '0\n', exitCode: 0, timedOut: false },
    );
    expect(outcome).toMatchObject({
      name: 'c1',
      passed: true,
      expectedStdoutExcerpt: '0\n',
      actualStdoutExcerpt: '0\n',
      expectedExit: 0,
      actualExit: 0,
      timedOut: false,
    });
  });

  it('whitespace/CRLF differences pass after normalization', () => {
    const outcome = compareCase(
      caseOf({ name: 'c1', expectedStdout: 'hello\nworld\n' }),
      { stdout: 'hello  \r\nworld\r\n', exitCode: 0, timedOut: false },
    );
    expect(outcome.passed).toBe(true);
  });

  it('exit-only case passes on exact exit code (nonzero included)', () => {
    const outcome = compareCase(caseOf({ name: 'c1', expectedExit: 3 }), { stdout: '', exitCode: 3, timedOut: false });
    expect(outcome.passed).toBe(true);
    expect(outcome.expectedStdoutExcerpt).toBeUndefined();
    expect(outcome.actualExit).toBe(3);
  });

  it('stdout-expectation case implicitly requires a clean exit 0', () => {
    const c = caseOf({ name: 'c1', expectedStdout: 'ok\n' });
    expect(compareCase(c, { stdout: 'ok\n', exitCode: 0, timedOut: false }).passed).toBe(true);
    // Right output, crashing program: still a fail.
    expect(compareCase(c, { stdout: 'ok\n', exitCode: 1, timedOut: false }).passed).toBe(false);
  });

  it('tolerates the schema-impossible expectation-less case as exit-0 check', () => {
    const c = caseOf({ name: 'degenerate' });
    expect(compareCase(c, { stdout: 'anything', exitCode: 0, timedOut: false }).passed).toBe(true);
    expect(compareCase(c, { stdout: 'anything', exitCode: 2, timedOut: false }).passed).toBe(false);
  });
});

describe('compareCase — fails', () => {
  it('exit mismatch fails and records both codes', () => {
    const outcome = compareCase(
      caseOf({ name: 'c1', expectedStdout: '0\n', expectedExit: 0 }),
      { stdout: '0\n', exitCode: 2, timedOut: false },
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.expectedExit).toBe(0);
    expect(outcome.actualExit).toBe(2);
  });

  it('stdout mismatch fails even with the right exit code', () => {
    const outcome = compareCase(
      caseOf({ name: 'c1', expectedStdout: '1\n' }),
      { stdout: '2\n', exitCode: 0, timedOut: false },
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.expectedStdoutExcerpt).toBe('1\n');
    expect(outcome.actualStdoutExcerpt).toBe('2\n');
  });

  it('timeout ALWAYS fails, even with matching output and exit code', () => {
    const outcome = compareCase(
      caseOf({ name: 'c1', expectedStdout: '0\n', expectedExit: 0 }),
      { stdout: '0\n', exitCode: 0, timedOut: true },
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.timedOut).toBe(true);
  });

  it('null exit code (container killed, no status) never passes', () => {
    const outcome = compareCase(caseOf({ name: 'c1', expectedExit: 0 }), { stdout: '', exitCode: null, timedOut: false });
    expect(outcome.passed).toBe(false);
    expect(outcome.actualExit).toBeUndefined();
  });
});

describe('compareCase — excerpt capping', () => {
  it('caps expected/actual excerpts at EXCERPT_CAP chars (200)', () => {
    expect(EXCERPT_CAP).toBe(200);
    const long = 'a'.repeat(500);
    const other = 'b'.repeat(500);
    const outcome = compareCase(caseOf({ name: 'c1', expectedStdout: long }), { stdout: other, exitCode: 0, timedOut: false });
    expect(outcome.passed).toBe(false);
    expect(outcome.expectedStdoutExcerpt!.length).toBeLessThanOrEqual(EXCERPT_CAP);
    expect(outcome.actualStdoutExcerpt!.length).toBeLessThanOrEqual(EXCERPT_CAP);
    expect(outcome.expectedStdoutExcerpt!.endsWith('…')).toBe(true);
  });

  it('excerpt() passes short strings through untouched', () => {
    expect(excerpt('short')).toBe('short');
    expect(excerpt(undefined)).toBeUndefined();
    expect(excerpt('x'.repeat(EXCERPT_CAP))!.length).toBe(EXCERPT_CAP); // exactly at cap: untruncated
  });
});

// ─── summarize ────────────────────────────────────────────────────────────────

describe('summarize', () => {
  const pass = (name: string): CaseOutcome => ({ name, passed: true, timedOut: false });
  const fail = (name: string): CaseOutcome => ({ name, passed: false, timedOut: false });

  it('all passed ⇒ allPassed true', () => {
    expect(summarize([pass('a'), pass('b')]).allPassed).toBe(true);
  });

  it('any failure ⇒ allPassed false', () => {
    expect(summarize([pass('a'), fail('b'), pass('c')]).allPassed).toBe(false);
  });

  it('no outcomes ⇒ vacuously true (schema guarantees >= 2 cases anyway)', () => {
    expect(summarize([]).allPassed).toBe(true);
  });
});

// ─── v1 stdin limitation ──────────────────────────────────────────────────────

describe('stdinUnsupportedOutcome — v1 limitation fails closed with a note', () => {
  it('marks the case failed and explains why', () => {
    const outcome = stdinUnsupportedOutcome(caseOf({ name: 'stdin-case', stdin: 'ERROR\n', expectedStdout: '1\n' }));
    expect(outcome.passed).toBe(false);
    expect(outcome.note).toMatch(/stdin/i);
    expect(outcome.actualExit).toBeUndefined();
    expect(outcome.expectedStdoutExcerpt).toBe('1\n');
  });
});

// ─── FakeExecutor (the deterministic seam Phase 8 tests rely on) ──────────────

describe('FakeExecutor', () => {
  const req = {
    language: 'BASH' as const,
    code: 'echo 0',
    cases: [
      caseOf({ name: 'c1', expectedStdout: '0\n', expectedExit: 0 }),
      caseOf({ name: 'c2', args: ['--flag'], expectedExit: 0 }),
    ],
  };

  it('default script: canned echo — every case passes', async () => {
    const res = await new FakeExecutor().execute(req);
    expect(res.allPassed).toBe(true);
    expect(res.outcomes.map((o) => o.name)).toEqual(['c1', 'c2']);
    expect(res.outcomes.every((o) => o.passed)).toBe(true);
    expect(res.stdout).toBe('0\n'); // concatenated expectations
    expect(res.stderr).toBe('');
    expect(res.exitCode).toBe(0); // last case's expectedExit ?? 0
    expect(res.truncated).toBe(false);
    expect(res.durationMs).toBe(0);
  });

  it('custom script: the caller fully controls the response', async () => {
    const scripted: SandboxResponse = {
      outcomes: [{ name: 'c1', passed: false, timedOut: true }],
      allPassed: false,
      stdout: '',
      stderr: 'killed',
      exitCode: null,
      durationMs: 10_001,
      truncated: false,
    };
    const res = await new FakeExecutor(() => scripted).execute(req);
    expect(res).toEqual(scripted);
  });

  it('empty case list: vacuous pass, null exit code', async () => {
    const res = await new FakeExecutor().execute({ language: 'BASH', code: '', cases: [] });
    expect(res.allPassed).toBe(true);
    expect(res.exitCode).toBeNull();
  });
});

describe('createExecutor', () => {
  it("'fake' returns a FakeExecutor (optionally scripted)", async () => {
    const fake = createExecutor('fake', () => ({
      outcomes: [],
      allPassed: true,
      stdout: '',
      stderr: '',
      exitCode: null,
      durationMs: 0,
      truncated: false,
    }));
    expect(fake).toBeInstanceOf(FakeExecutor);
    expect((await fake.execute({ language: 'BASH', code: '', cases: [] })).allPassed).toBe(true);
  });

  it("'docker' constructs WITHOUT contacting docker (pure boot-time probe only)", () => {
    // The Docker daemon does not exist on this machine — construction must
    // still succeed: it only probe-builds argv and asserts hardening.
    expect(() => createExecutor('docker')).not.toThrow();
  });
});
