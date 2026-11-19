import { prisma } from '@/lib/prisma';
import type { TenantContext } from '@/lib/tenant';
import { jobScope } from './job';

/**
 * The recruiter dashboard: headline numbers, the hiring funnel, the jobs that
 * need a look, and the latest notifications. Everything respects the member's
 * job scope (recruiters see their assigned jobs only).
 */
export async function getDashboard(ctx: TenantContext, days: number) {
  const teamId = ctx.team.id;
  const since = new Date(Date.now() - days * 86400_000);
  const jobWhere = { teamId, deletedAt: null, ...jobScope(ctx) };
  const appWhere = { teamId, job: jobWhere, createdAt: { gte: since } };

  const [
    activeJobs,
    applications,
    interviews,
    hiredRows,
    applied,
    screened,
    interviewed,
    offered,
    hired,
  ] = await Promise.all([
    prisma.job.count({ where: { ...jobWhere, status: 'PUBLISHED' } }),
    prisma.jobApplication.count({ where: appWhere }),
    prisma.interview.count({
      where: {
        teamId,
        createdAt: { gte: since },
        status: 'SCHEDULED',
        application: { teamId, job: jobWhere },
      },
    }),
    prisma.jobApplication.findMany({
      where: {
        teamId,
        job: jobWhere,
        stage: { kind: 'HIRED' },
        updatedAt: { gte: since },
      },
      select: { createdAt: true, updatedAt: true },
      take: 500,
    }),
    prisma.jobApplication.count({ where: appWhere }),
    // "screened" = a person has moved the application at least once
    prisma.jobApplication.count({
      where: {
        ...appWhere,
        activities: { some: { teamId, type: 'STAGE_CHANGED' } },
      },
    }),
    prisma.jobApplication.count({
      where: { ...appWhere, interviews: { some: { teamId } } },
    }),
    prisma.jobApplication.count({
      where: { ...appWhere, offers: { some: { teamId } } },
    }),
    prisma.jobApplication.count({
      where: { ...appWhere, stage: { kind: 'HIRED' } },
    }),
  ]);

  const days_ = hiredRows
    .map((r) => (r.updatedAt.getTime() - r.createdAt.getTime()) / 86400_000)
    .sort((a, b) => a - b);
  const median = days_.length
    ? Math.round(days_[Math.floor(days_.length / 2)])
    : null;

  // jobs needing attention
  const jobs = await prisma.job.findMany({
    where: { ...jobWhere, status: 'PUBLISHED' },
    orderBy: { publishedAt: 'asc' },
    take: 20,
    select: { id: true, title: true, publishedAt: true },
  });
  const attention: {
    id: string;
    title: string;
    detail: string;
    tag: 'review' | 'low' | 'feedback';
  }[] = [];

  for (const j of jobs) {
    const [total, shortlisted, due] = await Promise.all([
      prisma.jobApplication.count({
        where: { teamId, jobId: j.id, withdrawnAt: null },
      }),
      prisma.jobApplication.count({
        where: {
          teamId,
          jobId: j.id,
          withdrawnAt: null,
          stage: { name: 'AI Shortlisted' },
        },
      }),
      prisma.interviewParticipant.count({
        where: {
          teamId,
          interview: {
            teamId,
            status: { in: ['SCHEDULED', 'COMPLETED'] },
            startsAt: { lt: new Date() },
            application: { teamId, jobId: j.id },
          },
          ...(ctx.scope === 'assigned' ? {} : {}),
        },
      }),
    ]);
    const feedback = await prisma.interviewFeedback.count({
      where: {
        teamId,
        interview: {
          teamId,
          startsAt: { lt: new Date() },
          application: { teamId, jobId: j.id },
        },
      },
    });
    const pending = Math.max(0, due - feedback);
    const age = j.publishedAt
      ? (Date.now() - j.publishedAt.getTime()) / 86400_000
      : 0;

    if (shortlisted > 0) {
      attention.push({
        id: j.id,
        title: j.title,
        tag: 'review',
        detail: `${total} applicants · ${shortlisted} AI-shortlisted awaiting review`,
      });
    } else if (pending > 0) {
      attention.push({
        id: j.id,
        title: j.title,
        tag: 'feedback',
        detail: `${pending} interview scorecards pending`,
      });
    } else if (age >= 7 && total < 10) {
      attention.push({
        id: j.id,
        title: j.title,
        tag: 'low',
        detail: `${total} applicants in ${Math.round(age)} days`,
      });
    }
  }

  const notifications = await prisma.notification.findMany({
    where: { userId: ctx.user.id },
    orderBy: { createdAt: 'desc' },
    take: 4,
    select: {
      id: true,
      title: true,
      body: true,
      link: true,
      readAt: true,
      createdAt: true,
    },
  });

  return {
    days,
    kpis: {
      activeJobs,
      applications,
      interviews,
      hires: hired,
      medianDaysToHire: median,
    },
    funnel: [
      { key: 'applied', value: applied },
      { key: 'screened', value: screened },
      { key: 'interviewed', value: interviewed },
      { key: 'offer', value: offered },
      { key: 'hired', value: hired },
    ],
    attention: attention.slice(0, 5),
    notifications,
  };
}
