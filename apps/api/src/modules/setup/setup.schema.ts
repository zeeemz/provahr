import { z } from 'zod';

/** Body for POST /api/setup/install — bootstraps company + first admin. */
export const installSchema = z.object({
  companyName: z.string().trim().min(2, 'Company name is too short').max(120),
  adminName: z.string().trim().min(2, 'Your name is too short').max(120),
  adminEmail: z.string().trim().toLowerCase().email('Must be a valid email').max(200),
  adminPassword: z.string().min(8, 'Password must be at least 8 characters').max(100),
});

export type InstallInput = z.infer<typeof installSchema>;
