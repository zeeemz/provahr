// Never-regress tests for the sandbox argv builder (PLAN.md Phase 7, §10
// "Sandbox hardening (v1 Docker)"; docs/TESTING.md T4 + §6 #7 containment).
// PURE: everything here exercises buildRunArgs/assertHardenedArgs only — no
// docker daemon exists on dev machines (live execution is Phase 10). These
// tests ARE the containment contract: if one fails, untrusted code would run
// with weaker isolation than PLAN §10 promises.

import { describe, it, expect } from 'vitest';
import { CODE_LANGUAGES, type CodeLanguage } from '../src/lib/assessment/item';
import { AppError } from '../src/lib/http';
import {
  IMAGE_ALLOW_LIST,
  assertHardenedArgs,
  buildRunArgs,
  stdinPayload,
  stopTimeoutSeconds,
} from '../src/lib/sandbox/builder';
import { PER_CASE_TIMEOUT_MS, type SandboxRequest } from '../src/lib/sandbox/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Value immediately following `flag` in an argv (two-token flag style). */
function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

function expectAppError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    return;
  }
  throw new Error(`expected AppError(${code}) — nothing threw`);
}

/** The exact expected argv per language, default 10s timeout (the snapshot). */
function expectedSnapshot(language: CodeLanguage): string[] {
  const command: Record<CodeLanguage, string[]> = {
    BASH: ['bash', '-s', '--'],
    NODE: ['node', '-'],
    PYTHON: ['python', '-'],
  };
  return [
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,size=16m,exec',
    '--pids-limit',
    '64',
    '--memory',
    '256m',
    '--memory-swap',
    '256m',
    '--cpus',
    '0.5',
    '--user',
    '65534:65534',
    '--stop-timeout',
    '10',
    '-i',
    IMAGE_ALLOW_LIST[language],
    ...command[language],
  ];
}

// ─── Hardening invariants (all three languages) ──────────────────────────────

describe('buildRunArgs — hardening invariants (never-regress #7)', () => {
  for (const language of CODE_LANGUAGES) {
    describe(`language ${language}`, () => {
      const args = buildRunArgs({ language });

      it('disables the network entirely', () => {
        expect(flagValue(args, '--network')).toBe('none');
      });

      it('destroys the container after the run, read-only rootfs, tmpfs /tmp only', () => {
        expect(args).toContain('--rm');
        expect(args).toContain('--read-only');
        expect(flagValue(args, '--tmpfs')).toBe('/tmp:rw,size=16m,exec');
      });

      it('runs as non-root uid 65534 with process/CPU/memory limits', () => {
        expect(flagValue(args, '--user')).toBe('65534:65534');
        expect(flagValue(args, '--pids-limit')).toBe('64');
        expect(flagValue(args, '--memory')).toBe('256m');
        expect(flagValue(args, '--memory-swap')).toBe('256m'); // = memory ⇒ no swap
        expect(flagValue(args, '--cpus')).toBe('0.5');
      });

      it('keeps stdin open (the program travels via stdin, never a mount)', () => {
        expect(args).toContain('-i');
      });

      it('uses exactly the allow-listed image for the language', () => {
        expect(args).toContain(IMAGE_ALLOW_LIST[language]);
        const images = Object.values(IMAGE_ALLOW_LIST).filter((img) => args.includes(img));
        expect(images).toEqual([IMAGE_ALLOW_LIST[language]]);
      });

      it('never contains --privileged', () => {
        expect(args).not.toContain('--privileged');
      });

      it('never contains any volume/mount flag', () => {
        expect(args.some((a) => a.startsWith('-v'))).toBe(false);
        expect(args.some((a) => a.startsWith('--volume'))).toBe(false);
        expect(args.some((a) => a.startsWith('--mount'))).toBe(false);
      });

      it('contains no host path (the only /-rooted token is the tmpfs spec)', () => {
        const rooted = args.filter((a) => a.startsWith('/'));
        expect(rooted).toEqual(['/tmp:rw,size=16m,exec']);
        // No Windows drive path either.
        expect(args.some((a) => /^[A-Za-z]:[\\/]/.test(a))).toBe(false);
      });

      it('has a deterministic, stable ordering (exact snapshot)', () => {
        expect(args).toEqual(expectedSnapshot(language));
        expect(buildRunArgs({ language })).toEqual(args); // purity: same input ⇒ same argv
      });

      it('passes assertHardenedArgs (round-trip: builder output is spawnable)', () => {
        expect(() => assertHardenedArgs(args)).not.toThrow();
      });
    });
  }
});

