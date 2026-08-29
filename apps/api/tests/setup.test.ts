import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

// No database is reachable in unit tests: these cover routing, validation,
// rate limiting, and the wizard assets — everything that must not need the DB.
// The installed→409 path (prisma company count) is exercised by CI's
// integration tier with a real Postgres service.

describe('GET /setup (wizard page)', () => {
  it('serves the wizard HTML at /setup', async () => {
    const res = await request(app).get('/setup');
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('ProvaHR');
    expect(res.text).toContain('/api/setup/wizard.js');
  });

  it('serves the wizard HTML at /setup/ too', async () => {
    const res = await request(app).get('/setup/');
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
  });

  it('serves the wizard script as same-origin JavaScript', async () => {
    const res = await request(app).get('/api/setup/wizard.js');
    expect(res.status).toBe(200);
    expect(res.type).toBe('application/javascript');
    expect(res.text).toContain("fetch('/api/setup/install'");
  });
});

describe('POST /api/setup/install', () => {
  it('rejects malformed bodies with field details', async () => {
    // Wizard v3 (D18): companyName is gone — the payload is the super admin's
    // name/email/password only.
    const res = await request(app).post('/api/setup/install').send({ adminName: 'A' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toContain('adminName');
    expect(paths).toContain('adminEmail');
  });

  it('enforces the per-IP rate limit (10 per hour) regardless of body validity', async () => {
    // Earlier tests in this file already consumed some hits for this IP;
    // hammer until the limiter trips — it must trip, and with 429.
    let saw429 = false;
    let remaining = 25; // hard stop so a broken limiter fails the test, not the suite
    while (!saw429 && remaining > 0) {
      const res = await request(app).post('/api/setup/install').send({});
      if (res.status === 429) {
        saw429 = true;
        expect(res.body.error.code).toBe('RATE_LIMITED');
      } else {
        expect(res.status).toBe(400); // anything other than 400/429 is a bug
      }
      remaining -= 1;
    }
    expect(saw429).toBe(true);
  });
});

describe('GET /api/setup/status', () => {
  it('exists as a route (fails closed without a database, never 404)', async () => {
    const res = await request(app).get('/api/setup/status');
    // With no DB reachable this is a 500 (same as every other DB-backed
    // endpoint); the assertion that matters is that the route is wired.
    expect(res.status).not.toBe(404);
  });
});
