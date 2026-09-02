import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { signToken } from '../src/lib/token';
import { putBlueprintSchema } from '../src/modules/jobs/blueprint.schema';
import { buildItemsUserPrompt } from '../src/prompts/pool';
import type { BlueprintSection } from '../src/lib/assessment/item';

// Same seam as jd-routes.test.ts: the 401/400 paths here run before any
// service call, but requireAuth (local mode) still loads the user from the
// database — so the prisma module is mocked with exactly one resolved
// recruiter. The DB-backed flows (blueprint upsert, samples/seal queueing,
// pool sealing, 404/409 branches, worker generation) belong to CI's
// integration tier with a real Postgres, like admin-routes.test.ts.
vi.mock('../src/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({
        id: 'user-bp-1',
        email: 'blueprint@example.com',
        name: 'Bee Recruiter',
        role: 'RECRUITER',
        companyId: 'company-1',
        company: { name: 'Acme' },
      })),
    },
  },
}));

import { createApp } from '../src/app';

const app = createApp();
const token = signToken('user-bp-1');
const auth = { Authorization: `Bearer ${token}` };

const validBlueprint = {
  sections: [
    { title: 'Core payments', topics: ['payments', 'api-design'], formats: { MCQ: 4, CODE: 1 }, difficultyMix: 'BALANCED' },
    { topics: ['sql'], formats: { WRITTEN: 2 } },
  ],
  timeLimitMin: 45,
};

describe('Blueprint & pool routes — auth gate (no token → 401)', () => {
  it('rejects PUT /api/jobs/:id/blueprint', async () => {
    const res = await request(app).put('/api/jobs/job-1/blueprint').send(validBlueprint);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects GET /api/jobs/:id/blueprint', async () => {
    const res = await request(app).get('/api/jobs/job-1/blueprint');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects POST /api/jobs/:id/blueprint/samples', async () => {
    const res = await request(app).post('/api/jobs/job-1/blueprint/samples');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects GET /api/jobs/:id/blueprint/samples', async () => {
    const res = await request(app).get('/api/jobs/job-1/blueprint/samples');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects POST /api/jobs/:id/pool/seal', async () => {
    const res = await request(app).post('/api/jobs/job-1/pool/seal');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects POST /api/jobs/:id/pool/reseal', async () => {
    const res = await request(app).post('/api/jobs/job-1/pool/reseal');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects GET /api/jobs/:id/pool', async () => {
    const res = await request(app).get('/api/jobs/job-1/pool');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('PUT /api/jobs/:id/blueprint — validation (invalid body → 400 VALIDATION_ERROR)', () => {
  it('rejects a body missing sections and timeLimitMin', async () => {
    const res = await request(app).put('/api/jobs/job-1/blueprint').set(auth).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an empty sections array', async () => {
    const res = await request(app).put('/api/jobs/job-1/blueprint').set(auth).send({ ...validBlueprint, sections: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects more than 6 sections', async () => {
    const sections = Array.from({ length: 7 }, () => ({ topics: ['sql'], formats: { MCQ: 1 } }));
    const res = await request(app).put('/api/jobs/job-1/blueprint').set(auth).send({ ...validBlueprint, sections });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a section with no formats', async () => {
    const res = await request(app)
      .put('/api/jobs/job-1/blueprint')
      .set(auth)
      .send({ ...validBlueprint, sections: [{ topics: ['sql'], formats: {} }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a section with a zero format count', async () => {
    const res = await request(app)
      .put('/api/jobs/job-1/blueprint')
      .set(auth)
      .send({ ...validBlueprint, sections: [{ topics: ['sql'], formats: { MCQ: 0 } }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a section with no topics', async () => {
    const res = await request(app)
      .put('/api/jobs/job-1/blueprint')
      .set(auth)
      .send({ ...validBlueprint, sections: [{ topics: [], formats: { MCQ: 2 } }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects timeLimitMin below 10, above 180, or non-integer', async () => {
    for (const timeLimitMin of [9, 181, 45.5]) {
      const res = await request(app).put('/api/jobs/job-1/blueprint').set(auth).send({ ...validBlueprint, timeLimitMin });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('putBlueprintSchema — unit', () => {
  it('accepts the boundary time limits 10 and 180 and returns parsed sections', () => {
    for (const timeLimitMin of [10, 180]) {
      const parsed = putBlueprintSchema.safeParse({ ...validBlueprint, timeLimitMin });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.sections).toHaveLength(2);
        expect(parsed.data.timeLimitMin).toBe(timeLimitMin);
      }
    }
  });
});

describe('buildItemsUserPrompt — unit', () => {
  const section: BlueprintSection = {
    title: 'Core payments',
    topics: ['payments', 'api-design'],
    formats: { CODE: 7 },
    difficultyMix: 'BALANCED',
  };

  it('grounds the batch in the JD, the section topics, and the exact count', () => {
    const prompt = buildItemsUserPrompt({
      jdTitle: 'Senior Payments Engineer',
      jdDescription: 'We build payment rails in TypeScript.',
      section,
      count: 7,
    });
    expect(prompt).toContain('=== JOB DESCRIPTION START ===');
    expect(prompt).toContain('=== JOB DESCRIPTION END ===');
    expect(prompt).toContain('Senior Payments Engineer');
    expect(prompt).toContain('We build payment rails in TypeScript.');
    expect(prompt).toContain('payments, api-design');
    expect(prompt).toContain('- CODE: 7 item(s)');
    expect(prompt).toContain('EXACTLY 7');
    expect(prompt).toContain('Difficulty mix: BALANCED');
    expect(prompt).toContain('{"items":[...]}');
  });

  it('omits formats the batch does not ask for and the difficulty line when unset', () => {
    const prompt = buildItemsUserPrompt({
      jdTitle: 'Role',
      jdDescription: 'Desc',
      section: { topics: ['sql'], formats: { MCQ: 3 } },
      count: 3,
    });
    expect(prompt).toContain('- MCQ: 3 item(s)');
    expect(prompt).not.toContain('CODE:');
    expect(prompt).not.toContain('Difficulty mix');
  });

  it('keeps an oversized JD description bounded', () => {
    const prompt = buildItemsUserPrompt({
      jdTitle: 'Role',
      jdDescription: 'x'.repeat(50_000),
      section: { topics: ['sql'], formats: { MCQ: 1 } },
      count: 1,
    });
    expect(prompt.length).toBeLessThan(20_000);
    expect(prompt).not.toContain('(empty job description)');
  });
});
