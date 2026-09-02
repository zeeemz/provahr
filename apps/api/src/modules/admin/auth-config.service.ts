import { prisma } from '../../prisma';
import { AppError } from '../../lib/http';
import type { PutAuthConfigInput } from './auth-config.schema';

// V2-3 (PLAN.md §12 D19): the per-company Keycloak/OIDC verifier as DATA.
// The company ADMIN owns its row (GET/PUT /api/admin/auth-config, scoped by
// req.user.companyId like llm-providers); the platform super admin sees every
// row read-only via GET /api/platform/auth-configs. A row with enabled=false
// authenticates nobody — the middleware's issuer resolution filters on it —
// so drafts are free and disabling is an instant off-switch for that tenant.

/** What any endpoint may reveal about a company auth config. No secrets exist in the row. */
export interface AuthConfigView {
  issuerUrl: string;
  audience: string;
  enabled: boolean;
  updatedAt: Date;
}

const authConfigSelect = {
  issuerUrl: true,
  audience: true,
  enabled: true,
  updatedAt: true,
} as const;

/** GET /api/admin/auth-config — the caller's company's config, or null when never saved. */
export async function getCompanyAuthConfig(companyId: string): Promise<AuthConfigView | null> {
  return prisma.companyAuthConfig.findUnique({ where: { companyId }, select: authConfigSelect });
}

/**
 * PUT /api/admin/auth-config — upserts the caller's company's config.
 *
 * Enabling an issuer another company already has enabled is refused (409):
 * the middleware resolves `iss` → ONE company, and two enabled rows for the
 * same issuer would make that resolution ambiguous. Disabled drafts never
 * clash. The migration-managed partial unique index
 * (0004_company_auth, "company_auth_configs_enabled_issuer_key") backstops
 * the race this pre-check cannot close — it surfaces as Prisma P2002, which
 * the global error handler already maps to 409.
 */
export async function putCompanyAuthConfig(companyId: string, input: PutAuthConfigInput): Promise<AuthConfigView> {
  if (input.enabled) {
    const clash = await prisma.companyAuthConfig.findFirst({
      where: { issuerUrl: input.issuerUrl, enabled: true, companyId: { not: companyId } },
      select: { id: true },
    });
    if (clash) {
      throw new AppError(409, 'Another company already verifies this issuer', 'ISSUER_TAKEN');
    }
  }
  return prisma.companyAuthConfig.upsert({
    where: { companyId },
    create: {
      companyId,
      issuerUrl: input.issuerUrl,
      audience: input.audience,
      enabled: input.enabled,
    },
    update: {
      issuerUrl: input.issuerUrl,
      audience: input.audience,
      enabled: input.enabled,
    },
    select: authConfigSelect,
  });
}

/**
 * True when at least one company has an ENABLED config — the `perCompany`
 * flag of GET /api/auth/mode. Fail-open to false (like getAuthMode's
 * fallback): the mode endpoint must never 500 on a database blip, and
 * "no per-company configs" is the conservative read for login UX.
 */
export async function hasAnyEnabledAuthConfig(): Promise<boolean> {
  try {
    const count = await prisma.companyAuthConfig.count({ where: { enabled: true } });
    return count > 0;
  } catch {
    return false;
  }
}

/** Row of GET /api/platform/auth-configs — every tenant, config or not, with a validity hint. */
export interface PlatformAuthConfigRow {
  companyId: string;
  companyName: string;
  authConfig: AuthConfigView | null;
  /** Cheap shape check only (http/https URL): no live discovery round-trip from a list endpoint. */
  issuerShapeValid: boolean;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * GET /api/platform/auth-configs (super admin): every company with its OIDC
 * config and an issuer-SHAPE hint — "looks like a reachable issuer URL", not
 * a verdict. Companies without a row list with authConfig null so the console
 * can distinguish "unconfigured" from "configured but disabled".
 */
export async function listPlatformAuthConfigs(): Promise<PlatformAuthConfigRow[]> {
  const companies = await prisma.company.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, authConfig: { select: authConfigSelect } },
  });
  return companies.map((company) => ({
    companyId: company.id,
    companyName: company.name,
    authConfig: company.authConfig,
    issuerShapeValid: company.authConfig !== null && isHttpUrl(company.authConfig.issuerUrl),
  }));
}
