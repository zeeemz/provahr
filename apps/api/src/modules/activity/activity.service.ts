// Background-work feed (founder ask 2026-09-20: "logs in ProvaHR so I can
// keep tabs on status"). The async worker's progress IS the job_queue table —
// this module turns it into a company-scoped, newest-first feed with each row
// resolved to its role: JD/samples/pool jobs carry `payload.jobId`; EVALUATION
// carries `payload.sessionId`, resolved through the session → application →
// job chain. Status/attempts/recorded error text only: payloads hold ids at
// most, and nothing here can ever reach pool item content.

import { prisma } from '../../prisma';
import { AppError } from '../../lib/http';
import type { AuthUser } from '../../types';

interface QueueEventRow {
  id: string;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  jobId: string | null;
  jobTitle: string | null;
}

/** The caller's company's recent background jobs, newest first. */
export async function activityFeed(user: AuthUser, limit = 50) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new AppError(400, 'limit must be an integer between 1 and 200', 'BAD_REQUEST');
  }
  // A queue row whose resolved job belongs to another company (or to no job at
  // all) matches neither join with our companyId and drops out — the feed is
  // company-scoped by construction, same boundary as every other HR route.
  const rows = await prisma.$queryRaw<QueueEventRow[]>`
    SELECT q.id,
           q.type::text AS type,
           q.status::text AS status,
           q.attempts,
           q."maxAttempts",
           q."lastError",
           q."createdAt",
           q."updatedAt",
           COALESCE(job_direct.id, job_via_session.id) AS "jobId",
           COALESCE(job_direct.title, job_via_session.title) AS "jobTitle"
    FROM job_queue q
    LEFT JOIN jobs job_direct
      ON job_direct.id = (q.payload->>'jobId')
    LEFT JOIN test_sessions ts
      ON ts.id = (q.payload->>'sessionId')
    LEFT JOIN applications app
      ON app.id = ts."applicationId"
    LEFT JOIN jobs job_via_session
      ON job_via_session.id = app."jobId"
    WHERE COALESCE(job_direct."companyId", job_via_session."companyId") = ${user.companyId!}
    ORDER BY q."updatedAt" DESC
    LIMIT ${limit}
  `;
  return { events: rows };
}
