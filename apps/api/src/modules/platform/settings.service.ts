import { prisma } from '../../prisma';
import { env } from '../../env';
import type { PutPlatformSettingsInput } from './platform.schema';

export type AuthMode = 'local' | 'oidc';

export interface PlatformSettingsView {
  authMode: AuthMode;
}

/** @updatedAt is Prisma-managed; the seed/migration provides the column value. */
type SettingsRow = { authMode: string };

function normalizeAuthMode(value: string | null | undefined): AuthMode | null {
  return value === 'local' || value === 'oidc' ? value : null;
}

/** Boot-time fallback (D19: env vars remain the fallback when no data exists). */
function envAuthMode(): AuthMode {
  return env.OIDC_ENABLED ? 'oidc' : 'local';
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
 */
export async function getAuthMode(): Promise<AuthMode> {
  try {
    const row: SettingsRow | null = await prisma.platformSettings.findUnique({
      where: { id: 'singleton' },
      select: { authMode: true },
    });
    return normalizeAuthMode(row?.authMode) ?? envAuthMode();
  } catch {
    return envAuthMode();
  }
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
 * V2-1 honesty note: switching feeds /api/auth/mode and the portal display;
 * the OIDC middleware still branches on OIDC_ENABLED until V2-3 wires
 * verification to this row.
 */
export async function putPlatformSettings(input: PutPlatformSettingsInput): Promise<PlatformSettingsView> {
  const row = await prisma.platformSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', authMode: input.authMode },
    update: { authMode: input.authMode },
    select: { authMode: true },
  });
  return { authMode: normalizeAuthMode(row.authMode) ?? input.authMode };
}
