import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { requireAuth, requireRole } from '../../middleware/auth';
import { putSandboxTemplateSchema } from './sandbox-templates.schema';
import { listCompanyTemplates, upsertCompanyTemplate } from './sandbox-templates.service';

const router = Router();

// V2-4 (PLAN.md §12 D21): the company's sandbox image templates, managed in
// the portal. requireRole('ADMIN') never admits the company-less SUPER_ADMIN,
// so both handlers scope by req.user!.companyId! — the same seam as
// llm-providers and auth-config. One template per language per company: GET/PUT
// on the collection with the language in the PUT body (the compound key's
// other half is the company), no DELETE — enabled=false is the off-switch,
// which keeps a re-enable one PUT away.

/** The caller's company's templates, one row per language with resolution info. */
router.get('/sandbox-templates', requireAuth, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  res.json({ templates: await listCompanyTemplates(req.user!.companyId!) });
}));

/** Save/replace the caller's company template for ONE language (upsert). */
router.put('/sandbox-templates', requireAuth, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const input = putSandboxTemplateSchema.parse(req.body);
  res.json({
    template: await upsertCompanyTemplate(req.user!.companyId!, req.user!.id, input),
  });
}));

export default router;
