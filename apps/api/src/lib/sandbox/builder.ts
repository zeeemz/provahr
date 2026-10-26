// PURE argv construction for the sandbox (PLAN.md Phase 7, §10 "Sandbox
// hardening (v1 Docker)"; docs/TESTING.md T4 + §6 never-regress #7 containment).
//
// ZERO SIDE EFFECTS: no spawn, no fs, no clock. Every byte of the `docker run`
// command line originates here, so the hardening invariants can be — and are —
// exhaustively unit-tested (tests/sandbox-builder.test.ts) and re-asserted at
// runtime by DockerExecutor (assertHardenedArgs on every spawn: defense in
// depth, not just tests).
//
// Hardening model (PLAN §10): no network, non-root uid, read-only rootfs with
// a small exec tmpfs, pids/memory/CPU limits, --rm immediate destruction, no
// host mounts EVER (the candidate's program travels via STDIN, never a
// volume), and a per-language image that resolves COMPANY TEMPLATE → platform
// default (V2-4, D21 — templates.ts). Everything is one argv array
// passed to child_process.spawn — a shell string is never built, so no quoting
// or injection surface exists.

import type { CodeLanguage } from '../assessment/item';
import { AppError } from '../http';
import { PER_CASE_TIMEOUT_MS, type SandboxCase, type SandboxRequest } from './types';
import { IMAGE_ALLOW_LIST, isSafeImageRef } from './templates';

// Re-exported for the historical import site (index.ts, tests): the default
// table lives in templates.ts since V2-4 — resolution layer owns the data.
export { IMAGE_ALLOW_LIST };

/**
 * Interpreter command prefix per language: reads the PROGRAM from stdin
 * (`-` / `-s --` convention) so the code never touches the container
 * filesystem or a host mount. Per-case args are appended AFTER these tokens —
 * argv entries only, never interpolated into a shell string.
 *
 * MULTI-FILE MODE (IDE wave 2): when the program is a FILE SET, the stdin
 * payload becomes a POSIX-sh bootstrap (see buildBootstrap) and the prefix is
 * always `sh -s --` — the entry file's interpreter is exec'd BY the bootstrap,
 * not by the container command. `sh` (busybox) ships in every allow-listed
 * image; the flag region above the image is byte-identical either way, so the
 * exact-prefix hardening law is untouched (tokens after the image are inert
 * data by that law's own construction).
 */
const COMMAND_PREFIX: Record<CodeLanguage, readonly string[]> = {
  BASH: ['bash', '-s', '--'],
  NODE: ['node', '-'],
  PYTHON: ['python', '-'],
};

const MULTI_FILE_PREFIX: readonly string[] = ['sh', '-s', '--'];

/** Entry-file interpreter per language (multi-file bootstrap's exec line). */
const ENTRY_INTERPRETER: Record<CodeLanguage, string> = {
  BASH: 'bash',
  NODE: 'node',
  PYTHON: 'python',
};

/** tmpfs scratch space: the ONLY writable, executable path (rootfs is RO). */
const TMPFS_SPEC = '/tmp:rw,size=16m,exec';

/** Non-root uid:gid (65534 = 'nobody' on alpine images). */
const SANDBOX_USER = '65534:65534';

/** timeoutMs → whole seconds for docker's --stop-timeout, minimum 1s. */
export function stopTimeoutSeconds(timeoutMs: number): number {
  // Executor-config only, but never emit NaN/Infinity into argv (QA wave-7 F5).
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return 1;
  return Math.max(1, Math.ceil(timeoutMs / 1000));
}

/**
 * Builds the argv that follows `docker run` (docker.ts spawns
 * `spawn('docker', ['run', ...args])`). Stable order, one array, no string
 * concatenation anywhere. `req.case` (optional) appends the hidden case's
 * program args after the interpreter prefix; a case with `stdin` is REJECTED —
 * v1 cannot carry both a program and case-input on the same stdin pipe
 * (documented v1 limitation, types.ts header).
 *
 * V2-4 (PLAN §12 D21): `opts.image` carries the ALREADY-RESOLVED company
 * template image (resolveImage, templates.ts). The flag region is IDENTICAL
 * for default and template images — an override changes WHICH container runs,
 * never HOW it runs. An unsafe `opts.image` (isSafeImageRef) throws
 * AppError(500, 'SANDBOX_TEMPLATE_UNSAFE'): a stored ref that somehow slipped
 * past the SAVE-time zod check is refused here, at build time, fail-closed.
 *
 * Throws AppError(400, 'SANDBOX_V1_NO_STDIN') for stdin cases,
 * AppError(400, 'SANDBOX_LANGUAGE_UNSUPPORTED') for a language with no image,
 * and AppError(500, 'SANDBOX_TEMPLATE_UNSAFE') for an unsafe image override.
 */
