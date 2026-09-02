import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { dashboard } from './stats.service';

const router = Router();

/** Dashboard aggregates for the caller's company. */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const stats = await dashboard(req.user!);
  res.json(stats);
}));

export default router;
