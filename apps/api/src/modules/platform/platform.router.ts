import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { requireSuperAdmin } from './platform.middleware';
import { listCompanies, createCompany, patchCompany, deleteCompany } from './companies.service';
import { getPlatformSettings, putPlatformSettings } from './settings.service';
import { createCompanySchema, patchCompanySchema, putPlatformSettingsSchema } from './platform.schema';
import { listPlatformAuthConfigs } from '../admin/auth-config.service';
import { listPlatformSandboxTemplates } from '../admin/sandbox-templates.service';
import promptsRouter from './prompts.router';

// Platform console API (PLAN.md §12 D18/D19) — mounted at /api/platform.
// Every route is requireAuth + requireSuperAdmin: the platform super admin
// (companyId null) manages TENANTS here; company-scoped routes elsewhere stay
// company-scoped and never admit this role.
//
// ONE exception: the nested /prompts router (two-tier system prompts, founder
// requirement). Its GET is deliberately ANY authenticated user — company
// users must be able to READ the main prompt they see in their job console;
// only its PUT is super-admin. See prompts.router.ts.

const router = Router();

/** List tenants with user counts. */
router.get('/companies', requireAuth, requireSuperAdmin, asyncHandler(async (_req, res) => {
  const companies = await listCompanies();
  res.json({ companies });
}));

/** Create a tenant — optionally with its first ADMIN (the company wizard). */
router.post(
  '/companies',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const input = createCompanySchema.parse(req.body);
    const result = await createCompany(input);
    res.status(201).json(result);
  }),
);

/** Rename / re-website a tenant. */
router.patch(
  '/companies/:id',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const input = patchCompanySchema.parse(req.body);
    const company = await patchCompany(req.params.id, input);
    res.json({ company });
  }),
);

/** Delete a tenant (cascades its users, jobs and downstream data). */
router.delete(
  '/companies/:id',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    await deleteCompany(req.params.id);
    res.status(204).send();
  }),
);

/** Platform settings — the runtime auth-mode readout (D19). */
router.get('/settings', requireAuth, requireSuperAdmin, asyncHandler(async (_req, res) => {
  const settings = await getPlatformSettings();
  res.json(settings);
}));

/** The auth-mode switch. Validates 'local' | 'oidc'; upserts the singleton row. */
router.put(
  '/settings',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const input = putPlatformSettingsSchema.parse(req.body);
    const settings = await putPlatformSettings(input);
    res.json(settings);
  }),
);

/** Every company's Keycloak/OIDC config, read-only, with a validity hint (V2-3, D19). */
router.get('/auth-configs', requireAuth, requireSuperAdmin, asyncHandler(async (_req, res) => {
  res.json({ configs: await listPlatformAuthConfigs() });
}));

/** Every company's sandbox image templates, read-only, with resolution info (V2-4, D21). */
router.get('/sandbox-templates', requireAuth, requireSuperAdmin, asyncHandler(async (_req, res) => {
  res.json({ companies: await listPlatformSandboxTemplates() });
}));

// Two-tier system prompts (founder requirement): the MAIN prompt routes ride
// the same /api/platform mount (GET/PUT /api/platform/prompts/main) — nested
// here, auth-config.router.ts pattern, so app.ts stays untouched.
router.use('/prompts', promptsRouter);

export default router;
