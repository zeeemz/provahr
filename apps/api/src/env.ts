import { z } from 'zod';

// z.coerce.boolean() treats any non-empty string (including "false") as true,
// so booleans from the environment are parsed explicitly instead.
const boolString = z.enum(['true', 'false']).transform((v) => v === 'true');

export const DEV_DEFAULT_SECRETS_KEY = 'dev-only-secrets-key-change-me';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  OIDC_ENABLED: boolString.default('false'),
  // Trailing slashes are stripped at the door: Keycloak's `iss` claim never
  // has one, and jwt.verify compares raw strings — a slash would 401 forever
  // (QA wave-1, F5).
  OIDC_ISSUER_URL: z
    .string()
    .url()
    .transform((v) => v.replace(/\/+$/, ''))
    .default('http://localhost:8081/realms/provahr'),
  OIDC_AUDIENCE: z.string().min(1).default('provahr-api'),
  // Encrypts LLM provider API keys at rest (AES-256-GCM) — see docs/SELF_HOSTING.md.
  SECRETS_KEY: z.string().min(16, 'SECRETS_KEY must be at least 16 characters').default(DEV_DEFAULT_SECRETS_KEY),
  // How long the background worker sleeps when the queue is empty (ms).
  WORKER_POLL_MS: z.coerce.number().int().min(250).default(2000),
});

/**
 * True when a production boot would encrypt provider API keys under the
 * public development default — i.e. any database read yields plaintext keys.
 * Extracted as a pure predicate so it is unit-testable (QA wave-2, F2).
 */
export function usesUnsafeProductionSecrets(nodeEnv: string, secretsKey: string): boolean {
  return nodeEnv === 'production' && secretsKey === DEV_DEFAULT_SECRETS_KEY;
}

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  process.exit(1);
}

if (usesUnsafeProductionSecrets(parsed.data.NODE_ENV, parsed.data.SECRETS_KEY)) {
  console.error('Refusing to start: SECRETS_KEY is the public development default while NODE_ENV=production.');
  console.error('Provider API keys would be encrypted with a value printed in the repository.');
  console.error('Generate a real one with:');
  console.error('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

export const env = parsed.data;
