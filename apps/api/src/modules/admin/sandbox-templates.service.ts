import { prisma } from '../../prisma';
import { AppError } from '../../lib/http';
import { CODE_LANGUAGES, type CodeLanguage } from '../../lib/assessment/item';
import { IMAGE_ALLOW_LIST, isSafeImageRef, resolveImage } from '../../lib/sandbox/templates';
import type { PutSandboxTemplateInput } from './sandbox-templates.schema';

// V2-4 (PLAN.md §12 D21): company-scoped sandbox image templates. Every
// function takes the caller's companyId and every query filters on it — the
// compound upsert key (companyId_language) carries companyId, so a PUT can
// never land in another tenant. Routes pass req.user!.companyId!, guaranteed
// non-null because requireRole('ADMIN') never admits the company-less
// SUPER_ADMIN.
//
// Image safety is enforced TWICE at the write boundary: the router's zod
// schema (isSafeImageRef refine) and upsertTemplate's own guard below — zod
// is the API contract, the service guard is the DB-facing invariant, and
// builder.buildRunArgs re-validates at spawn time regardless.

/** The stored-row projection every read path selects (fields views may reveal). */
interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  language: string;
  image: string;
  enabled: boolean;
  updatedAt: Date;
}

const templateSelect = {
  id: true,
  name: true,
  description: true,
  language: true,
  image: true,
  enabled: true,
  updatedAt: true,
} as const;

/** What any endpoint may reveal about a stored template. */
export interface SandboxTemplateView {
  id: string;
  name: string;
  description: string | null;
  language: CodeLanguage;
  image: string;
  enabled: boolean;
  updatedAt: Date;
}

/** One language row of GET /api/admin/sandbox-templates — stored row + resolution. */
export interface SandboxTemplateLanguageRow {
  language: CodeLanguage;
  /** The platform default image for this language (IMAGE_ALLOW_LIST). */
  defaultImage: string;
  /** What a CODE answer of this language ACTUALLY runs today (template or default). */
  activeImage: string;
  /** 'COMPANY' when an enabled safe template overrides, else 'PLATFORM'. */
  activeSource: 'COMPANY' | 'PLATFORM';
  /** The stored template row, null when the company never saved one. */
  template: SandboxTemplateView | null;
}

/** Resolves the active-image info for one stored row (pure, shared with the platform list). */
function languageRow(language: CodeLanguage, template: TemplateRow | null): SandboxTemplateLanguageRow {
  const activeImage = resolveImage(language, template);
  return {
    language,
    defaultImage: IMAGE_ALLOW_LIST[language],
    activeImage,
    activeSource: activeImage === IMAGE_ALLOW_LIST[language] ? 'PLATFORM' : 'COMPANY',
    template:
      template === null
        ? null
        : {
            id: template.id,
            name: template.name,
            description: template.description,
            language,
            image: template.image,
            enabled: template.enabled,
            updatedAt: template.updatedAt,
          },
  };
}

/**
 * GET /api/admin/sandbox-templates — one row per CODE language (always all
 * three, stored or not) with the resolved-active info: which image runs today
 * and whether it comes from this company's template or the platform default.
 */
export async function listCompanyTemplates(companyId: string): Promise<SandboxTemplateLanguageRow[]> {
  const rows = await prisma.sandboxTemplate.findMany({
    where: { companyId },
    select: templateSelect,
    orderBy: { language: 'asc' },
  });
  const byLanguage = new Map(rows.map((row) => [row.language, row]));
  // Unknown-language rows (schema drift) are simply never surfaced: the list
  // is exactly the platform's CODE_LANGUAGES.
  return CODE_LANGUAGES.map((language) => languageRow(language, byLanguage.get(language) ?? null));
}

/**
 * PUT /api/admin/sandbox-templates — upserts the caller's company template for
 * ONE language (the @@unique([companyId, language]) key). The image is
 * re-guarded here (400 SANDBOX_TEMPLATE_UNSAFE) even though zod already
 * refused unsafe refs: this is the last stop before the row reaches the
 * evaluation path.
 */
export async function upsertCompanyTemplate(
  companyId: string,
  userId: string,
  input: PutSandboxTemplateInput,
): Promise<SandboxTemplateLanguageRow> {
  if (!isSafeImageRef(input.image)) {
    // Unreachable through the router (zod refine) — the DB-facing invariant.
    throw new AppError(400, 'Sandbox template image is not a safe docker reference', 'SANDBOX_TEMPLATE_UNSAFE');
  }
  const row = await prisma.sandboxTemplate.upsert({
    where: { companyId_language: { companyId, language: input.language } },
    create: {
      companyId,
      name: input.name,
      description: input.description ?? null,
      language: input.language,
      image: input.image,
      enabled: input.enabled,
      createdBy: userId,
    },
    update: {
      name: input.name,
      description: input.description ?? null,
      image: input.image,
      enabled: input.enabled,
    },
    select: templateSelect,
  });
  return languageRow(input.language, row);
}

// ─── Platform console (read-only, all companies) ──────────────────────────────

/** Row of GET /api/platform/sandbox-templates — one company, every language. */
export interface PlatformSandboxTemplateRow {
  companyId: string;
  companyName: string;
  /** Per-language resolution, same shape as the company list (read-only here). */
  languages: SandboxTemplateLanguageRow[];
  /** True when at least one language resolves to a company template. */
  anyOverride: boolean;
}

/**
 * GET /api/platform/sandbox-templates (super admin): every tenant with its
 * per-language templates and the resolved active images — read-only oversight
 * of which images run on the install. Companies without rows list with null
 * templates (unconfigured, not broken).
 */
export async function listPlatformSandboxTemplates(): Promise<PlatformSandboxTemplateRow[]> {
  const companies = await prisma.company.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      sandboxTemplates: { select: templateSelect, orderBy: { language: 'asc' } },
    },
  });
  return companies.map((company) => {
    const byLanguage = new Map(company.sandboxTemplates.map((row) => [row.language, row]));
    const languages = CODE_LANGUAGES.map((language) => languageRow(language, byLanguage.get(language) ?? null));
    return {
      companyId: company.id,
      companyName: company.name,
      languages,
      anyOverride: languages.some((l) => l.activeSource === 'COMPANY'),
    };
  });
}
