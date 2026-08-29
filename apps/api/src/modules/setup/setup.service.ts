// V2-1 (wizard v3, PLAN.md §12 D18): setup bootstraps the PLATFORM super
// admin only; companies become super-admin-console concerns. The remaining
// SaaS phases (company-scoped LLM providers V2-2, runtime Keycloak V2-3,
// sandbox templates V2-4, docs V2-5) are tracked in PLAN.md §12.1.

import { prisma } from '../../prisma';
import { AppError } from '../../lib/http';
import type { PublicUser } from '../../types';
import { register } from '../auth/auth.service';
import type { InstallInput } from './setup.schema';

/**
 * An install counts as "configured" once a PLATFORM SUPER_ADMIN exists
 * (PLAN.md §12 D18 — supersedes the old "a company exists" invariant).
 * No super admin ⇒ the setup wizard is unlocked.
 */
export async function isInstalled(): Promise<boolean> {
  const superAdmins = await prisma.user.count({ where: { role: 'SUPER_ADMIN' } });
  return superAdmins > 0;
}

/**
 * Bootstraps the platform: creates the super admin (no company) by delegating
 * to auth `register()` — one code path for the setup lock, password hashing
 * and the SUPER_ADMIN semantics. No duplicated logic.
 */
export async function install(input: InstallInput): Promise<PublicUser> {
  if (await isInstalled()) {
    throw new AppError(409, 'Setup already completed', 'ALREADY_INSTALLED');
  }
  const { user } = await register({
    name: input.adminName,
    email: input.adminEmail,
    password: input.adminPassword,
  });
  return user;
}
