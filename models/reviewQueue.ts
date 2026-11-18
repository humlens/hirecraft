import { prisma } from '@/lib/prisma';
import type { TenantContext } from '@/lib/tenant';
import { jobScope } from './job';

/**
 * The recruiter's mobile review queue: new applications waiting in the first
 * active stage of their pipeline, oldest first, with the latest AI assessment
 * as a hint. "Shortlist" moves an application to the next active stage through
 * the normal audited stage-change endpoint; nothing here moves or rejects anyone.
 */
export async function getReviewQueue(
  ctx: TenantContext,
  opts: { jobId?: string; limit?: number } = {}
) {
  const teamId = ctx.team.id;
  const stages = await prisma.pipelineStage.findMany({
    where: { teamId, kind: 'ACTIVE' },
    orderBy: { order: 'asc' },
    select: { id: true, name: true, jobId: true },
  });

  // pipelines: one per job that has its own stages, plus the portal default (jobId null)
  const groups = new Map<string | null, typeof stages>();

  for (const s of stages) {
    groups.set(s.jobId, [...(groups.get(s.jobId) ?? []), s]);
  }

  const defaults = groups.get(null) ?? [];
  const ownJobIds = Array.from(groups.keys()).filter((k): k is string => !!k);
  const pipelineOf = (jobId: string) =>
    groups.get(ownJobIds.includes(jobId) ? jobId : null) ?? defaults;

  const firstIds = Array.from(groups.values()).map((g) => g[0].id);
  const jobFilter = {
    teamId,
    deletedAt: null,
    ...(opts.jobId ? { id: opts.jobId } : {}),
    ...jobScope(ctx),
  };
  const where = {
    teamId,
    withdrawnAt: null,
    stageId: { in: firstIds },
    job: jobFilter,
  };

  const dayStart = new Date();

  dayStart.setHours(0, 0, 0, 0);

  const [rows, toReview, shortlistedToday] = await Promise.all([
    prisma.jobApplication.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: Math.min(opts.limit ?? 30, 50),
      include: {
        job: { select: { id: true, title: true } },
        tenantCandidate: { select: { name: true, userId: true } },
        assessments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    }),
    prisma.jobApplication.count({ where }),
    prisma.applicationActivity.count({
      where: {
        teamId,
        actorUserId: ctx.user.id,
        type: 'STAGE_CHANGED',
        createdAt: { gte: dayStart },
        application: { job: jobFilter },
      },
    }),
  ]);

  const userIds = rows
    .map((r) => r.tenantCandidate.userId)
    .filter((x): x is string => !!x);
  const profiles = await prisma.candidateProfile.findMany({
    where: { userId: { in: userIds } },
    select: {
      userId: true,
      headline: true,
      location: true,
      skills: { select: { skill: true }, take: 5 },
    },
  });
  const byUser = new Map(profiles.map((p) => [p.userId, p]));

  return {
    counts: { toReview, shortlistedToday },
    items: rows.map((r) => {
      const p = r.tenantCandidate.userId
        ? byUser.get(r.tenantCandidate.userId)
        : undefined;
      const a = r.assessments[0];
      const pipe = pipelineOf(r.jobId);
      const next = pipe[pipe.findIndex((s) => s.id === r.stageId) + 1] ?? null;

      return {
        applicationId: r.id,
        appliedAt: r.createdAt,
        job: r.job,
        candidate: {
          name: r.tenantCandidate.name,
          headline: p?.headline ?? null,
          location: p?.location ?? null,
          skills: (p?.skills ?? []).map((s) => s.skill),
        },
        match: a
          ? {
              score: a.score,
              explanation: a.explanation,
              matchedSkills: a.matchedSkills,
              missingSkills: a.missingSkills,
            }
          : null,
        nextStage: next ? { id: next.id, name: next.name } : null,
      };
    }),
  };
}
