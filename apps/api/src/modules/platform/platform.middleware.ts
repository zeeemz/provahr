import type { RequestHandler } from 'express';
import { AppError } from '../../lib/http';

/**
 * Restricts a route to the platform SUPER_ADMIN (PLAN.md §12 D18). Use after
 * `requireAuth`. Deliberately separate from `requireRole`: company-scoped
 * routes keep admitting only ADMIN/RECRUITER/INTERVIEWER, so a super admin
 * without a company never reaches a company-scoped service (those services
 * would have no `companyId` to scope by).
 */
export const requireSuperAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    next(new AppError(401, 'Authentication required', 'UNAUTHENTICATED'));
    return;
  }
  if (req.user.role !== 'SUPER_ADMIN') {
    next(new AppError(403, 'Platform access requires the super admin role', 'FORBIDDEN'));
    return;
  }
  next();
};
