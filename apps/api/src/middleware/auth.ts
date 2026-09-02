import type { Request, RequestHandler, NextFunction } from 'express';
import type { UserRole } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';
import { env } from '../env';
import { verifyToken } from '../lib/token';
import { AppError } from '../lib/http';
import { getJwksCache, verifyOidcToken, type OidcTokenInfo } from '../lib/oidc';
import { mapRoles, type ProvaRole } from '../lib/roles';
import { hashPassword } from '../lib/password';
import { getAuthMode } from '../modules/platform/settings.service';
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
 * Validates the Bearer token and attaches `req.user` (V2-3, PLAN.md §12 D19).
 *
 * WHICH verifier runs is per-request, data-driven: the platform settings row
 * (`authMode`, read through the 10s-cached getAuthMode) decides, with the
 * boot-time env (OIDC_ENABLED) as the fallback when no row exists or the
 * database is unreadable. The portal switch applies on the next request.
 *
 * - Local mode: verifies the local JWT and loads the user from the database,
 *   so disabled or deleted accounts stop working immediately. A `SUPER_ADMIN`
 *   user attaches with `companyId` null (PLAN.md §12 D18).
 * - Keycloak mode (oidc): multi-issuer resolution — the token's unverified
 *   `iss` claim selects the company auth config (CompanyAuthConfig, enabled)
 *   whose issuer+audience+JWKS then cryptographically verify it; no company
 *   match falls back to the env platform default (OIDC_ISSUER_URL/OIDC_AUDIENCE);
 *   anything else is a 401. Role mapping and user provisioning are unchanged
 *   from V2-1, except provisioning now anchors the user to the matched
 *   config's company.
 *
 * TWO lockout carve-outs in oidc mode (founder requirement, D19):
 * 1. The SUPER_ADMIN always authenticates locally — a broken Keycloak config
 *    must never lock the platform owner out of the portal that fixes it.
 * 2. Symmetrically, company users can NOT ride local tokens in oidc mode
 *    (403 SSO_MODE_ACTIVE): with SSO on, company credentials live in Keycloak.
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

  // getAuthMode never rejects (fail-open to the env mode), but route the
  // impossible rejection into the error handler anyway.
  getAuthMode()
    .then((mode) => {
      if (mode === 'oidc') {
        ssoAuth(req, token, next);
        return;
      }
      localAuth(req, token, next);
    })
    .catch(next);
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
  loadUserById(userId)
    .then((user) => {
      // SUPER_ADMIN is platform-level (PLAN.md §12 D18): it carries no company
      // and authenticates with companyId null. Every other role must belong to
      // a company — a company-less row of those roles is inert (401), which is
      // how company-scoped routes keep 401/403-ing super admins without any
      // per-service edits: requireRole simply never admits SUPER_ADMIN.
      if (user && user.role === 'SUPER_ADMIN') {
        req.user = toAuthUser(user);
        next();
        return;
      }
      if (!user || !user.company) {
        next(new AppError(401, 'Account not found', 'UNAUTHENTICATED'));
        return;
      }
      req.user = toAuthUser(user);
      next();
    })
    .catch(next);
}

/**
 * OIDC mode with the two carve-outs (D19). A token that verifies LOCALLY is
 * either the super admin (rule 1: pass — the Keycloak breaker must not break
 * the platform owner) or a company user trying to keep local credentials
 * alive under SSO (rule 2: 403). A token that does not verify locally is put
 * on the OIDC path — an attacker cannot use this branch to skip verification,
 * because passing it still requires a valid JWT_SECRET signature.
 */
function ssoAuth(req: Request, token: string, next: NextFunction): void {
  let userId: string | null = null;
  try {
    userId = verifyToken(token);
  } catch {
    // Not a local token — presumably an OIDC access token.
  }
  if (userId === null) {
    oidcAuth(req, token, next);
    return;
  }
  loadUserById(userId)
    .then((user) => {
      if (user && user.role === 'SUPER_ADMIN') {
        req.user = toAuthUser(user);
        next();
        return;
      }
      next(
        new AppError(
          403,
          'SSO mode is active — sign in with your company account (Keycloak)',
          'SSO_MODE_ACTIVE',
        ),
      );
    })
    .catch(next);
}

/**
 * Keycloak mode: multi-issuer resolution (V2-3) → verify → role map → user
 * sync → req.user. See resolveOidcConfig for the security shape of the
 * unverified-issuer hop.
 */
