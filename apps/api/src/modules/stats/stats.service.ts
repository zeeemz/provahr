import { prisma } from '../../prisma';
import { STAGES } from '../../rules/pipeline';
import type { AuthUser } from '../../types';

/** Dashboard aggregates for the caller's company. */
export async function dashboard(user: AuthUser) {
  const companyId = user.companyId!;
  const jobScope = { job: { companyId } };

  const [
    jobsTotal,
    jobsOpen,
    applicationsTotal,
    applicationsActive,
    applicationsHired,
    applicationsRejected,
    byStageRows,
    recentEvents,
  ] = await Promise.all([
    prisma.job.count({ where: { companyId } }),
    prisma.job.count({ where: { companyId, status: 'OPEN' } }),
    prisma.application.count({ where: jobScope }),
    prisma.application.count({ where: { ...jobScope, status: 'ACTIVE' } }),
    prisma.application.count({ where: { ...jobScope, status: 'HIRED' } }),
    prisma.application.count({ where: { ...jobScope, status: 'REJECTED' } }),
    prisma.application.groupBy({
      by: ['stage'],
      where: { ...jobScope, status: 'ACTIVE' },
      _count: { _all: true },
    }),
    prisma.stageEvent.findMany({
      where: { application: jobScope },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        actor: { select: { name: true } },
        application: {
          include: {
            candidate: { select: { name: true } },
            job: { select: { title: true } },
          },
        },
      },
    }),
  ]);

  const byStage = Object.fromEntries(STAGES.map((stage) => [stage, 0])) as Record<string, number>;
  for (const row of byStageRows) {
    byStage[row.stage] = row._count?._all ?? 0;
  }

  return {
    jobs: { total: jobsTotal, open: jobsOpen },
    applications: {
      total: applicationsTotal,
      active: applicationsActive,
      hired: applicationsHired,
      rejected: applicationsRejected,
    },
    byStage,
    recentEvents,
  };
}
