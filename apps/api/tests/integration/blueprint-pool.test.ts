// T2/T3 INTEGRATION TIER — sealed-pool invisibility matrix (QA wave-4 F1).
//
// Runs ONLY when INTEGRATION_DB=1 AND the database is reachable (CI provides
// a throwaway Postgres service; local runs skip silently). These tests write
// real rows: they create their own company/job/blueprint/pool and delete the
// company at the end (cascade). NEVER point them at production data.
//
// The property under test is never-regress #2 (docs/TESTING.md §6): no
// endpoint, for any role, may emit pool item content or the encrypted blob.

import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../../src/app';
import { encryptSecret } from '../../src/lib/crypto';

const POOL_CANARY = 'POOL-CANARY-ITEM-TEXT';
const SAMPLE_CANARY = 'SAMPLE-CANARY-ITEM-TEXT';

// Sync gate for skipIf; the actual connectivity check happens in beforeAll
// and FAILS LOUDLY when the flag is set but the DB is unreachable — a CI run
// must never silently skip this suite.
const enabled = process.env.INTEGRATION_DB === '1';

describe.skipIf(!enabled)('sealed-pool invisibility matrix (T2/T3)', () => {
  const prisma = new PrismaClient();
  const app = createApp();
  let token = '';
  let companyId = '';
  let jobId = '';

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      throw new Error(`INTEGRATION_DB=1 but the test database is unreachable: ${String(err)}`);
    }
    // Fresh company + admin via the public register path (single-company
    // invariant means this install is now "configured").
    const reg = await request(app)
      .post('/api/auth/register')
      .send({
        companyName: `Leak Matrix Test ${Date.now()}`,
        name: 'Leak Matrix Admin',
        email: `leakmatrix+${Date.now()}@provahr.test`,
        password: 'password123',
      });
    expect(reg.status).toBe(201);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: reg.body.user.email, password: 'password123' });
    token = login.body.token;
    companyId = login.body.user.companyId ?? '';
    expect(token).toBeTruthy();

    // Approved-JD job + blueprint + an ACTIVE sealed pool with a canary item.
    const job = await prisma.job.create({
      data: {
        companyId,
        title: 'Leak Matrix Role',
        department: 'QA',
        roleFamily: 'ENGINEERING',
        location: 'Remote',
        description: 'A role that exists only to prove pools stay sealed.'.padEnd(60, '.'),
        status: 'DRAFT',
        jdStatus: 'JD_APPROVED',
      },
    });
    jobId = job.id;
    const blueprint = await prisma.testBlueprint.create({
      data: {
        jobId,
        sections: [{ topics: ['bash'], formats: { MCQ: 1 } }],
        timeLimitMin: 30,
      },
    });
    await prisma.sealedQuestionPool.create({
      data: {
        jobId,
        blueprintId: blueprint.id,
        blueprintVersion: blueprint.version,
        itemsEncrypted: encryptSecret(
          JSON.stringify([{ id: 'canary', format: 'MCQ', prompt: POOL_CANARY, options: [], correctOptionId: 'a' }]),
        ),
        itemCount: 1,
        isActive: true,
      },
    });
    await prisma.sampleItem.create({
      data: { jobId, item: { id: 'sample', format: 'MCQ', prompt: SAMPLE_CANARY } },
    });
  });

  afterAll(async () => {
    // Company cascade removes job → blueprint → pool → samples.
    if (companyId) await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  const auth = { Authorization: `Bearer ${token}` };

  // The matrix: every blueprint/pool route, for the admin role (recruiter has
  // identical access; anonymous is 401 and covered in the unit tier).
  const routes: Array<[string, string, string]> = [
    ['PUT', '/api/jobs/%ID/blueprint', JSON.stringify({ sections: [{ topics: ['x'], formats: { MCQ: 1 } }], timeLimitMin: 30 })],
    ['GET', '/api/jobs/%ID/blueprint', ''],
    ['POST', '/api/jobs/%ID/blueprint/samples', '{}'],
    ['GET', '/api/jobs/%ID/blueprint/samples', ''],
    ['POST', '/api/jobs/%ID/pool/seal', '{}'],
    ['POST', '/api/jobs/%ID/pool/reseal', '{}'],
    ['GET', '/api/jobs/%ID/pool', ''],
  ];

  describe.each(routes)('%s %s', (method, pathTpl, body) => {
    const path = () => pathTpl.replace('%ID', jobId);

    it('never emits pool item content or the encrypted blob', async () => {
      const res = await request(app)
        [method.toLowerCase() as 'get' | 'put' | 'post'](path())
        .set(auth)
        .set('Content-Type', 'application/json')
        .send(body === '' ? undefined : body);
      const serialized = JSON.stringify(res.body ?? {});
      expect(serialized).not.toContain(POOL_CANARY);
      expect(serialized).not.toContain('itemsEncrypted');
      expect(serialized).not.toContain('POOL-CANARY');
    });

    it('obeys the state machine (pool sealed ⇒ no destructive route proceeds)', async () => {
      const res = await request(app)
        [method.toLowerCase() as 'get' | 'put' | 'post'](path())
        .set(auth)
        .set('Content-Type', 'application/json')
        .send(body === '' ? undefined : body);
      if (method === 'PUT' || (method === 'POST' && path().endsWith('/pool/seal'))) {
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('POOL_SEALED');
      } else {
        expect([200, 201, 202]).toContain(res.status);
      }
    });
  });

  it('GET pool returns exactly the four public fields', async () => {
    const res = await request(app).get(`/api/jobs/${jobId}/pool`).set(auth);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.pool).sort()).toEqual(['hasActivePool', 'itemCount', 'sealedAt', 'version']);
    expect(res.body.pool.itemCount).toBe(1);
    expect(res.body.pool.hasActivePool).toBe(true);
  });

  it('GET samples shows preview items by design (sample canary visible, pool canary never)', async () => {
    const res = await request(app).get(`/api/jobs/${jobId}/blueprint/samples`).set(auth);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(SAMPLE_CANARY);
    expect(JSON.stringify(res.body)).not.toContain(POOL_CANARY);
  });
});