function oidcAuth(req: Request, token: string, next: NextFunction): void {
  resolveOidcConfig(token)
    .then((cfg) => {
      if (!cfg) {
        throw new AppError(401, 'Unknown token issuer', 'UNAUTHENTICATED');
      }
      // JwksCache is already keyed per issuer (lib/oidc.ts) — one cache per
      // configured realm, shared across requests.
      return verifyOidcToken(token, cfg, getJwksCache(cfg.issuerUrl)).then((info) => ({ cfg, info }));
    })
    .then(({ cfg, info }) => {
      const role = mapRoles(info.roles);
      if (!role) {
        throw new AppError(403, 'Token has no ProvaHR role', 'FORBIDDEN');
      }
      return provisionOidcUser(info, role, cfg.companyId ?? undefined);
    })
    .then((user) => {
      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        // When the token resolved through a company auth config this is that
        // company; the platform-default (env) path falls back to V2-1
        // behavior. The typing stays nullable like the column it mirrors.
        companyId: user.companyId,
        companyName: user.company?.name ?? null,
      };
      next();
    })
    .catch(next);
}

/** The issuer + audience a token must verify against, and the company it maps to. */
interface OidcVerifierConfig {
  issuerUrl: string;
  audience: string;
  /** Company whose enabled CompanyAuthConfig matched the issuer; null = env platform default. */
  companyId: string | null;
}

/**
 * Reads the token's `iss` claim WITHOUT signature verification and resolves
 * the verifier config it selects (V2-3, D19).
 *
 * Why the unverified decode is safe: the claim is used ONLY to choose which
 * STORED configuration cryptographically verifies the token — never to build
 * a URL or trust a claim. jwt.verify then enforces `issuer` (raw-string
 * comparison against the selected config's issuerUrl) plus `aud` and the
 * RS256 signature, so a forged `iss` merely picks the verifier that will
 * reject the forgery. This is the same trust shape as the `kid` header →
 * JWKS lookup the V1 code already relied on: untrusted input selects key
 * material from trusted storage; the crypto check binds them.
 *
 * Resolution order: an enabled CompanyAuthConfig with a matching issuerUrl →
 * else, exactly the env platform default (OIDC_ISSUER_URL/OIDC_AUDIENCE) →
 * else null (401 upstream). A database error degrades to the env branch: a
 * company-issuer token cannot match the env issuer, so it fails closed,
 * while the platform-default realm keeps working.
 */
async function resolveOidcConfig(token: string): Promise<OidcVerifierConfig | null> {
  const iss = extractUnverifiedIssuer(token);
  if (!iss) {
    return null;
  }
  try {
    const cfg = await prisma.companyAuthConfig.findFirst({
      where: { issuerUrl: iss, enabled: true },
      select: { issuerUrl: true, audience: true, companyId: true },
    });
    if (cfg) {
      return cfg;
    }
  } catch {
    // fall through to the env default — see the doc comment above
  }
  if (iss === env.OIDC_ISSUER_URL) {
    return { issuerUrl: env.OIDC_ISSUER_URL, audience: env.OIDC_AUDIENCE, companyId: null };
  }
  return null;
}

/** Decodes `iss` (unverified — see resolveOidcConfig) with Keycloak/env slash normalization. */
function extractUnverifiedIssuer(token: string): string | null {
  try {
    const decoded = jwt.decode(token);
    const iss = decoded && typeof decoded === 'object' ? (decoded as jwt.JwtPayload).iss : undefined;
    return typeof iss === 'string' && iss.length > 0 ? iss.replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
}

type LoadedUser = NonNullable<Awaited<ReturnType<typeof loadUserById>>>;

function loadUserById(id: string) {
  return prisma.user.findUnique({ where: { id }, include: { company: true } });
}

function toAuthUser(user: LoadedUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    companyId: user.companyId,
    companyName: user.company?.name ?? null,
  };
}

/**
 * Creates or updates the local user row for a verified token. With a matched
 * company config (V2-3) the user is anchored to THAT company; the env
 * platform-default path keeps the V2-1 behavior of joining the first company
 * (single-realm installs). Keycloak is the source of truth for name and role
 * while OIDC is enabled.
 */
async function provisionOidcUser(
  info: OidcTokenInfo,
  role: ProvaRole,
  companyId?: string,
): Promise<{ id: string; email: string; name: string; role: UserRole; companyId: string | null; company: { name: string } | null }> {
  // Re-read rather than trusting the config snapshot: a company deleted
  // between resolution and provisioning must not leak into an upsert.
  const company = companyId
    ? await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } })
    : await prisma.company.findFirst({ select: { id: true, name: true } });
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
