import { describe, it, expect } from 'vitest';
import { usesUnsafeProductionSecrets, DEV_DEFAULT_SECRETS_KEY, env } from '../src/env';

// The env module boots with tests/setup.ts values; these tests cover the
// production-secrets predicate extracted for exactly this purpose (the boot
// wiring — console.error + process.exit — is five straight-line lines on top).

describe('usesUnsafeProductionSecrets', () => {
  it('flags production boots on the public development default', () => {
    expect(usesUnsafeProductionSecrets('production', DEV_DEFAULT_SECRETS_KEY)).toBe(true);
  });

  it('accepts production boots with a real key', () => {
    expect(usesUnsafeProductionSecrets('production', 'a-real-64-char-hex-key-0000000000000000000000000')).toBe(false);
  });

  it('allows the development default outside production', () => {
    expect(usesUnsafeProductionSecrets('development', DEV_DEFAULT_SECRETS_KEY)).toBe(false);
    expect(usesUnsafeProductionSecrets('test', DEV_DEFAULT_SECRETS_KEY)).toBe(false);
  });
});

describe('LLM_TIMEOUT_MS', () => {
  // Live finding 2026-09-20: pool batches against a real provider outlived the
  // old fixed 60s ceiling; the knob defaults to the same 60s so existing
  // installs keep their behavior until they raise it deliberately.
  it('defaults to 60s when unset', () => {
    expect(env.LLM_TIMEOUT_MS).toBe(60_000);
  });
});
