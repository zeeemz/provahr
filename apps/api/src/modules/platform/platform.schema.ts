import { z } from 'zod';

/** POST /api/platform/companies — create a tenant, optionally with its first ADMIN. */
export const createCompanySchema = z.object({
  name: z.string().trim().min(2, 'Company name is too short').max(120),
  website: z.string().trim().url('Must be a valid URL').max(500).optional(),
  // The "company wizard" (D18): when present, the company's first ADMIN is
  // created in the same transaction — name/email/password mirror POST /api/users.
  firstAdmin: z
    .object({
      name: z.string().trim().min(2, 'Name is too short').max(120),
      email: z.string().trim().toLowerCase().email('Must be a valid email').max(200),
      password: z.string().min(8, 'Password must be at least 8 characters').max(100),
    })
    .optional(),
});

/** PATCH /api/platform/companies/:id — rename (and/or re-website) a tenant. */
export const patchCompanySchema = z.object({
  name: z.string().trim().min(2, 'Company name is too short').max(120).optional(),
  website: z.string().trim().url('Must be a valid URL').max(500).nullable().optional(),
});

/** PUT /api/platform/settings — the runtime auth-mode switch (D19). */
export const putPlatformSettingsSchema = z.object({
  authMode: z.enum(['local', 'oidc'], {
    errorMap: () => ({ message: 'authMode must be "local" or "oidc"' }),
  }),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type PatchCompanyInput = z.infer<typeof patchCompanySchema>;
export type PutPlatformSettingsInput = z.infer<typeof putPlatformSettingsSchema>;
