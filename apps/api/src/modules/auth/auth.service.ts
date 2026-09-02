import bcrypt from 'bcryptjs';
import { prisma } from '../../prisma';
import { AppError } from '../../lib/http';
import { hashPassword, verifyPassword } from '../../lib/password';
import { signToken } from '../../lib/token';
import { toPublicUser } from '../../types';
import type { LoginInput, RegisterInput } from './auth.schema';

// Compared against when the email is unknown so response times do not
// reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('invalid-password-placeholder', 10);

/**
 * Bootstraps the PLATFORM: creates the install's SUPER_ADMIN — and nothing
 * else (PLAN.md §12 D18). No company is created here; tenants are created by
 * the super admin via POST /api/platform/companies.
 *
 * Setup lock semantics (moved from the old single-company invariant): the
 * platform counts as installed once a SUPER_ADMIN exists. This 409s then, so
 * the first-run wizard (POST /api/setup/install, which delegates here) is the
 * only bootstrap path and the unauthenticated-register bypass around the
 * wizard's lock stays closed (QA wave-1, F1). Race note: unlike the v1 guard
 * (which had the companies_singleton_idx DB backstop), the lock is
 * service-level — a deliberate trade-off so the platform may grow additional
 * super admins later without a schema change; the install endpoint is
 * rate-limited and only reachable pre-install.
 */
export async function register(input: RegisterInput): Promise<{ token: string; user: ReturnType<typeof toPublicUser> }> {
  const superAdminCount = await prisma.user.count({ where: { role: 'SUPER_ADMIN' } });
  if (superAdminCount > 0) {
    throw new AppError(409, 'This install is already configured', 'ALREADY_INSTALLED');
  }

  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) {
    throw new AppError(409, 'An account with this email already exists', 'EMAIL_TAKEN');
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      name: input.name.trim(),
      role: 'SUPER_ADMIN',
      companyId: null, // platform-level (D18): super admins own no company
    },
  });

  return { token: signToken(user.id), user: toPublicUser(user) };
}

export async function login(input: LoginInput): Promise<{ token: string; user: ReturnType<typeof toPublicUser> }> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Compare against a dummy hash even when the user is missing so response
  // times do not reveal which emails exist.
  const hash = user?.passwordHash ?? DUMMY_HASH;
  const valid = await verifyPassword(input.password, hash);
  if (!user || !valid) {
    throw new AppError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
  }
  return { token: signToken(user.id), user: toPublicUser(user) };
}
