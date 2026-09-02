import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { signToken } from '../src/lib/token';

// Same seam as platform-routes.test.ts / jd-routes.test.ts: no database is
// reachable in unit tests, but requireAuth (local mode) loads the user from
// the database — so prisma is mocked and the mocked user's ROLE is flipped
// between suites to prove the gates: the MAIN prompt is READABLE by any
// authenticated user (founder visibility requirement) but EDITABLE only by
// SUPER_ADMIN; the job prompt is company-scoped and ADMIN/RECRUITER-editable.
vi.mock('../src/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    job: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    platformSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { prisma } from '../src/prisma';
import { resetAuthModeCacheForTests, resetMainPromptCacheForTests } from '../src/modules/platform/settings.service';
import { createApp } from '../src/app';

const app = createApp();
const token = signToken('user-prompt-1');
const auth = { Authorization: `Bearer ${token}` };

// Same id, different roles: each gate must hinge ONLY on the role / company.
const recruiterUser = {
  id: 'user-prompt-1',
  email: 'rae@acme.test',
  name: 'Rae Recruiter',
  role: 'RECRUITER',
  companyId: 'company-1',
  company: { name: 'Acme' },
};
const interviewerUser = {
  id: 'user-prompt-1',
  email: 'ivy@acme.test',
  name: 'Ivy Interviewer',
  role: 'INTERVIEWER',
  companyId: 'company-1',
  company: { name: 'Acme' },
};
const superAdminUser = {
  id: 'user-prompt-1',
  email: 'root@provahr.test',
  name: 'Sam Super',
  role: 'SUPER_ADMIN',
  companyId: null, // platform-level (D18): super admins own no company
  company: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthModeCacheForTests();
  resetMainPromptCacheForTests();
  // Local mode + no stored main prompt unless a test primes otherwise.
  vi.mocked(prisma.platformSettings.findUnique).mockResolvedValue(null as never);
});

// ─── GET /api/platform/prompts/main — readable by EVERY authenticated user ────

describe('GET /api/platform/prompts/main', () => {
  it('rejects an anonymous request (401)', async () => {
    const res = await request(app).get('/api/platform/prompts/main');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns the stored main prompt for a company RECRUITER (visibility requirement)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(recruiterUser as never);
    vi.mocked(prisma.platformSettings.findUnique).mockResolvedValue({ mainPrompt: 'Be concise.' } as never);

    const res = await request(app).get('/api/platform/prompts/main').set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mainPrompt: 'Be concise.' });
  });

  it('returns an empty string (not an error) when no row exists yet', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(superAdminUser as never);
    const res = await request(app).get('/api/platform/prompts/main').set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mainPrompt: '' });
  });
});

// ─── PUT /api/platform/prompts/main — super admin ONLY ────────────────────────

