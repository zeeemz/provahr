import { prisma } from '../../prisma';
import { AppError } from '../../lib/http';
import type { PublicUser } from '../../types';
import { register } from '../auth/auth.service';
import type { InstallInput } from './setup.schema';

/**
 * An install counts as "configured" once a company row exists (single company
 * per install — PLAN.md §3 / D6). No company ⇒ the setup wizard is unlocked.
 */
export async function isInstalled(): Promise<boolean> {
  const companies = await prisma.company.count();
  return companies > 0;
}

/**
 * Bootstraps the install: creates the company and its first ADMIN user by
 * delegating to the existing auth `register()` — one code path for password
 * hashing, slug handling, and transaction semantics. No duplicated logic.
 */
export async function install(input: InstallInput): Promise<PublicUser> {
  if (await isInstalled()) {
    throw new AppError(409, 'Setup already completed', 'ALREADY_INSTALLED');
  }
  const { user } = await register({
    companyName: input.companyName,
    name: input.adminName,
    email: input.adminEmail,
    password: input.adminPassword,
  });
  return user;
}
