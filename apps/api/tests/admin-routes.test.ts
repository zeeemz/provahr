import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { toRedactedProvider } from '../src/modules/admin/llm-providers.service';
import { encryptSecret } from '../src/lib/crypto';

// No database is reachable in unit tests, so these cover the auth gate
// (which runs before any Prisma call) and the pure redaction helper. The
// DB-backed happy paths belong to CI's integration tier.

const app = createApp();

describe('admin llm-providers auth gate', () => {
  it('rejects GET /api/admin/llm-providers without a token', async () => {
    const res = await request(app).get('/api/admin/llm-providers');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects GET /api/admin/llm-providers with a garbage bearer token', async () => {
    const res = await request(app).get('/api/admin/llm-providers').set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects POST /api/admin/llm-providers without a token', async () => {
    const res = await request(app).post('/api/admin/llm-providers').send({
      kind: 'ANTHROPIC',
      apiKey: 'sk-ant-unauth-test',
      textModel: 'claude-sonnet-4-20250514',
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects DELETE /api/admin/llm-providers/:id without a token (and never 404s past the gate)', async () => {
    const res = await request(app).delete('/api/admin/llm-providers/some-id');
    expect(res.status).toBe(401);
  });
});

describe('toRedactedProvider', () => {
  const apiKey = 'sk-ant-redaction-7799';

  const redacted = toRedactedProvider({
    id: 'provider-1',
    kind: 'ANTHROPIC',
    baseUrl: 'https://api.anthropic.com',
    textModel: 'claude-sonnet-4-20250514',
    visionModel: null,
    isActive: true,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    apiKeyEncrypted: encryptSecret(apiKey),
  });

  it('exposes only the last 4 characters of the API key', () => {
    expect(redacted.apiKeyLast4).toBe('7799');
    expect(redacted.apiKeyLast4).toHaveLength(4);
  });

  it('carries no ciphertext or key material anywhere in the object', () => {
    expect(redacted).not.toHaveProperty('apiKeyEncrypted');
    expect(redacted).not.toHaveProperty('apiKey');
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain('apiKeyEncrypted');
  });

  it('passes through the identifying fields unchanged', () => {
    expect(redacted).toMatchObject({
      id: 'provider-1',
      kind: 'ANTHROPIC',
      baseUrl: 'https://api.anthropic.com',
      textModel: 'claude-sonnet-4-20250514',
      visionModel: null,
      isActive: true,
    });
  });
});
