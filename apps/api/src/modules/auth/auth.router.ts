import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { register, login } from './auth.service';
import { registerSchema, loginSchema } from './auth.schema';

const router = Router();

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
