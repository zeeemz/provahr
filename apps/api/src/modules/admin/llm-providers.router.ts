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

const router = Router();

/** List configured providers (redacted — no keys, no ciphertext). */
router.get('/llm-providers', requireAuth, requireRole('ADMIN'), asyncHandler(async (_req, res) => {
  res.json({ providers: await listProviders() });
}));

/** Add a provider (admin only). */
router.post('/llm-providers', requireAuth, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const input = createProviderSchema.parse(req.body);
  res.status(201).json({ provider: await createProvider(input) });
}));

/** Edit a provider (apiKey absent = keep the stored one). */
router.patch('/llm-providers/:id', requireAuth, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const input = updateProviderSchema.parse(req.body);
  res.json({ provider: await updateProvider(req.params.id, input) });
}));

/** Make this the one active provider (deactivates all others atomically). */
router.post('/llm-providers/:id/activate', requireAuth, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  res.json({ provider: await activateProvider(req.params.id) });
}));

/** Live round-trip against the provider with a minimal request. */
router.post('/llm-providers/:id/test', requireAuth, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  res.json(await smokeTest(req.params.id));
}));

router.delete('/llm-providers/:id', requireAuth, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  await deleteProvider(req.params.id);
  res.status(204).send();
}));

export default router;
