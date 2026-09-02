import { prisma } from '../../prisma';
import { AppError } from '../../lib/http';
import { hashPassword } from '../../lib/password';
import { toPublicUser } from '../../types';
import type { AuthUser } from '../../types';
import type { CreateUserInput } from './users.schema';

/** Lists the members of the caller's company (all roles — colleagues see each other). */
export async function listCompanyUsers(user: AuthUser) {
  const users = await prisma.user.findMany({
    where: { companyId: user.companyId },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });
  return users;
}

/** Creates a team member in the caller's company. */
export async function createCompanyUser(actor: AuthUser, input: CreateUserInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError(409, 'An account with this email already exists', 'EMAIL_TAKEN');
  }
  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      role: input.role,
      passwordHash,
      companyId: actor.companyId,
    },
  });
  return toPublicUser(user);
}