// ─── Per-case argv: program args, interpreter command ─────────────────────────

describe('buildRunArgs — per-case command', () => {
  it('appends hidden-case args after the interpreter (BASH: bash -s -- …)', () => {
    const args = buildRunArgs(
      { language: 'BASH', case: { name: 'c1', args: ['3', '7'], expectedExit: 0 } },
      { timeoutMs: PER_CASE_TIMEOUT_MS },
    );
    expect(args).toEqual([...expectedSnapshot('BASH'), '3', '7']);
  });

  it('NODE reads the program from stdin via `node -`', () => {
    const args = buildRunArgs({ language: 'NODE', case: { name: 'c1', expectedExit: 0 } });
    expect(args.slice(-2)).toEqual(['node', '-']);
  });

  it('PYTHON reads the program from stdin via `python -`', () => {
    const args = buildRunArgs({ language: 'PYTHON', case: { name: 'c1', args: ['x'], expectedExit: 0 } });
    expect(args.slice(-3)).toEqual(['python', '-', 'x']);
  });

  it('case args are inert argv entries — no shell string is ever built', () => {
    const dangerous = ['$(rm -rf /)', '; cat /etc/passwd', '`id`'];
    const args = buildRunArgs(
      { language: 'BASH', case: { name: 'c1', args: dangerous, expectedExit: 0 } },
    );
    // Each threat lands as ONE argv token, exactly as written — spawn passes
    // them to bash as $1..$3, never through a shell.
    expect(args.slice(-3)).toEqual(dangerous);
  });

  it('stdin cases are rejected in v1 (program owns the stdin pipe)', () => {
    expectAppError(
      () => buildRunArgs({ language: 'BASH', case: { name: 'c1', stdin: 'ERROR\n', expectedExit: 0 } }),
      'SANDBOX_V1_NO_STDIN',
    );
  });

  it('rejects a language with no allow-listed image', () => {
    expectAppError(
      () => buildRunArgs({ language: 'RUST' as CodeLanguage }),
      'SANDBOX_LANGUAGE_UNSUPPORTED',
    );
  });

  it('stdinPayload returns the program text (identical per case in v1)', () => {
    const req: SandboxRequest = {
      language: 'NODE',
      code: 'console.log("hi")',
      cases: [
        { name: 'a', expectedExit: 0 },
        { name: 'b', args: ['1'], expectedExit: 0 },
      ],
    };
    for (const c of req.cases) expect(stdinPayload(req, c)).toBe(req.code);
  });
});

// ─── Timeout → --stop-timeout mapping ─────────────────────────────────────────

describe('buildRunArgs — wall-clock budget', () => {
  it('default per-case timeout maps to 10 seconds', () => {
    expect(flagValue(buildRunArgs({ language: 'BASH' }), '--stop-timeout')).toBe('10');
    expect(PER_CASE_TIMEOUT_MS).toBe(10_000);
  });

  it('maps milliseconds to ceiling seconds, minimum 1', () => {
    expect(stopTimeoutSeconds(10_000)).toBe(10);
    expect(stopTimeoutSeconds(10_500)).toBe(11);
    expect(stopTimeoutSeconds(999)).toBe(1);
    expect(stopTimeoutSeconds(1)).toBe(1);
    expect(flagValue(buildRunArgs({ language: 'BASH' }, { timeoutMs: 2_500 }), '--stop-timeout')).toBe('3');
  });
});

// ─── assertHardenedArgs: the runtime backstop ─────────────────────────────────