export function buildRunArgs(
  req: { language: CodeLanguage; case?: SandboxCase; multiFile?: boolean },
  opts?: { timeoutMs?: number; image?: string },
): string[] {
  // hasOwnProperty guard: '__proto__' would otherwise resolve truthy through
  // the prototype chain (QA wave-7 F5).
  if (!Object.prototype.hasOwnProperty.call(IMAGE_ALLOW_LIST, req.language)) {
    throw new AppError(
      400,
      `Unsupported sandbox language: ${String(req.language)}`,
      'SANDBOX_LANGUAGE_UNSUPPORTED',
    );
  }
  if (req.case?.stdin !== undefined) {
    throw new AppError(
      400,
      'stdin cases unsupported in sandbox v1 (program travels via stdin)',
      'SANDBOX_V1_NO_STDIN',
    );
  }
  // opts.image is the resolved template image (or absent = platform default).
  // An EXPLICIT override is validated loudly — silently falling back to the
  // default would hide a bad row from the operator (see docblock above).
  const image = opts?.image !== undefined ? requireSafeTemplateImage(opts.image) : IMAGE_ALLOW_LIST[req.language];
  const timeoutMs = opts?.timeoutMs ?? PER_CASE_TIMEOUT_MS;
  const prefix = req.multiFile === true ? MULTI_FILE_PREFIX : COMMAND_PREFIX[req.language];
  return [
    '--rm', // container destroyed immediately after the run (PLAN §10)
    '--network',
    'none', // no network egress, ever (never-regress #7)
    '--read-only', // immutable rootfs
    '--tmpfs',
    TMPFS_SPEC, // writable scratch: /tmp only, 16m, exec allowed
    '--pids-limit',
    '64', // fork bombs die at 64 processes
    '--memory',
    '256m',
    '--memory-swap',
    '256m', // = memory ⇒ swap disabled
    '--cpus',
    '0.5',
    '--user',
    SANDBOX_USER, // non-root
    '--stop-timeout',
    String(stopTimeoutSeconds(timeoutMs)), // docker-side kill backstop
    '-i', // stdin carries the candidate's program
    image,
    ...prefix,
    ...(req.case?.args ?? []),
  ];
}

/** First line of every multi-file bootstrap — lets the executor detect a
 *  pre-built bootstrap in `code` (the run path passes strings only). */
export const BOOTSTRAP_MARKER = '#__provahr_multifile__';

/**
 * The stdin payload piped into the running container for `testCase`: the
 * candidate's PROGRAM text (v1 runs the identical program for every case;
 * cases differ only via argv). Case-stdin input is not supported in v1 —
 * see buildRunArgs.
 *
 * MULTI-FILE MODE: either `req.files` is set (the evaluation path — the
 * bootstrap is built here) or `req.code` already IS a bootstrap (the IDE-run
 * path passes strings only — detected via BOOTSTRAP_MARKER and passed
 * through verbatim).
 */
export function stdinPayload(req: SandboxRequest, _testCase: SandboxCase): string {
  if (req.files !== undefined && req.files.length > 0) {
    return buildBootstrap(req.language, req.files, req.entry ?? req.files[0]!.path);
  }
  return req.code;
}

// ─── Multi-file bootstrap (IDE wave 2) ───────────────────────────────────────

import { Buffer } from 'node:buffer';
import {
  isValidFilePath,
  MAX_CODE_FILES,
  MAX_FILE_CHARS,
  MAX_TOTAL_CHARS,
  type CodeFile,
} from '../assessment/codeAnswer';

