import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { requireSuperAdmin } from './platform.middleware';
import { listCompanies, createCompany, patchCompany, deleteCompany } from './companies.service';
import { getPlatformSettings, putPlatformSettings } from './settings.service';
import { createCompanySchema, patchCompanySchema, putPlatformSettingsSchema } from './platform.schema';

// Platform console API (PLAN.md §12 D18/D19) — mounted at /api/platform.
// Every route is requireAuth + requireSuperAdmin: the platform super admin
// (companyId null) manages TENANTS here; company-scoped routes elsewhere stay
// company-scoped and never admit this role.

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

export default router;
