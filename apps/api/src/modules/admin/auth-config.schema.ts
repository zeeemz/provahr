import { z } from 'zod';

// PUT /api/admin/auth-config body (V2-3, D19). Trailing slashes are stripped
// at the door for the same reason env.OIDC_ISSUER_URL strips them: Keycloak's
// `iss` claim never has one and jwt.verify compares raw strings — a slash
// would 401 forever (QA wave-1, F5, same fix as env.ts).
export const putAuthConfigSchema = z.object({
  issuerUrl: z
    .string()
    .url()
    .max(500)
    .transform((v) => v.replace(/\/+$/, '')),
  audience: z.string().trim().min(1).max(200),
  enabled: z.boolean().default(false),
});

export type PutAuthConfigInput = z.infer<typeof putAuthConfigSchema>;
