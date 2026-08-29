import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { AppError } from '../../lib/http';
import { hashPassword } from '../../lib/password';
import { slugify } from '../../lib/slug';
import { toPublicUser, type PublicUser } from '../../types';
import type { CreateCompanyInput, PatchCompanyInput } from './platform.schema';

export interface PlatformCompanyRow {
  id: string;
  name: string;
  slug: string;
  website: string | null;
  createdAt: Date;
  userCount: number;
}

/** Unique slugs: on collision a short random suffix is appended (same scheme the v1 register used). */
async function freeSlug(tx: Prisma.TransactionClient, name: string): Promise<string> {
  let slug = slugify(name);
  const taken = await tx.company.findUnique({ where: { slug } });
  if (taken) {
    slug = `${slug}-${randomBytes(3).toString('hex')}`;
  }
  return slug;
}

/** GET /api/platform/companies — every tenant with its user count. */
export async function listCompanies(): Promise<PlatformCompanyRow[]> {
  const companies = await prisma.company.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      slug: true,
      website: true,
      createdAt: true,
      _count: { select: { users: true } },
    },
  });
  return companies.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    website: c.website,
    createdAt: c.createdAt,
    userCount: c._count.users,
  }));
}

/**
 * POST /api/platform/companies — the "company wizard" API (D18): creates a
 * tenant and, optionally, its first ADMIN in ONE transaction. Without
 * firstAdmin the company starts empty (an ADMIN can still be invited later
 * only from inside the company — so the wizard form strongly prefers passing
 * one; the API stays flexible for imports/scripts).
 */
export async function createCompany(
  input: CreateCompanyInput,
): Promise<{ company: PlatformCompanyRow; admin: PublicUser | null }> {
  const adminHash = input.firstAdmin ? await hashPassword(input.firstAdmin.password) : null;

  const { company, admin } = await prisma.$transaction(async (tx) => {
    if (input.firstAdmin) {
      const existing = await tx.user.findUnique({ where: { email: input.firstAdmin!.email } });
      if (existing) {
        throw new AppError(409, 'An account with this email already exists', 'EMAIL_TAKEN');
      }
    }

    const slug = await freeSlug(tx, input.name);
    const created = await tx.company.create({
      data: {
        name: input.name.trim(),
        slug,
        ...(input.website !== undefined ? { website: input.website } : {}),
      },
    });

    let firstAdmin = null;
    if (input.firstAdmin && adminHash !== null) {
      firstAdmin = await tx.user.create({
        data: {
          email: input.firstAdmin.email,
          name: input.firstAdmin.name.trim(),
          role: 'ADMIN',
          passwordHash: adminHash,
          companyId: created.id,
        },
      });
    }
    return { company: created, admin: firstAdmin };
  });

  return {
    company: {
      id: company.id,
      name: company.name,
      slug: company.slug,
      website: company.website,
      createdAt: company.createdAt,
      userCount: admin ? 1 : 0,
    },
    admin: admin ? toPublicUser(admin) : null,
  };
}

/** PATCH /api/platform/companies/:id — rename / re-website a tenant. */
export async function patchCompany(id: string, input: PatchCompanyInput): Promise<PlatformCompanyRow> {
  const existing = await prisma.company.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
  if (!existing) {
    throw new AppError(404, 'Company not found', 'NOT_FOUND');
  }
  // A rename keeps the slug stable (slugs are identifiers, not display names).
  const company = await prisma.company.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.website !== undefined ? { website: input.website } : {}),
    },
    include: { _count: { select: { users: true } } },
  });
  return {
    id: company.id,
    name: company.name,
    slug: company.slug,
    website: company.website,
    createdAt: company.createdAt,
    userCount: company._count.users,
  };
}

/**
 * DELETE /api/platform/companies/:id — removes a tenant; the schema's
 * onDelete: Cascade folds its users, jobs and downstream hiring data with it.
 */
export async function deleteCompany(id: string): Promise<void> {
  const existing = await prisma.company.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    throw new AppError(404, 'Company not found', 'NOT_FOUND');
  }
  await prisma.company.delete({ where: { id } });
}
