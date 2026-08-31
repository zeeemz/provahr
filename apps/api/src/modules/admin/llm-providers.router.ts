import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { requireAuth, requireRole } from '../../middleware/auth';
import { createProviderSchema, updateProviderSchema } from './llm-providers.schema';
import {
  listProviders,
  createProvider,
  updateProvider,
  activateProvider,
  deleteProvider,
  smokeTest,
} from './llm-providers.service';
import authConfigRouter from './auth-config.router';
import sandboxTemplatesRouter from './sandbox-templates.router';

const router = Router();

// requireRole('ADMIN') never admits the company-less SUPER_ADMIN, so every
// handler below can scope by req.user!.companyId! (V2-2, D20).

/** List the caller's company's configured providers (redacted — no keys, no ciphertext). */
router.get('/llm-providers', requireAuth, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  res.json({ providers: await listProviders(req.user!.companyId!) });
}));

/** Add a provider to the caller's company (admin only). */
router.post('/llm-providers', requireAuth, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const input = createProviderSchema.parse(req.body);
  res.status(201).json({ provider: await createProvider(req.user!.companyId!, input) });
}));

/** Edit a provider of the caller's company (apiKey absent = keep the stored one). */
router.patch('/llm-providers/:id', requireAuth, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const input = updateProviderSchema.parse(req.body);
  res.json({ provider: await updateProvider(req.user!.companyId!, req.params.id, input) });
}));

/** Make this the one active provider of the caller's company (deactivates the
 * company's others atomically; other companies are untouched). */
router.post('/llm-providers/:id/activate', requireAuth, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  res.json({ provider: await activateProvider(req.user!.companyId!, req.params.id) });
}));

/** Live round-trip against the provider with a minimal request. */
router.post('/llm-providers/:id/test', requireAuth, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  res.json(await smokeTest(req.user!.companyId!, req.params.id));
}));

router.delete('/llm-providers/:id', requireAuth, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  await deleteProvider(req.user!.companyId!, req.params.id);
  res.status(204).send();
}));

// V2-3 (D19): the company's Keycloak/OIDC config rides the same /api/admin
// mount (GET/PUT /api/admin/auth-config) — nested here so app.ts keeps a
// single admin router.
router.use(authConfigRouter);

// V2-4 (D21): the company's sandbox image templates ride the same mount
// (GET/PUT /api/admin/sandbox-templates), same nesting rationale.
router.use(sandboxTemplatesRouter);

export default router;
