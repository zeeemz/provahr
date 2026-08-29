import type { Request, RequestHandler, NextFunction } from 'express';
import type { UserRole } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { prisma } from '../prisma';
import { env } from '../env';
import { verifyToken } from '../lib/token';
import { AppError } from '../lib/http';
import { getJwksCache, verifyOidcToken, type OidcTokenInfo } from '../lib/oidc';
import { mapRoles, type ProvaRole } from '../lib/roles';
import { hashPassword } from '../lib/password';
import type { AuthUser } from '../types';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Validates the Bearer token and attaches `req.user`. Two modes:
 *
 * - Local mode (`OIDC_ENABLED=false`, the dev default): verifies the local
 *   JWT and loads the user from the database, so disabled or deleted
 *   accounts stop working immediately. A `SUPER_ADMIN` user attaches with
 *   `companyId` null (PLAN.md §12 D18).
 * - Keycloak mode (`OIDC_ENABLED=true`): verifies the OIDC access token
 *   against the issuer's JWKS and provisions/syncs a local user row.
 *
 * Attach after this middleware with `requireRole(...)` for company routes,
 * or the platform module's `requireSuperAdmin` for platform routes.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next(new AppError(401, 'Authentication required', 'UNAUTHENTICATED'));
    return;
  }
  const token = header.slice('Bearer '.length);

  if (env.OIDC_ENABLED) {
    oidcAuth(req, token, next);
    return;
  }
  localAuth(req, token, next);
};

/** Local mode: JWT_SECRET-signed token → user lookup → req.user. */
function localAuth(req: Request, token: string, next: NextFunction): void {
  let userId: string;
  try {
    userId = verifyToken(token);
  } catch (err) {
    next(err);
    return;
  }

  prisma.user
    .findUnique({ where: { id: userId }, include: { company: true } })
    .then((user) => {
      // SUPER_ADMIN is platform-level (PLAN.md §12 D18): it carries no company
      // and authenticates with companyId null. Every other role must belong to
      // a company — a company-less row of those roles is inert (401), which is
      // how company-scoped routes keep 401/403-ing super admins without any
      // per-service edits: requireRole simply never admits SUPER_ADMIN.
      if (user && user.role === 'SUPER_ADMIN') {
        req.user = {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          companyId: user.companyId,
          companyName: user.company?.name ?? null,
        };
        next();
        return;
      }
      if (!user || !user.company) {
        next(new AppError(401, 'Account not found', 'UNAUTHENTICATED'));
        return;
      }
      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        companyId: user.companyId,
        companyName: user.company.name,
      };
      next();
    })
    .catch(next);
}

/** Keycloak mode: OIDC access token → role mapping → user sync → req.user. */
function oidcAuth(req: Request, token: string, next: NextFunction): void {
  verifyOidcToken(token, { issuerUrl: env.OIDC_ISSUER_URL, audience: env.OIDC_AUDIENCE }, getJwksCache(env.OIDC_ISSUER_URL))
    .then((info) => {
      const role = mapRoles(info.roles);
      if (!role) {
        throw new AppError(403, 'Token has no ProvaHR role', 'FORBIDDEN');
      }
      return provisionOidcUser(info, role);
    })
    .then((user) => {
      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        // OIDC users are company members (V2-1 keeps single-realm Keycloak;
        // per-company issuers arrive with V2-3), so a company is guaranteed
        // here — but the typing stays nullable like the column it mirrors.
        companyId: user.companyId,
        companyName: user.company?.name ?? null,
      };
      next();
    })
    .catch(next);
}

/**
 * Creates or updates the local user row for a verified token. The user must
 * belong to a company, which only exists after the platform super admin has
 * created one. Keycloak is the source of truth for name and role while OIDC
 * is enabled.
 */
async function provisionOidcUser(
  info: OidcTokenInfo,
  role: ProvaRole,
): Promise<{ id: string; email: string; name: string; role: UserRole; companyId: string | null; company: { name: string } | null }> {
  const company = await prisma.company.findFirst();
  if (!company) {
    throw new AppError(503, 'Setup not completed — finish the /setup wizard first', 'SETUP_REQUIRED');
  }
  // The account cannot be logged into locally: the password hash is derived
  // from 32 random bytes that nobody knows and that are not stored anywhere.
  const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
  return prisma.user.upsert({
    where: { email: info.email },
    create: {
      email: info.email,
      name: info.name,
      role,
      companyId: company.id,
      passwordHash,
    },
    update: { name: info.name, role },
    include: { company: true },
  });
}

/** Restricts a route to specific roles. Use after `requireAuth`. */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(new AppError(401, 'Authentication required', 'UNAUTHENTICATED'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new AppError(403, 'You do not have permission to perform this action', 'FORBIDDEN'));
      return;
    }
    next();
  };
}
