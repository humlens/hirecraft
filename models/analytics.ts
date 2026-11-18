import { Prisma } from '@prisma/client';
import { toCsv } from '@/lib/csv';
import { openJobWhere } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import type { TenantContext } from '@/lib/tenant';

type Range = { from: Date; to: Date; jobId?: string };

/** Jobs an assignment-scoped member may report on (null = all jobs). */
async function scopedJobIds(ctx: TenantContext): Promise<string[] | null> {
  if (ctx.scope !== 'assigned') {
    return null;
  }

  const rows = await prisma.jobAssignment.findMany({
    where: { teamId: ctx.team.id, userId: ctx.user.id },
    select: { jobId: true },
  });

  return rows.map((r) => r.jobId);
}

const jobFilter = (alias: string, r: Range, scoped: string[] | null) => {
  const parts: Prisma.Sql[] = [];

  if (r.jobId) {
    parts.push(Prisma.sql`AND ${Prisma.raw(alias)}."jobId" = ${r.jobId}`);
  }

  if (scoped) {
    parts.push(
      scoped.length
        ? Prisma.sql`AND ${Prisma.raw(alias)}."jobId" IN (${Prisma.join(scoped)})`
        : Prisma.sql`AND FALSE`
    );
  }

  return parts.length ? Prisma.join(parts, ' ') : Prisma.empty;
};

const num = (v: unknown) => Number(v ?? 0);

