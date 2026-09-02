// Company-scoped sandbox image templates (PLAN.md §12 D21, §12.1 V2-4).
//
// PURE: no side effects, no prisma, no I/O — the whole template surface is
// resolution + shape guarding, so it is exhaustively unit-tested
// (tests/sandbox-templates.test.ts) and safe to import from the argv builder.
//
// MODEL (D21): the platform owns a DEFAULT image per language
// (IMAGE_ALLOW_LIST, unchanged since Phase 7); a tenant may override ONE
// language's image with its own (e.g. a Java exercise image). Resolution is
//   enabled template with a SAFE image  →  the template image
//   missing / disabled / unsafe image    →  the platform default
// The default is always safe, so resolveImage's OUTPUT is always spawnable.
//
// HARDENING LAW (never weaken — builder.ts re-asserts per resolved image):
// an image override changes WHICH container runs, never HOW it runs: the
// docker flag region (--network none, --read-only, --user 65534:65534, …) is
// byte-identical for default and template images, and assertHardenedArgs
// rebuilds its canonical prefix from THE RESOLVED image. isSafeImageRef keeps
// an override from smuggling docker flags / shell metachars into the image
// token: lowercase docker-ref grammar only, ≤100 chars. Unsafe refs are
// rejected at template SAVE time (zod refine on this predicate) and at BUILD
// time (buildRunArgs throws SANDBOX_TEMPLATE_UNSAFE); resolveImage itself
// degrades an unsafe stored row to the default so a rogue row can never take
// candidate evaluations down — defense in depth, fail toward the safe image.

import type { CodeLanguage } from '../assessment/item';
import { AppError } from '../http';

/**
 * The platform-default sandbox images (PLAN §10 image allow-list, D21): the
 * image a language resolves to when the company has no usable template.
 * E2E FINDING (2026-08-29): `bash:5.2-alpine` does not exist on Docker Hub —
 * the official bash image publishes `5.2`, not `5.2-alpine`. Tags verified by
 * live `docker pull`.
 *
 * Lives HERE (not builder.ts) since V2-4: templates.ts is the resolution
 * layer; builder.ts imports and re-exports it so existing import sites are
 * unchanged.
 */
export const IMAGE_ALLOW_LIST: Record<CodeLanguage, string> = {
  BASH: 'bash:5.2',
  NODE: 'node:20-alpine',
  PYTHON: 'python:3.12-alpine',
};

/** Hard ceiling for a stored image ref — long enough for any real reference. */
export const MAX_IMAGE_REF_LENGTH = 100;

/**
 * SAFE-SUBSET docker reference grammar (deliberately stricter than Docker's
 * full spec): lowercase alphanumeric components joined by [._-] runs, an
 * optional host :port after the first component, any number of /path
 * components, and an optional final :tag. NO uppercase, NO whitespace, NO
 * flag/shell metachars ($ ` ; space = , @ etc.) — a value matching this
 * cannot start with '-' (so it can never parse as a docker flag) and cannot
 * break out of its single argv token (spawn never builds a shell string
 * anyway; this guard is belt-and-braces). Digests (@sha256:…) are out of
 * scope by design: tags only.
 */
const SAFE_IMAGE_REF = new RegExp(
  [
    '^',
    '[a-z0-9]+(?:[._-]+[a-z0-9]+)*', // first component (registry host or repo name)
    '(?::[0-9]+)?', // optional registry port
    '(?:/[a-z0-9]+(?:[._-]+[a-z0-9]+)*)*', // path components
    '(?::[a-z0-9]+(?:[._-]+[a-z0-9]+)*)?', // optional tag (digests unsupported)
    '$',
  ].join(''),
);

/**
 * Shape guard for a template image ref (the SAVE-time and BUILD-time check).
 * Pure predicate over the exact string that would land in the docker argv.
 */
export function isSafeImageRef(image: unknown): boolean {
  return typeof image === 'string' && image.length > 0 && image.length <= MAX_IMAGE_REF_LENGTH && SAFE_IMAGE_REF.test(image);
}

/** The minimal template shape resolution needs (a Prisma row satisfies it). */
export interface CompanyTemplate {
  image: string;
  /** Absent means enabled — `enabled` defaults to true in the model. */
  enabled?: boolean;
}

/**
 * Resolves the image a `docker run` uses for `language` (PURE):
 * the company template's image when the template is present AND enabled AND
 * safe, else the platform default (IMAGE_ALLOW_LIST). An unsafe stored ref
 * silently degrades to the default — the default is the safe direction, and
 * the SAVE-time zod check keeps such rows from existing in the first place.
 *
 * Throws AppError(400, 'SANDBOX_LANGUAGE_UNSUPPORTED') for a language with no
 * allow-list entry (hasOwnProperty guard: '__proto__' must not resolve).
 */
export function resolveImage(language: CodeLanguage, companyTemplate?: CompanyTemplate | null): string {
  // Same hasOwnProperty guard as builder.buildRunArgs (QA wave-7 F5): a
  // prototype-chain key like '__proto__' would otherwise resolve truthy.
  if (!Object.prototype.hasOwnProperty.call(IMAGE_ALLOW_LIST, language)) {
    throw new AppError(
      400,
      `Unsupported sandbox language: ${String(language)}`,
      'SANDBOX_LANGUAGE_UNSUPPORTED',
    );
  }
  if (companyTemplate && companyTemplate.enabled !== false && isSafeImageRef(companyTemplate.image)) {
    return companyTemplate.image;
  }
  return IMAGE_ALLOW_LIST[language];
}