describe('assertHardenedArgs — refuses tampered argv', () => {
  const good = buildRunArgs({ language: 'BASH' });

  it('accepts the builder output for every language (and with case args)', () => {
    for (const language of CODE_LANGUAGES) {
      expect(() => assertHardenedArgs(buildRunArgs({ language }))).not.toThrow();
      expect(() =>
        assertHardenedArgs(buildRunArgs({ language, case: { name: 'c', args: ['-v', 'x'], expectedExit: 0 } })),
      ).not.toThrow(); // -v AFTER the image is a program argument, not a docker flag
    }
  });

  it('throws when --network none is missing', () => {
    const tampered = good.map((a) => (a === 'none' ? 'bridge' : a));
    expectAppError(() => assertHardenedArgs(tampered), 'SANDBOX_ARGS_UNHARDENED');
  });

  it('throws when --privileged sneaks in', () => {
    expectAppError(() => assertHardenedArgs(['--privileged', ...good]), 'SANDBOX_ARGS_UNHARDENED');
  });

  it('throws on a host volume mount', () => {
    const tampered = [...good.slice(0, 2), '-v', '/host/secrets:/secrets', ...good.slice(2)];
    expectAppError(() => assertHardenedArgs(tampered), 'SANDBOX_ARGS_UNHARDENED');
  });

  it('throws on --volume and --mount forms too', () => {
    const tampered = [...good.slice(0, 2), '--volume', '/h:/c', ...good.slice(2)];
    expectAppError(() => assertHardenedArgs(tampered), 'SANDBOX_ARGS_UNHARDENED');
    const mounted = [...good.slice(0, 2), '--mount', 'type=bind,src=/h,dst=/c', ...good.slice(2)];
    expectAppError(() => assertHardenedArgs(mounted), 'SANDBOX_ARGS_UNHARDENED');
  });

  it('throws on an image outside the allow-list', () => {
    const tampered = good.map((a) => (a === IMAGE_ALLOW_LIST.BASH ? 'ubuntu:latest' : a));
    expectAppError(() => assertHardenedArgs(tampered), 'SANDBOX_ARGS_UNHARDENED');
  });

  it('throws when the root user is restored', () => {
    const tampered = good.map((a) => (a === '65534:65534' ? '0:0' : a));
    expectAppError(() => assertHardenedArgs(tampered), 'SANDBOX_ARGS_UNHARDENED');
  });

  it('throws when --read-only or --rm is dropped', () => {
    expectAppError(() => assertHardenedArgs(good.filter((a) => a !== '--read-only')), 'SANDBOX_ARGS_UNHARDENED');
    expectAppError(() => assertHardenedArgs(good.filter((a) => a !== '--rm')), 'SANDBOX_ARGS_UNHARDENED');
  });

  it('throws on a completely empty argv', () => {
    expectAppError(() => assertHardenedArgs([]), 'SANDBOX_ARGS_UNHARDENED');
  });
});

// ─── QA wave-7 adversarial regressions (F1–F4): docker last-occurrence-wins ──

describe('assertHardenedArgs — exact-prefix, default-deny (QA wave-7)', () => {
  const base = buildRunArgs({ language: 'BASH' });
  const imageAt = base.indexOf('bash:5.2');

  function expectRejected(args: string[]): void {
    expect(() => assertHardenedArgs(args)).toThrowError(/SANDBOX_ARGS_UNHARDENED|unhardened/i);
  }

  it('rejects a duplicate flag overriding the hardened value (docker: last wins)', () => {
    expectRejected([...base.slice(0, imageAt), '--network', 'host', ...base.slice(imageAt)]);
    expectRejected([...base.slice(0, imageAt), '--user', '0:0', ...base.slice(imageAt)]);
  });

  it('rejects =false boolean forms (--rm=false, --read-only=false)', () => {
    expectRejected(base.map((a) => (a === '--rm' ? '--rm=false' : a)));
    expectRejected(base.map((a) => (a === '--read-only' ? '--read-only=false' : a)));
  });

  it('rejects a foreign image inserted BEFORE the allow-listed one (docker runs the first positional)', () => {
    expectRejected([...base.slice(0, imageAt), 'evil:latest', ...base.slice(imageAt)]);
  });

  it('rejects any extra flag in the region (default-deny, not a deny-list of 3)', () => {
    for (const extra of ['--pid', '--ipc', '--cap-add', '--device', '--gpus', '--userns', '--cgroupns']) {
      expectRejected([...base.slice(0, imageAt), extra, 'host', ...base.slice(imageAt)]);
    }
    expectRejected([...base.slice(0, imageAt), '--security-opt', 'apparmor=unconfined', ...base.slice(imageAt)]);
  });

  it('rejects mount forms in the flag region (all shapes)', () => {
    expectRejected([...base.slice(0, imageAt), '-v', '/host:/cont', ...base.slice(imageAt)]);
    expectRejected([...base.slice(0, imageAt), '--mount', 'type=bind,src=/,dst=/x', ...base.slice(imageAt)]);
    expectRejected([...base.slice(0, imageAt), '-vtail', ...base.slice(imageAt)]);
  });

  it('ACCEPTS candidate program args after the image, even literally --privileged (inert data, F4)', () => {
    const args = [...base, '--privileged']; // appended AFTER image+interpreter = program argv
    expect(() => assertHardenedArgs(args)).not.toThrow();
    expect(() => assertHardenedArgs([...base, '-v', 'x'])).not.toThrow();
  });

  it('accepts the canonical argv for every language, bare prefix included', () => {
    for (const lang of ['BASH', 'NODE', 'PYTHON'] as const) {
      expect(() => assertHardenedArgs(buildRunArgs({ language: lang }))).not.toThrow();
    }
  });

  it('language __proto__ is rejected at the builder (prototype-chain guard)', () => {
    expect(() => buildRunArgs({ language: '__proto__' as never })).toThrowError(/Unsupported sandbox language/);
  });
});