export async function getAnalytics(ctx: TenantContext, r: Range) {
  const teamId = ctx.team.id;
  const scoped = await scopedJobIds(ctx);
  const jf = jobFilter('a', r, scoped);

  const [
    openJobs,
    apps,
    outcomes,
    ttH,
    funnel,
    sources,
    topJobs,
    offers,
    interviews,
  ] = await Promise.all([
    prisma.job.count({
      where: {
        teamId,
        ...openJobWhere(),
        ...(scoped ? { id: { in: scoped } } : {}),
        ...(r.jobId ? { id: r.jobId } : {}),
      },
    }),
    prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) n FROM "JobApplication" a
        WHERE a."teamId" = ${teamId} AND a."createdAt" BETWEEN ${r.from} AND ${r.to} ${jf}`,
    // Applications created in the range, by the kind of stage they are in now
    prisma.$queryRaw<{ kind: string; n: bigint }[]>`
        SELECT s.kind::text kind, count(*) n
        FROM "JobApplication" a JOIN "PipelineStage" s ON s.id = a."stageId"
        WHERE a."teamId" = ${teamId} AND a."createdAt" BETWEEN ${r.from} AND ${r.to} ${jf}
        GROUP BY s.kind`,
    // Average days from application to the (latest) move into a HIRED stage
    prisma.$queryRaw<{ days: number | null; n: bigint }[]>`
        SELECT avg(EXTRACT(EPOCH FROM (h."at" - a."createdAt")) / 86400.0)::float days, count(*) n
        FROM "JobApplication" a
        JOIN "PipelineStage" s ON s.id = a."stageId" AND s.kind = 'HIRED'
        JOIN LATERAL (
          SELECT max(x."createdAt") "at" FROM "ApplicationActivity" x
          WHERE x."applicationId" = a.id AND x."teamId" = ${teamId} AND x."toStageId" = a."stageId"
        ) h ON true
        WHERE a."teamId" = ${teamId} AND h."at" BETWEEN ${r.from} AND ${r.to} ${jf}`,
    // Funnel: distinct applications that ever reached each stage
    prisma.$queryRaw<{ name: string; ord: number; n: bigint }[]>`
        SELECT s.name, min(s."order") ord, count(DISTINCT x."applicationId") n
        FROM "ApplicationActivity" x
        JOIN "JobApplication" a ON a.id = x."applicationId" AND a."teamId" = ${teamId}
        JOIN "PipelineStage" s ON s.id = x."toStageId"
        WHERE x."teamId" = ${teamId} AND x."toStageId" IS NOT NULL
          AND a."createdAt" BETWEEN ${r.from} AND ${r.to} ${jf}
        GROUP BY s.name ORDER BY ord, s.name`,
    prisma.$queryRaw<{ source: string; n: bigint }[]>`
        SELECT a.source, count(*) n FROM "JobApplication" a
        WHERE a."teamId" = ${teamId} AND a."createdAt" BETWEEN ${r.from} AND ${r.to} ${jf}
        GROUP BY a.source ORDER BY n DESC`,
    prisma.$queryRaw<{ id: string; title: string; n: bigint }[]>`
        SELECT j.id, j.title, count(*) n
        FROM "JobApplication" a JOIN "Job" j ON j.id = a."jobId" AND j."teamId" = ${teamId}
        WHERE a."teamId" = ${teamId} AND a."createdAt" BETWEEN ${r.from} AND ${r.to} ${jf}
        GROUP BY j.id, j.title ORDER BY n DESC, j.title LIMIT 10`,
    prisma.$queryRaw<{ status: string; n: bigint }[]>`
        SELECT o.status::text status, count(*) n
        FROM "Offer" o JOIN "JobApplication" a ON a.id = o."applicationId" AND a."teamId" = ${teamId}
        WHERE o."teamId" = ${teamId} AND o."createdAt" BETWEEN ${r.from} AND ${r.to} ${jf}
        GROUP BY o.status`,
    prisma.$queryRaw<{ status: string; n: bigint }[]>`
        SELECT i.status::text status, count(*) n
        FROM "Interview" i JOIN "JobApplication" a ON a.id = i."applicationId" AND a."teamId" = ${teamId}
        WHERE i."teamId" = ${teamId} AND i."startsAt" BETWEEN ${r.from} AND ${r.to} ${jf}
        GROUP BY i.status`,
  ]);

  const byKind = Object.fromEntries(outcomes.map((o) => [o.kind, num(o.n)]));
  const offerBy = Object.fromEntries(offers.map((o) => [o.status, num(o.n)]));
  const answered = (offerBy.ACCEPTED ?? 0) + (offerBy.DECLINED ?? 0);

  return {
    range: { from: r.from, to: r.to, jobId: r.jobId ?? null },
    kpis: {
      openJobs,
      applications: num(apps[0]?.n),
      hires: byKind.HIRED ?? 0,
      rejected: byKind.REJECTED ?? 0,
      withdrawn: byKind.WITHDRAWN ?? 0,
      inProgress: byKind.ACTIVE ?? 0,
      avgTimeToHireDays:
        ttH[0]?.days == null ? null : Math.round(ttH[0].days * 10) / 10,
      offerAcceptanceRate: answered
        ? Math.round(((offerBy.ACCEPTED ?? 0) / answered) * 100)
        : null,
    },
    funnel: funnel.map((f) => ({ stage: f.name, count: num(f.n) })),
    sources: sources.map((s) => ({ source: s.source, count: num(s.n) })),
    topJobs: topJobs.map((j) => ({
      id: j.id,
      title: j.title,
      applications: num(j.n),
    })),
    offers: offerBy,
    interviews: Object.fromEntries(interviews.map((i) => [i.status, num(i.n)])),
  };
}

/** Applications report as CSV (contains personal data: needs candidates.export). */
export async function exportApplicationsCsv(ctx: TenantContext, r: Range) {
  const teamId = ctx.team.id;
  const scoped = await scopedJobIds(ctx);
  const rows = await prisma.jobApplication.findMany({
    where: {
      teamId,
      createdAt: { gte: r.from, lte: r.to },
      ...(r.jobId ? { jobId: r.jobId } : {}),
      ...(scoped ? { jobId: { in: scoped } } : {}),
    },
    include: {
      job: { select: { title: true } },
      stage: { select: { name: true, kind: true } },
      tenantCandidate: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 10000,
  });

  return {
    count: rows.length,
    csv: toCsv(
      ['job', 'candidate', 'email', 'stage', 'outcome', 'source', 'applied_at'],
      rows.map((a) => [
        a.job.title,
        a.tenantCandidate.name,
        a.tenantCandidate.email,
        a.stage.name,
        a.stage.kind,
        a.source,
        a.createdAt.toISOString(),
      ])
    ),
  };
}
