import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { signToken } from '../src/lib/token';

// Same seam as blueprint-routes.test.ts: the 401/403 paths run before any
// service call, but requireAuth (local mode) still loads the user from the
// database — so the prisma module is mocked with exactly one resolved user per
// role. The feed itself (raw-SQL company scoping) belongs to CI's integration
// tier with a real Postgres.
const recruiter = {
  id: 'user-act-1',
  email: 'activity@example.com',
  name: 'Ada Recruiter',
  role: 'RECRUITER',
  companyId: 'company-1',
  company: { name: 'Acme' },
};

vi.mock('../src/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => recruiter),
    },
  },
}));

import { createApp } from '../src/app';

const app = createApp();
const token = signToken('user-act-1');
const auth = { Authorization: `Bearer ${token}` };

describe('Activity feed — route guards', () => {
  it('rejects GET /api/activity without a token', async () => {
    const res = await request(app).get('/api/activity');
    expect(res.status).toBe(401);
  });

  it('rejects an invalid limit before touching the database', async () => {
    const res = await request(app).get('/api/activity?limit=0').set(auth);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects limit above the 200 cap', async () => {
    const res = await request(app).get('/api/activity?limit=500').set(auth);
    expect(res.status).toBe(400);
  });

  it('admits a recruiter past the role gate (feed errors are DB-tier, not 401/403)', async () => {
    // The mocked prisma has no $queryRaw — the call lands in the error handler
    // with 500, which still proves the route executed past requireAuth +
    // requireRole(RECRUITER).
    const res = await request(app).get('/api/activity').set(auth);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
