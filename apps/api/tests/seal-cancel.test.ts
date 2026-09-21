// Seal cancellation (founder requirement 2026-09-21): HR can abort an
// in-flight seal from the UI. Covers the route guard, the service state flips
// (PENDING and RUNNING → terminal CANCELLED, crediting the canceller), the
// no-seal 409, company scoping, and the queue guards that keep CANCELLED
// terminal (fail() no-ops; complete() never overwrites). House mock style.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { signToken } from '../src/lib/token';

const {
  userFindUnique,
  jobFindFirst,
  jobQueueFindFirst,
  jobQueueUpdate,
  jobQueueFindUnique,
  jobQueueUpdateMany,
} = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  jobFindFirst: vi.fn(),
  jobQueueFindFirst: vi.fn(),
  jobQueueUpdate: vi.fn(),
  jobQueueFindUnique: vi.fn(),
  jobQueueUpdateMany: vi.fn(),
}));

vi.mock('../src/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    job: { findFirst: jobFindFirst },
    jobQueue: { findFirst: jobQueueFindFirst, findUnique: jobQueueFindUnique, update: jobQueueUpdate, updateMany: jobQueueUpdateMany },
  },
}));

import { createApp } from '../src/app';
import { fail, complete } from '../src/lib/queue';

const app = createApp();
const token = signToken('user-sc-1');
const auth = { Authorization: `Bearer ${token}` };

function prime(role = 'RECRUITER') {
  vi.clearAllMocks();
  userFindUnique.mockResolvedValue({
    id: 'user-sc-1',
    email: 'hr@example.com',
    name: 'Hr Canceller',
    role,
    companyId: 'company-1',
    company: { name: 'Acme' },
  });
  jobFindFirst.mockResolvedValue({ id: 'job-1', companyId: 'company-1' });
  jobQueueUpdate.mockResolvedValue({});
  jobQueueUpdateMany.mockResolvedValue({ count: 1 });
}

describe('POST /api/jobs/:jobId/pool/cancel', () => {
  it('rejects without a token', async () => {
    const res = await request(app).post('/api/jobs/job-1/pool/cancel');
    expect(res.status).toBe(401);
  });

  it('409 NO_SEAL_IN_PROGRESS when nothing is queued or running', async () => {
    prime();
    jobQueueFindFirst.mockResolvedValue(null);
    const res = await request(app).post('/api/jobs/job-1/pool/cancel').set(auth);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_SEAL_IN_PROGRESS');
    expect(jobQueueUpdate).not.toHaveBeenCalled();
  });

  it('404s for another company job (no cross-tenant oracle)', async () => {
    prime();
    jobFindFirst.mockResolvedValue(null);
    const res = await request(app).post('/api/jobs/job-x/pool/cancel').set(auth);
    expect(res.status).toBe(404);
  });

  it('flips a RUNNING seal to terminal CANCELLED, crediting the canceller', async () => {
    prime();
    jobQueueFindFirst.mockResolvedValue({ id: 'seal-1' });
    const res = await request(app).post('/api/jobs/job-1/pool/cancel').set(auth);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cancelled: true });
    const arg = jobQueueUpdate.mock.calls[0][0] as { where: { id: string }; data: { status: string; lastError: string } };
    expect(arg.where.id).toBe('seal-1');
    expect(arg.data.status).toBe('CANCELLED');
    expect(arg.data.lastError).toContain('Hr Canceller');
  });
});

describe('queue guards — CANCELLED is terminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fail() leaves a cancelled row alone (no retry re-queue, no FAILED overwrite)', async () => {
    jobQueueFindUnique.mockResolvedValue({ attempts: 1, maxAttempts: 3, status: 'CANCELLED' });
    await fail('seal-1', new Error('Seal cancelled by HR'));
    expect(jobQueueUpdate).not.toHaveBeenCalled();
  });

  it('complete() never flips a cancelled row to DONE', async () => {
    await complete('seal-1');
    const arg = jobQueueUpdateMany.mock.calls[0][0] as { where: { id: string; status: { not: string } }; data: { status: string } };
    expect(arg.where.id).toBe('seal-1');
    expect(arg.where.status.not).toBe('CANCELLED');
    expect(arg.data.status).toBe('DONE');
  });
});
