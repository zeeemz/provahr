import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('unknown routes', () => {
  it('returns a structured 404', async () => {
    const res = await request(app).get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('request validation', () => {
  it('rejects malformed registration bodies with field details', async () => {
    const res = await request(app).post('/api/auth/register').send({ companyName: 'A' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('rejects malformed login bodies', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects non-object JSON bodies', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('this is not json');
    expect(res.status).toBe(400);
  });
});

describe('authentication', () => {
  it('requires a bearer token on protected routes', async () => {
    const res = await request(app).get('/api/jobs');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects malformed tokens', async () => {
    const res = await request(app).get('/api/jobs').set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('protects application routes too', async () => {
    const res = await request(app).patch('/api/applications/abc/stage').send({ stage: 'OFFER' });
    expect(res.status).toBe(401);
  });
});

describe('public endpoints', () => {
  it('serves the job board without auth', async () => {
    // No database is running in unit tests; an empty query hits Prisma and
    // fails — but only AFTER auth/validation, so we only assert routing here:
    // the request must not be a 404 or 401.
    const res = await request(app).get('/api/public/jobs').query({ roleFamily: 'INVALID' });
    expect(res.status).toBe(400); // invalid enum is a validation error
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('validates application submissions', async () => {
    const res = await request(app).post('/api/public/jobs/some-job/apply').send({ name: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/auth/mode', () => {
  it('reports the install auth mode (boolean-only, public)', async () => {
    const res = await request(app).get('/api/auth/mode');
    expect(res.status).toBe(200);
    expect(['local', 'oidc']).toContain(res.body.mode);
    // V2-3 (D19): perCompany reports whether any company has an enabled
    // Keycloak config. No database in unit tests → the count read fails open
    // to false; only the key set is asserted here.
    expect(Object.keys(res.body).sort()).toEqual(['mode', 'perCompany']);
    expect(typeof res.body.perCompany).toBe('boolean');
  });
});
