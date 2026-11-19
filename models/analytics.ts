import { Prisma } from '@prisma/client';
import { toCsv } from '@/lib/csv';
import { openJobWhere } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import type { TenantContext } from '@/lib/tenant';

type Range = {
  from: Date;
  to: Date;
  jobId?: string;
  recruiterId?: string;
};

/** Jobs an assignment-scoped member may report on (null = all jobs). */
async function scopedJobIds(
  ctx: TenantContext,
  recruiterId?: string
): Promise<string[] | null> {
  let ids: string[] | null = null;

  if (ctx.scope === 'assigned') {
    const rows = await prisma.jobAssignment.findMany({
      where: { teamId: ctx.team.id, userId: ctx.user.id },
      select: { jobId: true },
    });

    ids = rows.map((r) => r.jobId);
  }

  if (recruiterId) {
    const rows = await prisma.jobAssignment.findMany({
      where: { teamId: ctx.team.id, userId: recruiterId, kind: 'RECRUITER' },
      select: { jobId: true },
    });
    const theirs = new Set(rows.map((r) => r.jobId));

    ids = ids ? ids.filter((j) => theirs.has(j)) : Array.from(theirs);
  }

  return ids;
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
  const scoped = await scopedJobIds(ctx, r.recruiterId);
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
    fill,
    i2o,
    workload,
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
    // Days from the job being published to an accepted offer
    prisma.$queryRaw<{ days: number | null }[]>`
        SELECT avg(EXTRACT(EPOCH FROM (o."respondedAt" - COALESCE(j."publishedAt", j."createdAt"))) / 86400.0)::float days
        FROM "Offer" o
        JOIN "JobApplication" a ON a.id = o."applicationId" AND a."teamId" = ${teamId}
        JOIN "Job" j ON j.id = a."jobId" AND j."teamId" = ${teamId}
        WHERE o."teamId" = ${teamId} AND o.status = 'ACCEPTED'
          AND o."respondedAt" BETWEEN ${r.from} AND ${r.to} ${jf}`,
    // Of the applications that were interviewed, how many received an offer
    prisma.$queryRaw<{ interviewed: bigint; offered: bigint }[]>`
        SELECT count(DISTINCT i."applicationId") interviewed,
               count(DISTINCT o."applicationId") offered
        FROM "Interview" i
        JOIN "JobApplication" a ON a.id = i."applicationId" AND a."teamId" = ${teamId}
        LEFT JOIN "Offer" o ON o."applicationId" = a.id AND o."teamId" = ${teamId}
        WHERE i."teamId" = ${teamId} AND i.status <> 'CANCELLED'
          AND a."createdAt" BETWEEN ${r.from} AND ${r.to} ${jf}`,
    // Recruiter workload (assigned recruiters, within the member's scope)
    prisma.$queryRaw<
      {
        id: string;
        name: string;
        openJobs: bigint;
        active: bigint;
        reviewDays: number | null;
        hires: bigint;
      }[]
    >`
        SELECT u.id, u.name,
          count(DISTINCT j.id) FILTER (WHERE j.status = 'PUBLISHED' AND j."deletedAt" IS NULL) "openJobs",
          count(DISTINCT a.id) FILTER (WHERE s.kind = 'ACTIVE' AND j."deletedAt" IS NULL) active,
          avg(EXTRACT(EPOCH FROM (now() - a."updatedAt")) / 86400.0)
            FILTER (WHERE s.kind = 'ACTIVE' AND j."deletedAt" IS NULL)::float "reviewDays",
          count(DISTINCT a.id) FILTER (WHERE s.kind = 'HIRED' AND a."updatedAt" BETWEEN ${r.from} AND ${r.to}) hires
        FROM "JobAssignment" ja
        JOIN "User" u ON u.id = ja."userId"
        JOIN "Job" j ON j.id = ja."jobId" AND j."teamId" = ${teamId}
        LEFT JOIN "JobApplication" a ON a."jobId" = j.id AND a."teamId" = ${teamId}
        LEFT JOIN "PipelineStage" s ON s.id = a."stageId"
        WHERE ja."teamId" = ${teamId} AND ja.kind = 'RECRUITER'
          ${scoped ? (scoped.length ? Prisma.sql`AND j.id IN (${Prisma.join(scoped)})` : Prisma.sql`AND FALSE`) : Prisma.empty}
          ${r.jobId ? Prisma.sql`AND j.id = ${r.jobId}` : Prisma.empty}
        GROUP BY u.id, u.name ORDER BY active DESC, u.name`,
  ]);

  const byKind = Object.fromEntries(outcomes.map((o) => [o.kind, num(o.n)]));
  const offerBy = Object.fromEntries(offers.map((o) => [o.status, num(o.n)]));
  const answered = (offerBy.ACCEPTED ?? 0) + (offerBy.DECLINED ?? 0);

  return {
    range: {
      from: r.from,
      to: r.to,
      jobId: r.jobId ?? null,
      recruiterId: r.recruiterId ?? null,
    },
    kpis: {
      openJobs,
      applications: num(apps[0]?.n),
      hires: byKind.HIRED ?? 0,
      rejected: byKind.REJECTED ?? 0,
      withdrawn: byKind.WITHDRAWN ?? 0,
      inProgress: byKind.ACTIVE ?? 0,
      avgTimeToHireDays:
        ttH[0]?.days == null ? null : Math.round(ttH[0].days * 10) / 10,
      avgTimeToFillDays:
        fill[0]?.days == null ? null : Math.round(fill[0].days * 10) / 10,
      interviewToOfferRate: num(i2o[0]?.interviewed)
        ? Math.round((num(i2o[0]?.offered) / num(i2o[0]?.interviewed)) * 100)
        : null,
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
    recruiters: workload.map((w) => ({
      id: w.id,
      name: w.name,
      openJobs: num(w.openJobs),
      activeCandidates: num(w.active),
      avgDaysInReview:
        w.reviewDays == null ? null : Math.round(w.reviewDays * 10) / 10,
      hires: num(w.hires),
    })),
    interviews: Object.fromEntries(interviews.map((i) => [i.status, num(i.n)])),
  };
}

/** Applications report as CSV (contains personal data: needs candidates.export). */
export async function exportApplicationsCsv(ctx: TenantContext, r: Range) {
  const teamId = ctx.team.id;
  const scoped = await scopedJobIds(ctx, r.recruiterId);
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
