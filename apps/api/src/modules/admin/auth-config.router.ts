import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { requireAuth, requireRole } from '../../middleware/auth';
import { putAuthConfigSchema } from './auth-config.schema';
import { getCompanyAuthConfig, putCompanyAuthConfig } from './auth-config.service';

const router = Router();

// V2-3 (PLAN.md §12 D19): the company's own Keycloak/OIDC verifier, managed
// in the portal. requireRole('ADMIN') never admits the company-less
// SUPER_ADMIN, so both handlers can scope by req.user!.companyId! — the same
// seam as llm-providers. There is exactly one config per company: GET/PUT on
// the collection, no :id routes and no DELETE (enabled=false is the off-switch,
// which keeps a re-enable one PUT away).

/** The caller's company's Keycloak config (null when never saved). */
router.get('/auth-config', requireAuth, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  res.json({ authConfig: await getCompanyAuthConfig(req.user!.companyId!) });
}));

/** Save/replace the caller's company's Keycloak config. */
router.put('/auth-config', requireAuth, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const input = putAuthConfigSchema.parse(req.body);
  res.json({ authConfig: await putCompanyAuthConfig(req.user!.companyId!, input) });
}));

export default router;
