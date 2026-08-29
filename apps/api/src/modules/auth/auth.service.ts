import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../prisma';
import { AppError } from '../../lib/http';
import { hashPassword, verifyPassword } from '../../lib/password';
import { signToken } from '../../lib/token';
import { slugify } from '../../lib/slug';
import { toPublicUser } from '../../types';
import type { LoginInput, RegisterInput } from './auth.schema';

// Compared against when the email is unknown so response times do not
// reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('invalid-password-placeholder', 10);

/**
 * Creates the install's single company workspace and its first ADMIN user in
 * one transaction, then returns a login token. Company slugs are unique; on
 * collision a short random suffix is appended.
 *
 * Single-company invariant (PLAN D6): once a company exists this 409s — the
 * first-run wizard (POST /api/setup/install) is the only bootstrap path and
 * it delegates here *before* a company exists. This guard also closes the
 * unauthenticated-register bypass around the wizard's lock (QA wave-1, F1).
 */
export async function register(input: RegisterInput): Promise<{ token: string; user: ReturnType<typeof toPublicUser> }> {
  const companyCount = await prisma.company.count();
  if (companyCount > 0) {
    throw new AppError(409, 'This install is already configured', 'ALREADY_INSTALLED');
  }

  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) {
    throw new AppError(409, 'An account with this email already exists', 'EMAIL_TAKEN');
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.$transaction(async (tx) => {
    let slug = slugify(input.companyName);
    const slugTaken = await tx.company.findUnique({ where: { slug } });
    if (slugTaken) {
      slug = `${slug}-${randomBytes(3).toString('hex')}`;
    }

    const company = await tx.company.create({
      data: { name: input.companyName.trim(), slug },
    });

    return tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        name: input.name.trim(),
        role: 'ADMIN',
        companyId: company.id,
      },
    });
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