// ─── V2-4 company template images (PLAN.md §12 D21) — the law holds ──────────
//
// A template image changes WHICH container runs, never HOW: the flag region is
// byte-identical to the default argv, and assertHardenedArgs — parameterized
// over the resolved image — still accepts EXACTLY the canonical prefix for
// that image. The wave-7 adversarial battery below re-runs the top cases
// against a template-resolved argv to prove nothing weakened.

describe('buildRunArgs — template image override (V2-4, D21)', () => {
  const TEMPLATE_IMAGE = 'registry.acme.test/node:20-ci';

  it('swaps ONLY the image token; every hardening flag is byte-identical', () => {
    for (const language of CODE_LANGUAGES) {
      const def = buildRunArgs({ language });
      const tpl = buildRunArgs({ language }, { image: TEMPLATE_IMAGE });
      expect(tpl).toEqual(def.map((a) => (a === IMAGE_ALLOW_LIST[language] ? TEMPLATE_IMAGE : a)));
      // The interpreter command and positions are untouched.
      expect(tpl.indexOf(TEMPLATE_IMAGE)).toBe(def.indexOf(IMAGE_ALLOW_LIST[language]));
    }
  });

  it('keeps case args after the interpreter (per-case argv unchanged)', () => {
    const tpl = buildRunArgs(
      { language: 'BASH', case: { name: 'c1', args: ['3', '7'], expectedExit: 0 } },
      { image: 'acme/bash-ci:5.2' },
    );
    expect(tpl.slice(-2)).toEqual(['3', '7']);
    expect(tpl).toContain('acme/bash-ci:5.2');
  });

  it('throws SANDBOX_TEMPLATE_UNSAFE for unsafe overrides (fail closed at build time)', () => {
    for (const unsafe of [
      '--privileged', // flag-like
      '-v', // flag-like
      'Node:20', // uppercase
      'evil.com/a:b$c', // metachar
      'a b', // whitespace
      'app@sha256:deadbeef', // digest (unsupported)
      '', // empty
      'a'.repeat(101), // over-length
    ]) {
      expectAppError(() => buildRunArgs({ language: 'NODE' }, { image: unsafe }), 'SANDBOX_TEMPLATE_UNSAFE');
    }
  });

  it('an empty-string override is refused, not silently defaulted', () => {
    expectAppError(() => buildRunArgs({ language: 'NODE' }, { image: '' }), 'SANDBOX_TEMPLATE_UNSAFE');
  });

  it('no opts.image keeps the platform default (pre-V2-4 behavior unchanged)', () => {
    expect(buildRunArgs({ language: 'NODE' })).toEqual(buildRunArgs({ language: 'NODE' }, { timeoutMs: 10_000 }));
    expect(buildRunArgs({ language: 'NODE' })).toContain(IMAGE_ALLOW_LIST.NODE);
  });
});

