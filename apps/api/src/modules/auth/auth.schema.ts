import { z } from 'zod';

/**
 * POST /api/auth/register — bootstraps the PLATFORM SUPER ADMIN (PLAN.md §12
 * D18: no company; tenants are created from the super-admin console). The
 * setup lock is "a SUPER_ADMIN exists": once one does, this 409s and the
 * first-run wizard (which delegates here) stays locked.
 */
export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Your name is too short').max(120),
  email: z.string().trim().toLowerCase().email('Must be a valid email').max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Must be a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
