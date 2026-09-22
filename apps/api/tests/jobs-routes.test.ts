// Draft-role deletion (founder requirement 2026-09-21): a draft JD created by
// mistake or abandoned used to be undeletable. Covers the DRAFT-only guard
// (a published role carries the audit trail — close, never delete), the
// cancel-in-flight contract (queue rows flip to terminal CANCELLED BEFORE the
// cascade delete, crediting the deleter), company scoping and role checks.
// House mock style (see seal-cancel.test.ts).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { signToken } from '../src/lib/token';

const { userFindUnique, jobFindFirst, jobQueueUpdateMany, jobDelete } = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  jobFindFirst: vi.fn(),
  jobQueueUpdateMany: vi.fn(),
  jobDelete: vi.fn(),
}));

vi.mock('../src/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    job: { findFirst: jobFindFirst, delete: jobDelete },
    jobQueue: { updateMany: jobQueueUpdateMany },
  },
}));

import { createApp } from '../src/app';

const app = createApp();
const token = signToken('user-dj-1');
const auth = { Authorization: `Bearer ${token}` };

function prime(role = 'RECRUITER', job = { id: 'job-1', companyId: 'company-1', status: 'DRAFT' }) {
  vi.clearAllMocks();
  userFindUnique.mockResolvedValue({
    id: 'user-dj-1',
    email: 'hr@example.com',
    name: 'Hr Deleter',
    role,
    companyId: 'company-1',
    company: { name: 'Acme' },
  });
  jobFindFirst.mockResolvedValue(job);
  jobQueueUpdateMany.mockResolvedValue({ count: 0 });
  jobDelete.mockResolvedValue({ id: 'job-1' });
}

describe('DELETE /api/jobs/:jobId', () => {
  it('rejects without a token', async () => {
    const res = await request(app).delete('/api/jobs/job-1');
    expect(res.status).toBe(401);
  });

  it('rejects a viewer', async () => {
    prime('VIEWER');
    const res = await request(app).delete('/api/jobs/job-1').set(auth);
    expect(res.status).toBe(403);
    expect(jobDelete).not.toHaveBeenCalled();
  });

  it('404s for another company job (no cross-tenant oracle)', async () => {
    prime();
    jobFindFirst.mockResolvedValue(null);
    const res = await request(app).delete('/api/jobs/job-x').set(auth);
    expect(res.status).toBe(404);
    expect(jobDelete).not.toHaveBeenCalled();
  });

  it('409 JOB_NOT_DRAFT once the role has been published', async () => {
    prime('RECRUITER', { id: 'job-1', companyId: 'company-1', status: 'OPEN' });
    const res = await request(app).delete('/api/jobs/job-1').set(auth);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('JOB_NOT_DRAFT');
    expect(jobQueueUpdateMany).not.toHaveBeenCalled();
    expect(jobDelete).not.toHaveBeenCalled();
  });

  it('deletes a draft: cancels in-flight queue rows first, then cascades', async () => {
    prime();
    const res = await request(app).delete('/api/jobs/job-1').set(auth);

    expect(res.status).toBe(204);
    const cancel = jobQueueUpdateMany.mock.calls[0][0] as {
      where: { status: { in: string[] }; payload: { path: string[]; equals: string } };
      data: { status: string; lastError: string };
    };
    expect(cancel.where.status.in).toEqual(['PENDING', 'RUNNING']);
    expect(cancel.where.payload.path).toEqual(['jobId']);
    expect(cancel.where.payload.equals).toBe('job-1');
    expect(cancel.data.status).toBe('CANCELLED');
    expect(cancel.data.lastError).toContain('Hr Deleter');
    expect(jobDelete).toHaveBeenCalledWith({ where: { id: 'job-1' } });
    // Order matters for the mid-seal race: the rows are terminal before the
    // job disappears from under a running handler.
    expect(jobQueueUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(
      jobDelete.mock.invocationCallOrder[0],
    );
  });

  it('admin can delete as well (both authoring roles)', async () => {
    prime('ADMIN');
    const res = await request(app).delete('/api/jobs/job-1').set(auth);
    expect(res.status).toBe(204);
  });
});