describe('PUT /api/platform/prompts/main', () => {
  it('rejects an anonymous request (401)', async () => {
    const res = await request(app).put('/api/platform/prompts/main').send({ mainPrompt: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a company RECRUITER (403) and never writes', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(recruiterUser as never);
    const res = await request(app).put('/api/platform/prompts/main').set(auth).send({ mainPrompt: 'nope' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(prisma.platformSettings.upsert).not.toHaveBeenCalled();
  });

  it('upserts the singleton row for the SUPER_ADMIN and returns the new prompt', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(superAdminUser as never);
    vi.mocked(prisma.platformSettings.upsert).mockResolvedValue({
      authMode: 'local',
      mainPrompt: 'Always mention the mission.',
    } as never);

    const res = await request(app)
      .put('/api/platform/prompts/main')
      .set(auth)
      .send({ mainPrompt: 'Always mention the mission.' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mainPrompt: 'Always mention the mission.' });
    expect(prisma.platformSettings.upsert).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      create: { id: 'singleton', mainPrompt: 'Always mention the mission.' },
      update: { mainPrompt: 'Always mention the mission.' },
      select: { authMode: true, mainPrompt: true },
    });
  });

  it('rejects a prompt over 8000 chars (400 VALIDATION_ERROR)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(superAdminUser as never);
    const res = await request(app)
      .put('/api/platform/prompts/main')
      .set(auth)
      .send({ mainPrompt: 'x'.repeat(8001) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.platformSettings.upsert).not.toHaveBeenCalled();
  });
});

// ─── GET /api/jobs/:jobId/prompt — company-scoped read of both tiers ─────────

describe('GET /api/jobs/:jobId/prompt', () => {
  it('rejects an anonymous request (401)', async () => {
    const res = await request(app).get('/api/jobs/job-1/prompt');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('scopes by the caller company: another tenant job is a uniform 404', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(recruiterUser as never);
    vi.mocked(prisma.job.findFirst).mockResolvedValue(null as never);

    const res = await request(app).get('/api/jobs/job-9/prompt').set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(prisma.job.findFirst).toHaveBeenCalledWith({
      where: { id: 'job-9', companyId: 'company-1' },
    });
  });

  it('returns the job prompt plus the platform main prompt for display', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(recruiterUser as never);
    vi.mocked(prisma.job.findFirst).mockResolvedValue({ id: 'job-1', jobPrompt: 'Emphasize payments.' } as never);
    vi.mocked(prisma.platformSettings.findUnique).mockResolvedValue({ mainPrompt: 'Be concise.' } as never);

    const res = await request(app).get('/api/jobs/job-1/prompt').set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobPrompt: 'Emphasize payments.', mainPrompt: 'Be concise.' });
  });

  it('admits an INTERVIEWER (read-only visibility of both tiers)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(interviewerUser as never);
    vi.mocked(prisma.job.findFirst).mockResolvedValue({ id: 'job-1', jobPrompt: null } as never);

    const res = await request(app).get('/api/jobs/job-1/prompt').set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobPrompt: null, mainPrompt: '' });
  });
});

// ─── PUT /api/jobs/:jobId/prompt — ADMIN/RECRUITER, company-scoped ────────────

describe('PUT /api/jobs/:jobId/prompt', () => {
  it('rejects an anonymous request (401)', async () => {
    const res = await request(app).put('/api/jobs/job-1/prompt').send({ jobPrompt: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects an INTERVIEWER (403) and never writes', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(interviewerUser as never);
    const res = await request(app).put('/api/jobs/job-1/prompt').set(auth).send({ jobPrompt: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it('is company-scoped: another tenant job is a uniform 404', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(recruiterUser as never);
    vi.mocked(prisma.job.findFirst).mockResolvedValue(null as never);

    const res = await request(app).put('/api/jobs/job-9/prompt').set(auth).send({ jobPrompt: 'x' });
    expect(res.status).toBe(404);
    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it('saves the role-specific prompt for a RECRUITER of the owning company', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(recruiterUser as never);
    vi.mocked(prisma.job.findFirst).mockResolvedValue({ id: 'job-1', companyId: 'company-1' } as never);
    vi.mocked(prisma.job.update).mockResolvedValue({ id: 'job-1', jobPrompt: 'Tone: pragmatic.' } as never);

    const res = await request(app).put('/api/jobs/job-1/prompt').set(auth).send({ jobPrompt: 'Tone: pragmatic.' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobPrompt: 'Tone: pragmatic.' });
    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { jobPrompt: 'Tone: pragmatic.' },
      select: { id: true, jobPrompt: true },
    });
  });

  it('null clears the overlay (jobPrompt set to null, not empty string)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(recruiterUser as never);
    vi.mocked(prisma.job.findFirst).mockResolvedValue({ id: 'job-1', companyId: 'company-1' } as never);
    vi.mocked(prisma.job.update).mockResolvedValue({ id: 'job-1', jobPrompt: null } as never);

    const res = await request(app).put('/api/jobs/job-1/prompt').set(auth).send({ jobPrompt: null });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobPrompt: null });
    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { jobPrompt: null },
      select: { id: true, jobPrompt: true },
    });
  });

  it('rejects a prompt over 8000 chars (400 VALIDATION_ERROR)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(recruiterUser as never);
    const res = await request(app)
      .put('/api/jobs/job-1/prompt')
      .set(auth)
      .send({ jobPrompt: 'x'.repeat(8001) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it('rejects a non-string, non-null jobPrompt (400 VALIDATION_ERROR)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(recruiterUser as never);
    const res = await request(app).put('/api/jobs/job-1/prompt').set(auth).send({ jobPrompt: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
