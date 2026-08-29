import { z } from 'zod';

/**
 * POST /api/setup/install — bootstraps the PLATFORM SUPER ADMIN (wizard v3,
 * PLAN.md §12 D18). No companyName: tenants are created from the super-admin
 * console after install, not during setup.
 */
export const installSchema = z.object({
  adminName: z.string().trim().min(2, 'Your name is too short').max(120),
  adminEmail: z.string().trim().toLowerCase().email('Must be a valid email').max(200),
  adminPassword: z.string().min(8, 'Password must be at least 8 characters').max(100),
});

export type InstallInput = z.infer<typeof installSchema>;