/**
 * Builds the POSIX-sh bootstrap piped to `sh -s --` for a multi-file program:
 *
 *   set -eu
 *   mkdir -p /tmp/w && cd /tmp/w
 *   printf '%s' '<base64>' | base64 -d > '<path>'   (per file)
 *   exec <interpreter> '<entry>' "$@"
 *
 * QUOTING MODEL: file contents travel base64 (alphabet [A-Za-z0-9+/=]) and
 * paths are re-validated against the traversal-free grammar here — both are
 * inert inside single quotes, so nothing candidate-authored is ever
 * interpreted by this shell. Paths and the entry are REQUIRED to match the
 * same grammar the answer validator enforced; this is the defense-in-depth
 * layer (a hand-edited DB row cannot smuggle a metacharacter through).
 * PURE: builds a string, touches nothing.
 *
 * Throws AppError(400, 'SANDBOX_BAD_FILE') on any violation.
 */
export function buildBootstrap(language: CodeLanguage, files: CodeFile[], entry: string): string {
  if (!Object.prototype.hasOwnProperty.call(ENTRY_INTERPRETER, language)) {
    throw new AppError(400, `Unsupported sandbox language: ${String(language)}`, 'SANDBOX_LANGUAGE_UNSUPPORTED');
  }
  if (files.length < 1 || files.length > MAX_CODE_FILES) {
    throw new AppError(400, `Multi-file programs carry 1-${MAX_CODE_FILES} files`, 'SANDBOX_BAD_FILE');
  }
  const seen = new Set<string>();
  let total = 0;
  const lines: string[] = [BOOTSTRAP_MARKER, 'set -eu', 'mkdir -p /tmp/w', 'cd /tmp/w'];
  for (const file of files) {
    if (!isValidFilePath(file.path) || seen.has(file.path)) {
      throw new AppError(400, `Unsafe or duplicate file path: ${String(file.path).slice(0, 80)}`, 'SANDBOX_BAD_FILE');
    }
    if (typeof file.content !== 'string' || file.content.length > MAX_FILE_CHARS) {
      throw new AppError(400, `File too large: ${file.path}`, 'SANDBOX_BAD_FILE');
    }
    seen.add(file.path);
    total += file.content.length;
    if (total > MAX_TOTAL_CHARS) {
      throw new AppError(400, 'Multi-file program exceeds the total size cap', 'SANDBOX_BAD_FILE');
    }
    lines.push(`printf '%s' '${Buffer.from(file.content, 'utf8').toString('base64')}' | base64 -d > '${file.path}'`);
  }
  if (!isValidFilePath(entry) || !seen.has(entry)) {
    throw new AppError(400, 'Entry must name one of the files', 'SANDBOX_BAD_FILE');
  }
  lines.push(`exec ${ENTRY_INTERPRETER[language]} '${entry}' "$@"`);
  return lines.join('\n') + '\n';
}

/**
 * Program view of a NORMALIZED code answer (either arm) for the executor:
 * single-file answers run as plain source; multi-file answers run as the
 * pre-built bootstrap script (`bootstrap: true` switches the interpreter
 * prefix to `sh -s --`). Pure; re-validates everything buildBootstrap checks.
 */
export function programFor(
  normalized: { kind: 'text'; text: string } | { kind: 'files'; files: CodeFile[]; entry: string },
  language: CodeLanguage,
): { code: string; bootstrap: boolean } {
  if (normalized.kind === 'text') {
    return { code: normalized.text, bootstrap: false };
  }
  return { code: buildBootstrap(language, normalized.files, normalized.entry), bootstrap: true };
}

// ─── Runtime invariant checker (used by DockerExecutor AND the tests) ─────────

/** Fail-closed validator for an explicit image override (see buildRunArgs). */
function requireSafeTemplateImage(image: string): string {
  if (!isSafeImageRef(image)) {
    throw new AppError(
      500,
      `Sandbox template image rejected as unsafe: ${JSON.stringify(image.slice(0, 120))}`,
      'SANDBOX_TEMPLATE_UNSAFE',
    );
  }
  return image;
}

