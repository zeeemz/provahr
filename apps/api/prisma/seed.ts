/**
 * Development seed: a demo company with users, jobs, candidates, applications
 * spread across the pipeline, interviews, and scorecards.
 *
 *   npm run seed
 *
 * Safe to re-run: it resets the demo company's data (jobs, applications,
 * interviews, scorecards) and reseeds.
 */
import { PrismaClient, Stage, Stage as StageType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Demo seed password — override with SEED_PASSWORD for non-demo installs.
const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'demo-password-123';

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function main() {
  console.log('Seeding demo data…');

  // ── Company + users ────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const company = await prisma.company.upsert({
    where: { slug: 'acme' },
    create: { name: 'Acme Software', slug: 'acme', website: 'https://acme.test' },
    update: { name: 'Acme Software', website: 'https://acme.test' },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@acme.test' },
    create: { email: 'admin@acme.test', name: 'Amara Okafor', role: 'ADMIN', passwordHash, companyId: company.id },
    update: { role: 'ADMIN', passwordHash, companyId: company.id },
  });
  const recruiter = await prisma.user.upsert({
    where: { email: 'rebecca@acme.test' },
    create: { email: 'rebecca@acme.test', name: 'Rebecca Tan', role: 'RECRUITER', passwordHash, companyId: company.id },
    update: { role: 'RECRUITER', passwordHash, companyId: company.id },
  });
  const interviewer = await prisma.user.upsert({
    where: { email: 'ian@acme.test' },
    create: { email: 'ian@acme.test', name: 'Ian Petrov', role: 'INTERVIEWER', passwordHash, companyId: company.id },
    update: { role: 'INTERVIEWER', passwordHash, companyId: company.id },
  });

  // ── Reset demo job data (applications cascade) ─────────────────────────────
  await prisma.job.deleteMany({ where: { companyId: company.id } });
  await prisma.candidate.deleteMany({});

  // ── Jobs ───────────────────────────────────────────────────────────────────
  const frontendJob = await prisma.job.create({
    data: {
      companyId: company.id,
      title: 'Senior Frontend Engineer',
      department: 'Engineering',
      roleFamily: 'ENGINEERING',
      location: 'Remote (Europe)',
      workMode: 'REMOTE',
      employmentType: 'FULL_TIME',
      salaryMin: 90_000,
      salaryMax: 130_000,
      salaryCurrency: 'EUR',
      status: 'OPEN',
      description:
        'Own our customer-facing web app. You will work with React and TypeScript, shape our design system, and mentor mid-level engineers.\n\n**You will:**\n- Build accessible, fast UI with React + TypeScript\n- Partner with product on discovery\n- Raise the bar on testing and DX\n\n**We offer:**\n- Remote-first team across EMEA\n- Learning budget and conference days',
    },
  });

  const backendJob = await prisma.job.create({
    data: {
      companyId: company.id,
      title: 'Backend Engineer (Node.js)',
      department: 'Engineering',
      roleFamily: 'ENGINEERING',
      location: 'Berlin, Germany',
      workMode: 'HYBRID',
      employmentType: 'FULL_TIME',
      salaryMin: 80_000,
      salaryMax: 110_000,
      salaryCurrency: 'EUR',
      status: 'OPEN',
      description:
        'Design and scale the APIs behind our hiring platform: REST services on Node.js/TypeScript with PostgreSQL.\n\n**You will:**\n- Build reliable, well-tested REST APIs\n- Model data with care (we use Prisma + PostgreSQL)\n- Take part in on-call rotation (1 week in 8)\n\n**We offer:**\n- Hybrid work in Berlin (2 days in office)\n- 30 days vacation',
    },
  });

  const pmJob = await prisma.job.create({
    data: {
      companyId: company.id,
      title: 'Senior Product Manager — Platform',
      department: 'Product',
      roleFamily: 'PRODUCT_MANAGEMENT',
      location: 'Remote (Global)',
      workMode: 'REMOTE',
      employmentType: 'FULL_TIME',
      salaryMin: 120_000,
      salaryMax: 160_000,
      salaryCurrency: 'USD',
      status: 'OPEN',
      description:
        'Lead the platform product area: job management, pipeline, and integrations. You will define the roadmap, talk to HR teams worldwide, and ship improvements weekly.\n\n**You will:**\n- Own discovery and delivery for the platform area\n- Work with design and engineering in cross-functional teams\n- Define metrics and drive adoption\n\n**We offer:**\n- A remote-first, documentation-driven culture',
    },
  });

  await prisma.job.create({
    data: {
      companyId: company.id,
      title: 'Data Analyst',
      department: 'Data',
      roleFamily: 'DATA',
      location: 'London, UK',
      workMode: 'ONSITE',
      employmentType: 'FULL_TIME',
      salaryMin: 65_000,
      salaryMax: 85_000,
      salaryCurrency: 'GBP',
      status: 'OPEN',
      description:
        'Turn hiring funnel data into decisions. You will build dashboards, run analyses on our PostgreSQL data, and partner with recruiters to improve conversion at every stage.\n\n**You will:**\n- Build and maintain funnel dashboards\n- Design experiments with the product team\n- Present insights to leadership monthly',
    },
  });

  await prisma.job.create({
    data: {
      companyId: company.id,
      title: 'Engineering Manager — Core',
      department: 'Engineering',
      roleFamily: 'ENGINEERING',
      location: 'Berlin, Germany',
      workMode: 'HYBRID',
      employmentType: 'FULL_TIME',
      status: 'DRAFT',
      description:
        'Draft posting: manage a team of 6-8 engineers building the core hiring platform. Details being finalized with leadership — not yet published.',
    },
  });

  // ── Candidates + applications across the pipeline ──────────────────────────
  type SeedApp = {
    job: { id: string };
    candidate: { name: string; email: string; phone?: string; linkedinUrl?: string; githubUrl?: string };
    stage: StageType;
    status: 'ACTIVE' | 'REJECTED' | 'WITHDRAWN' | 'HIRED';
    source?: string;
    coverLetter?: string;
    rejectionReason?: string;
    appliedDaysAgo: number;
    path: Stage[]; // stages walked through, for the audit trail
  };

  const seedApplications: SeedApp[] = [
    {
      job: frontendJob,
      candidate: { name: 'Alice Nkemelu', email: 'alice@example.com', linkedinUrl: 'https://linkedin.com/in/alice-example' },
      stage: 'APPLIED', status: 'ACTIVE', source: 'Careers page', appliedDaysAgo: 2, path: ['APPLIED'],
    },
    {
      job: frontendJob,
      candidate: { name: 'Bob van der Berg', email: 'bob@example.com' },
      stage: 'SCREENING', status: 'ACTIVE', source: 'LinkedIn', appliedDaysAgo: 6, path: ['APPLIED', 'SCREENING'],
    },
    {
      job: frontendJob,
      candidate: { name: 'Carol Ionescu', email: 'carol@example.com', githubUrl: 'https://github.com/carol-example' },
      stage: 'INTERVIEW', status: 'ACTIVE', source: 'Referral', appliedDaysAgo: 12,
      coverLetter: 'I have been building React apps for 6 years and love mentoring.',
      path: ['APPLIED', 'SCREENING', 'INTERVIEW'],
    },
    {
      job: backendJob,
      candidate: { name: 'Dmitri Volkov', email: 'dmitri@example.com' },
      stage: 'OFFER', status: 'ACTIVE', source: 'LinkedIn', appliedDaysAgo: 20,
      path: ['APPLIED', 'SCREENING', 'ASSESSMENT', 'INTERVIEW', 'OFFER'],
    },
    {
      job: backendJob,
      candidate: { name: 'Greg Silva', email: 'greg@example.com' },
      stage: 'HIRED', status: 'HIRED', source: 'Referral', appliedDaysAgo: 30,
      path: ['APPLIED', 'SCREENING', 'ASSESSMENT', 'INTERVIEW', 'OFFER', 'HIRED'],
    },
    {
      job: pmJob,
      candidate: { name: 'Emma Rousseau', email: 'emma@example.com' },
      stage: 'ASSESSMENT', status: 'ACTIVE', source: 'Careers page', appliedDaysAgo: 8,
      path: ['APPLIED', 'SCREENING', 'ASSESSMENT'],
    },
    {
      job: pmJob,
      candidate: { name: 'Farah Haddad', email: 'farah@example.com' },
      stage: 'SCREENING', status: 'REJECTED', source: 'Careers page', appliedDaysAgo: 15,
      rejectionReason: 'Needs more platform experience for the senior scope of this role.',
      path: ['APPLIED', 'SCREENING'],
    },
  ];

  const createdApps: Record<string, { id: string }> = {};

  for (const seed of seedApplications) {
    const candidate = await prisma.candidate.upsert({
      where: { email: seed.candidate.email },
      create: seed.candidate,
      update: {},
    });

    const application = await prisma.application.create({
      data: {
        jobId: seed.job.id,
        candidateId: candidate.id,
        stage: seed.stage,
        status: seed.status,
        source: seed.source,
        coverLetter: seed.coverLetter,
        rejectionReason: seed.rejectionReason,
        createdAt: daysAgo(seed.appliedDaysAgo),
      },
    });
    createdApps[seed.candidate.email] = application;

    // Audit trail: one event per stage in the path, spread over time.
    for (let i = 0; i < seed.path.length; i++) {
      const to = seed.path[i]!;
      const from = i === 0 ? null : seed.path[i - 1]!;
      await prisma.stageEvent.create({
        data: {
          applicationId: application.id,
          fromStage: from,
          toStage: to,
          actorId: i === 0 ? null : (from === 'APPLIED' ? recruiter.id : admin.id),
          createdAt: daysAgo(seed.appliedDaysAgo - i),
          note: i === 0 ? undefined : `Moved to ${to}`,
        },
      });
    }

    // Rejection also gets a status event.
    if (seed.status === 'REJECTED') {
      await prisma.stageEvent.create({
        data: {
          applicationId: application.id,
          fromStage: seed.stage,
          toStage: seed.stage,
          actorId: recruiter.id,
          createdAt: daysAgo(seed.appliedDaysAgo - seed.path.length),
          note: `Rejected: ${seed.rejectionReason}`,
        },
      });
    }
  }

  // ── Interviews + scorecards ────────────────────────────────────────────────
  const carolApp = createdApps['carol@example.com']!;
  const dmitriApp = createdApps['dmitri@example.com']!;
  const bobApp = createdApps['bob@example.com']!;

  const carolTechnical = await prisma.interview.create({
    data: {
      applicationId: carolApp.id,
      interviewerId: interviewer.id,
      type: 'TECHNICAL',
      scheduledAt: daysAgo(5),
      durationMinutes: 60,
      locationOrLink: 'https://meet.example.com/carol-technical',
      status: 'COMPLETED',
      notes: 'Strong on React internals; walked through a clean state-management design.',
    },
  });

  await prisma.scorecard.create({
    data: {
      applicationId: carolApp.id,
      authorId: interviewer.id,
      interviewId: carolTechnical.id,
      technical: 4,
      communication: 4,
      problemSolving: 5,
      roleFit: 4,
      recommendation: 'HIRE',
      strengths: 'Deep React knowledge, communicates trade-offs clearly.',
      concerns: 'Limited exposure to large-scale SSR.',
      summary: 'Would raise the team bar on frontend fundamentals.',
    },
  });

  await prisma.interview.create({
    data: {
      applicationId: carolApp.id,
      interviewerId: admin.id,
      type: 'BEHAVIORAL',
      scheduledAt: daysFromNow(2),
      durationMinutes: 45,
      locationOrLink: 'https://meet.example.com/carol-behavioral',
      status: 'SCHEDULED',
    },
  });

  await prisma.interview.create({
    data: {
      applicationId: dmitriApp.id,
      interviewerId: interviewer.id,
      type: 'FINAL',
      scheduledAt: daysFromNow(3),
      durationMinutes: 60,
      locationOrLink: 'https://meet.example.com/dmitri-final',
      status: 'SCHEDULED',
    },
  });

  await prisma.interview.create({
    data: {
      applicationId: bobApp.id,
      interviewerId: recruiter.id,
      type: 'PHONE_SCREEN',
      scheduledAt: daysFromNow(1),
      durationMinutes: 30,
      locationOrLink: 'https://meet.example.com/bob-screen',
      status: 'SCHEDULED',
    },
  });

  console.log('Seed complete.');
  console.log('  Company:  Acme Software (slug: acme)');
  console.log('  Login:    admin@acme.test / password123   (ADMIN)');
  console.log('            rebecca@acme.test / password123 (RECRUITER)');
  console.log('            ian@acme.test / password123     (INTERVIEWER)');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
