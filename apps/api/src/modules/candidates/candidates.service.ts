// Candidate test profile (founder requirement 2026-09-21): one person's
// testing story ACROSS roles — every application to this company, each test
// session's outcome, and a cross-session aggregate (formats, average,
// flags). Computed on read from the existing per-session evidence
// (Evaluation + SessionAssessment), so it appears the moment a test
// completes and stays consistent with voids/renormalization — no shadow
// table to keep fresh.
//
// RE-APPEARANCE POLICY, pinned here: nothing in this profile gates future
// applications. A candidate rejected on one role applies to any other role
// freely (the per-job @@unique(jobId, candidateId) only blocks re-applying to
// the SAME role) — flunking one test must never ban the person.
//
// Company-scoped like every HR route: only THIS company's applications and
// sessions are visible, uniform 404 otherwise (a candidate who applied
// elsewhere only is indistinguishable from unknown — no cross-tenant oracle).

import { prisma } from '../../prisma';
import { AppError } from '../../lib/http';
import type { AuthUser } from '../../types';

/** aiHigh/aiMedium counts from a flagSummary Json blob (absorbs old/odd rows). */
function flagCounts(flagSummary: unknown): { high: number; medium: number } {
  if (typeof flagSummary !== 'object' || flagSummary === null) return { high: 0, medium: 0 };
  const { aiHigh, aiMedium } = flagSummary as { aiHigh?: unknown; aiMedium?: unknown };
  return {
    high: typeof aiHigh === 'number' ? aiHigh : 0,
    medium: typeof aiMedium === 'number' ? aiMedium : 0,
  };
}

/** The candidate's cross-role testing profile for the caller's company. */
export async function candidateProfile(user: AuthUser, candidateId: string) {
  const companyId = user.companyId!;

  const applications = await prisma.application.findMany({
    where: { candidateId, job: { companyId } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      stage: true,
      status: true,
      createdAt: true,
      source: true,
      job: { select: { id: true, title: true } },
      testSession: {
        select: {
          status: true,
          submittedAt: true,
          assessment: { select: { totalScore: true, strengths: true, gaps: true, flagSummary: true } },
        },
      },
    },
  });
  if (applications.length === 0) {
    throw new AppError(404, 'Candidate not found', 'NOT_FOUND');
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      resumeUrl: true,
      linkedinUrl: true,
      githubUrl: true,
      createdAt: true,
    },
  });
  if (!candidate) {
    throw new AppError(404, 'Candidate not found', 'NOT_FOUND');
  }

  // Cross-session deterministic evidence: every non-voided evaluation of this
  // candidate's sessions for THIS company, tallied per question format.
  const evaluations = await prisma.evaluation.findMany({
    where: {
      voided: false,
      sessionQuestion: { session: { application: { candidateId, job: { companyId } } } },
    },
    select: { verdict: true, sessionQuestion: { select: { format: true } } },
  });

  const byFormat: Record<string, { CORRECT: number; PARTIAL: number; INCORRECT: number }> = {};
  for (const e of evaluations) {
    const format = e.sessionQuestion.format;
    const tally = (byFormat[format] ??= { CORRECT: 0, PARTIAL: 0, INCORRECT: 0 });
    if (e.verdict === 'CORRECT' || e.verdict === 'PARTIAL' || e.verdict === 'INCORRECT') {
      tally[e.verdict]++;
    }
  }

  const submitted = applications.filter((a) => a.testSession?.status === 'SUBMITTED');
  const scores = submitted.map((a) => a.testSession?.assessment?.totalScore).filter((s): s is number => typeof s === 'number');
  const averageScore = scores.length === 0 ? null : scores.reduce((sum, s) => sum + s, 0) / scores.length;
  const flags = submitted.reduce(
    (acc, a) => {
      const c = flagCounts(a.testSession?.assessment?.flagSummary);
      return { high: acc.high + c.high, medium: acc.medium + c.medium };
    },
    { high: 0, medium: 0 },
  );

  return {
    candidate,
    summary: {
      applications: applications.length,
      testsTaken: submitted.length,
      averageScore,
      byFormat,
      flags,
    },
    history: applications.map((a) => ({
      applicationId: a.id,
      jobId: a.job.id,
      jobTitle: a.job.title,
      stage: a.stage,
      status: a.status,
      source: a.source,
      appliedAt: a.createdAt,
      session:
        a.testSession !== null
          ? {
              status: a.testSession.status,
              submittedAt: a.testSession.submittedAt,
              score: a.testSession.assessment?.totalScore ?? null,
              strengths: a.testSession.assessment?.strengths ?? null,
              gaps: a.testSession.assessment?.gaps ?? null,
            }
          : null,
    })),
  };
}