/**
 * DEFAULT-DENY, EXACT-PREFIX invariant checking (QA wave-7 F1–F4 redesign).
 *
 * Docker parses flags only before the image (`flags.SetInterspersed(false)`)
 * and repeated flags are LAST-OCCURRENCE-WINS (pflag Set overwrites) — so a
 * "contains the right flags" checker proves nothing: `--network none
 * --network host` passes it while docker runs host networking. The builder's
 * argv is fully deterministic, therefore the ONLY correct runtime check is:
 * the flag region (argv up to and including the image) must EXACTLY equal the
 * canonical hardened prefix for the resolved image.
 *
 * Consequences by construction: duplicate/`=false` flag forms fail (prefix
 * mismatch), foreign images fail (position mismatch), ANY extra flag
 * (--pid/--ipc/--cap-add/--device/…) fails, and tokens AFTER the image are
 * the candidate's own program argv — inert data, never scanned, so an
 * LLM-generated case arg of literally `--privileged` can no longer abort the
 * whole execution (the old checker's fail-closed collateral, F4).
 *
 * V2-4 (D21) PARAMETERIZATION — the exact-prefix law is NOT weakened: with
 * `opts.image` (a company template override) the accepted prefix set is
 * rebuilt from THAT image alone — canonical prefix = flags + THE RESOLVED
 * image (opts.timeoutMs pins --stop-timeout the same way). The default-image
 * prefixes are NOT accepted in that mode: the checker verifies the spawn argv
 * matches exactly what the resolver decided, byte for byte. Without opts it
 * stays the historical default set — one prefix per allow-listed language.
 *
 * The canonical prefixes derive from buildRunArgs itself: the checker's job
 * is to catch argv tampering/regression between construction and spawn; the
 * BUILDER's exact output is independently pinned by the snapshot and
 * flag-assertion tests in tests/sandbox-builder.test.ts. Two layers, one
 * invariant each.
 */
const CANONICAL_PREFIXES: readonly string[][] = (Object.keys(IMAGE_ALLOW_LIST) as CodeLanguage[]).map(
  (lang) => {
    const full = buildRunArgs({ language: lang });
    const cmdLen = COMMAND_PREFIX[lang].length;
    return full.slice(0, full.length - cmdLen); // flags + image, nothing after
  },
);

/**
 * Canonical hardened prefixes for one resolution context (pure): the flag
 * region buildRunArgs produces for every language under `opts`. With an
 * image pinned, all languages share the same flag region (they differ only
 * in image and interpreter command, both sliced off) — the array form keeps
 * the derivation identical to the default mode.
 */
function canonicalPrefixes(opts?: { image?: string; timeoutMs?: number }): readonly string[][] {
  if (opts?.image === undefined) return CANONICAL_PREFIXES;
  return (Object.keys(IMAGE_ALLOW_LIST) as CodeLanguage[]).map((lang) => {
    // buildRunArgs validates opts.image (throws SANDBOX_TEMPLATE_UNSAFE) —
    // the checker never mints a prefix for an unsafe image.
    const full = buildRunArgs({ language: lang }, opts);
    const cmdLen = COMMAND_PREFIX[lang].length;
    return full.slice(0, full.length - cmdLen);
  });
}

/**
 * PURE invariant checker over a `docker run` argv (everything after `run`).
 * Throws AppError(500, 'SANDBOX_ARGS_UNHARDENED') unless the argv starts with
 * EXACTLY one canonical hardened prefix (see canonicalPrefixes above).
 * Called by DockerExecutor's constructor (boot-time fail-fast across all
 * three languages) and in execute() before every spawn — with the SAME
 * opts (image + timeoutMs) the argv was built with.
 */
export function assertHardenedArgs(
  args: string[],
  opts?: { image?: string; timeoutMs?: number },
): void {
  const fail = (why: string): never => {
    throw new AppError(500, `Refusing to spawn unhardened docker argv: ${why}`, 'SANDBOX_ARGS_UNHARDENED');
  };

  if (args.length === 0) fail('empty argv');

  const matched = canonicalPrefixes(opts).some(
    (prefix) =>
      args.length >= prefix.length &&
      prefix.every((token, i) => args[i] === token),
  );
  if (!matched) {
    fail('flag region does not exactly match a canonical hardened prefix (docker: last-occurrence-wins, duplicates/=false forms rejected)');
  }
}
