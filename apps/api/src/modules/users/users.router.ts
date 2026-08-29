import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { requireAuth, requireRole } from '../../middleware/auth';
import { listCompanyUsers, createCompanyUser } from './users.service';
import { createUserSchema } from './users.schema';

const router = Router();

/** List the users in the caller's company. */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const users = await listCompanyUsers(req.user!);
  res.json({ users });
}));

/** Invite/add a team member (admin only). */
router.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const input = createUserSchema.parse(req.body);
    const user = await createCompanyUser(req.user!, input);
    res.status(201).json({ user });
  }),
);

export default router;
