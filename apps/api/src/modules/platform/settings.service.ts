import { prisma } from '../../prisma';
import { env } from '../../env';
import type { PutPlatformSettingsInput } from './platform.schema';

export type AuthMode = 'local' | 'oidc';

export interface PlatformSettingsView {
  authMode: AuthMode;
}

/** @updatedAt is Prisma-managed; the seed/migration provides the column value. */
type SettingsRow = { authMode: string; mainPrompt?: string | null };

function normalizeAuthMode(value: string | null | undefined): AuthMode | null {
  return value === 'local' || value === 'oidc' ? value : null;
}

/**
 * Boot-time fallback (D19: env vars remain the fallback when no data exists).
 */
function envAuthMode(): AuthMode {
  return env.OIDC_ENABLED ? 'oidc' : 'local';
}

/**
 * How long a successful read of PlatformSettings.authMode is trusted
 * in-memory (V2-3). The middleware resolves the mode per request now, so an
 * uncached read would put a settings query on every authenticated call; 10s
 * is the deliberate ceiling on how stale a mode switch can be (PUT refreshes
 * the cache immediately, so switches made through the portal apply at once —
 * only out-of-band database edits pay the 10s).
 */
export const AUTH_MODE_CACHE_MS = 10_000;

let cachedAuthMode: { value: AuthMode; at: number } | null = null;

/** Test seam: drops the in-memory mode cache so the next read hits the database mock. */
export function resetAuthModeCacheForTests(): void {
  cachedAuthMode = null;
}

/**
 * The platform's runtime auth mode (D19): PlatformSettings.authMode when the
 * singleton row carries a valid value, else the env fallback.
 *
 * This read is deliberately fail-open to the env fallback: GET /api/auth/mode
 * is the gate for the login UX and the setup wizard's finish step, so an
 * unreadable database (or a `db push` database with no seed) must degrade to
 * the boot-time mode, never 500. The WRITE path (putPlatformSettings)
 * propagates errors normally.
 *
 * Since V2-3 this is the value the auth MIDDLEWARE branches on per request
 * (src/middleware/auth.ts) — hence the 10s cache above. Error reads are not
 * cached: a transient database blip must not pin the fallback mode, and each
 * retry costs one indexed primary-key lookup.
 */
export async function getAuthMode(): Promise<AuthMode> {
  if (cachedAuthMode && Date.now() - cachedAuthMode.at < AUTH_MODE_CACHE_MS) {
    return cachedAuthMode.value;
  }
  try {
    const row: SettingsRow | null = await prisma.platformSettings.findUnique({
      where: { id: 'singleton' },
      select: { authMode: true },
    });
    const value = normalizeAuthMode(row?.authMode) ?? envAuthMode();
    cachedAuthMode = { value, at: Date.now() };
    return value;
  } catch {
    return envAuthMode();
  }
}

// ─── Main prompt tier (founder requirement: two-tier system prompts) ─────────

/**
 * Same staleness ceiling as the auth-mode cache (V2-3 pattern): the main
 * prompt rides every LLM call, so an uncached read would put a settings
 * query on each one; 10s is the deliberate ceiling on how stale a prompt
 * edit can be. The PUT below refreshes the cache immediately, so edits made
 * through the portal apply at once — only out-of-band database edits pay
 * the 10s.
 */
export const MAIN_PROMPT_CACHE_MS = AUTH_MODE_CACHE_MS;

let cachedMainPrompt: { value: string; at: number } | null = null;

/** Test seam: drops the in-memory main-prompt cache so the next read hits the database mock. */
export function resetMainPromptCacheForTests(): void {
  cachedMainPrompt = null;
}

/**
 * The platform-wide MAIN system-prompt tier (founder requirement): rules the
 * super admin wants appended to EVERY LLM generation (JDs, test items,
 * written/code reviews). Composed ahead of each job's own prompt by
 * src/prompts/compose.ts.
 *
 * Fail-open to '' exactly like getAuthMode degrades to env: the overlay is an
 * enhancement, never a dependency — an unreadable database must not take LLM
 * calls (or the read-only console) down. Error reads are not cached.
 */
export async function getMainPrompt(): Promise<string> {
  if (cachedMainPrompt && Date.now() - cachedMainPrompt.at < MAIN_PROMPT_CACHE_MS) {
    return cachedMainPrompt.value;
  }
  try {
    const row = await prisma.platformSettings.findUnique({
      where: { id: 'singleton' },
      select: { mainPrompt: true },
    });
    const value = typeof row?.mainPrompt === 'string' ? row.mainPrompt : '';
    cachedMainPrompt = { value, at: Date.now() };
    return value;
  } catch {
    return '';
  }
}

/**
 * PUT /api/platform/prompts/main — the super-admin editor for the MAIN tier
 * (founder requirement: editable ONLY by root). Upsert so `db push` databases
 * (no migration seed) materialize the singleton row on first write; validation
 * (0..8000 chars) lives in the router's zod schema.
 *
 * Refreshes BOTH caches: the main-prompt one from the written row, and the
 * auth-mode one because the create branch materializes a row whose defaulted
 * authMode now outranks the env fallback. (putPlatformSettings above needs no
 * counterpart here: it never touches mainPrompt, so that cache stays valid.)
 */
export async function putMainPrompt(mainPrompt: string): Promise<{ mainPrompt: string }> {
  const row = await prisma.platformSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', mainPrompt },
    update: { mainPrompt },
    select: { authMode: true, mainPrompt: true },
  });
  cachedMainPrompt = { value: row.mainPrompt ?? '', at: Date.now() };
  const authMode = normalizeAuthMode(row.authMode);
  if (authMode) cachedAuthMode = { value: authMode, at: Date.now() };
  return { mainPrompt: row.mainPrompt ?? '' };
}

/** GET /api/platform/settings — the portal display behind the toggle. */
export async function getPlatformSettings(): Promise<PlatformSettingsView> {
  return { authMode: await getAuthMode() };
}

/**
 * PUT /api/platform/settings — the switch itself (D19). Upsert so databases
 * created via `db push` (no migration seed) materialize the singleton row on
 * first write. Validation lives in the zod schema ('local' | 'oidc').
 *
 * V2-3: the switch is fully live — the auth middleware resolves the mode from
 * this row per request (with the 10s cache), so this write refreshes the
 * cache immediately: a flip made in the portal changes which verifier runs
 * on the very next request, no restart.
 */
export async function putPlatformSettings(input: PutPlatformSettingsInput): Promise<PlatformSettingsView> {
  const row = await prisma.platformSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', authMode: input.authMode },
    update: { authMode: input.authMode },
    select: { authMode: true },
  });
  const authMode = normalizeAuthMode(row.authMode) ?? input.authMode;
  cachedAuthMode = { value: authMode, at: Date.now() };
  return { authMode };
}
