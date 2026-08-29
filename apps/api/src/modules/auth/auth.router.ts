import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { env } from '../../env';
import { register, login } from './auth.service';
import { registerSchema, loginSchema } from './auth.schema';

const router = Router();

/**
 * Which auth mode this install runs in (D15). Public and boolean-only —
 * clients pick login UX from it; the admin settings page explains it. The
 * mode itself is environment-configured (see docs/RBAC.md), so this is a
 * readout, not a toggle.
 */
router.get('/mode', (_req, res) => {
  res.json({ mode: env.OIDC_ENABLED ? 'oidc' : 'local' });
});

/** Create a company workspace + first admin. */
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const result = await register(input);
    res.status(201).json(result);
  }),
);

/** Exchange email + password for a JWT. */
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const result = await login(input);
    res.json(result);
  }),
);

/** Current user (attached by requireAuth). */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
