import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { register, login } from './auth.service';
import { registerSchema, loginSchema } from './auth.schema';
import { getAuthMode } from '../platform/settings.service';
import { hasAnyEnabledAuthConfig } from '../admin/auth-config.service';

const router = Router();

/**
 * Which auth mode this install runs in (D15/D19). Public and boolean-only —
 * clients pick login UX from it; the wizard's finish step and the portal
 * settings card read it too. Since V2-1 the mode is DATA: the platform
 * singleton row (PlatformSettings.authMode) wins, with the boot-time env
 * (OIDC_ENABLED) as fallback when no row/value exists. The read degrades to
 * the env fallback rather than 500 — the login page must never hard-fail on
 * it. The super-admin portal switches it via PUT /api/platform/settings.
 *
 * Since V2-3 the response also carries `perCompany`: true when at least one
 * company has an ENABLED Keycloak config (CompanyAuthConfig), i.e. tenant
 * SSO is in play on top of the platform mode. Also fail-open (false).
 */
router.get('/mode', asyncHandler(async (_req, res) => {
  res.json({ mode: await getAuthMode(), perCompany: await hasAnyEnabledAuthConfig() });
}));

/**
 * Bootstrap the PLATFORM super admin (D18) — no company. 409s once a super
 * admin exists; the first-run wizard (POST /api/setup/install) is the
 * guided path over this same service function.
 */
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