describe('assertHardenedArgs — parameterized over the resolved image (V2-4)', () => {
  const TEMPLATE_IMAGE = 'registry.acme.test/node:20-ci';
  const base = buildRunArgs({ language: 'BASH' }, { image: 'acme/bash-ci:5.2' });
  const imageAt = base.indexOf('acme/bash-ci:5.2');

  function expectRejected(args: string[], opts?: { image?: string; timeoutMs?: number }): void {
    expect(() => assertHardenedArgs(args, opts)).toThrowError(/SANDBOX_ARGS_UNHARDENED|unhardened/i);
  }

  it('accepts the builder output built with the SAME image (round-trip, every language)', () => {
    for (const language of CODE_LANGUAGES) {
      const opts = { image: TEMPLATE_IMAGE };
      expect(() => assertHardenedArgs(buildRunArgs({ language }, opts), opts)).not.toThrow();
      const withCase = buildRunArgs(
        { language, case: { name: 'c', args: ['-v', 'x'], expectedExit: 0 } },
        opts,
      );
      expect(() => assertHardenedArgs(withCase, opts)).not.toThrow();
    }
  });

  it('pins --stop-timeout too: same image, different timeoutMs is refused', () => {
    const built = buildRunArgs({ language: 'BASH' }, { image: 'acme/bash-ci:5.2', timeoutMs: 2_500 });
    expect(() => assertHardenedArgs(built, { image: 'acme/bash-ci:5.2', timeoutMs: 2_500 })).not.toThrow();
    expectRejected(built, { image: 'acme/bash-ci:5.2', timeoutMs: 10_000 });
  });

  it('refuses the DEFAULT-image argv while parameterized to the template image (exactness)', () => {
    // The checker verifies what the resolver decided — a swap back to the
    // platform default behind its back is a prefix mismatch, not a pass.
    expectRejected(buildRunArgs({ language: 'BASH' }), { image: 'acme/bash-ci:5.2' });
    // And vice versa: the template argv does not pass the DEFAULT check.
    expectRejected(buildRunArgs({ language: 'BASH' }, { image: 'acme/bash-ci:5.2' }));
  });

  it('refuses an argv built with a DIFFERENT image than the one asserted', () => {
    expectRejected(buildRunArgs({ language: 'BASH' }, { image: 'acme/bash-ci:5.2' }), { image: 'other:latest' });
  });

  // ── QA wave-7 top cases, re-run against the template-resolved argv ──────────

  it('rejects a duplicate flag overriding the hardened value (last-occurrence-wins)', () => {
    const opts = { image: 'acme/bash-ci:5.2' };
    expectRejected([...base.slice(0, imageAt), '--network', 'host', ...base.slice(imageAt)], opts);
    expectRejected([...base.slice(0, imageAt), '--user', '0:0', ...base.slice(imageAt)], opts);
  });

  it('rejects =false boolean forms', () => {
    const opts = { image: 'acme/bash-ci:5.2' };
    expectRejected(base.map((a) => (a === '--rm' ? '--rm=false' : a)), opts);
    expectRejected(base.map((a) => (a === '--read-only' ? '--read-only=false' : a)), opts);
  });

  it('rejects a foreign image inserted BEFORE the template image', () => {
    expectRejected([...base.slice(0, imageAt), 'evil:latest', ...base.slice(imageAt)], { image: 'acme/bash-ci:5.2' });
  });

  it('rejects any extra flag in the region (default-deny holds per image)', () => {
    const opts = { image: 'acme/bash-ci:5.2' };
    for (const extra of ['--pid', '--ipc', '--cap-add', '--device', '--gpus', '--userns', '--privileged']) {
      expectRejected([...base.slice(0, imageAt), extra, 'host', ...base.slice(imageAt)], opts);
    }
    expectRejected([...base.slice(0, imageAt), '--security-opt', 'apparmor=unconfined', ...base.slice(imageAt)], opts);
  });

  it('rejects mount forms in the flag region (all shapes)', () => {
    const opts = { image: 'acme/bash-ci:5.2' };
    expectRejected([...base.slice(0, imageAt), '-v', '/host:/cont', ...base.slice(imageAt)], opts);
    expectRejected([...base.slice(0, imageAt), '--mount', 'type=bind,src=/,dst=/x', ...base.slice(imageAt)], opts);
    expectRejected([...base.slice(0, imageAt), '-vtail', ...base.slice(imageAt)], opts);
  });

  it('ACCEPTS candidate program args after the template image, even literally --privileged (inert data)', () => {
    const opts = { image: 'acme/bash-ci:5.2' };
    expect(() => assertHardenedArgs([...base, '--privileged'], opts)).not.toThrow();
    expect(() => assertHardenedArgs([...base, '-v', 'x'], opts)).not.toThrow();
  });

  it('never mints a prefix for an UNSAFE image (assert delegates to the builder guard)', () => {
    expectAppError(() => assertHardenedArgs(base, { image: '--privileged' }), 'SANDBOX_TEMPLATE_UNSAFE');
    expectAppError(() => assertHardenedArgs(base, { image: 'Node:20' }), 'SANDBOX_TEMPLATE_UNSAFE');
  });

  it('an unsafe opts.image never validates the very image it would pin (empty argv edge)', () => {
    expectAppError(() => assertHardenedArgs([], { image: 'a b' }), 'SANDBOX_ARGS_UNHARDENED');
  });
});
