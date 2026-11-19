import { Prisma } from '@prisma/client';
import { ApiError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { parseCsv, toCsv } from '@/lib/csv';
import type { TenantContext } from '@/lib/tenant';

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_BYTES = 1024 * 1024;

/** user ids whose LATEST talent-pool consent for this portal is "granted". */
async function talentPoolConsentUserIds(teamId: string) {
  const rows = await prisma.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM (
      SELECT DISTINCT ON ("userId") "userId", granted, "revokedAt"
      FROM "CandidateConsent"
      WHERE "teamId" = ${teamId} AND purpose = 'TALENT_POOL'
      ORDER BY "userId", "grantedAt" DESC
    ) latest
    WHERE granted = true AND "revokedAt" IS NULL
    LIMIT 20000`;

  return rows.map((r) => r.userId);
}

/**
 * Which candidates a member may see (rule: "a recruiter can see a candidate
 * only through an application to their portal, or through explicit consent to
 * that portal's talent pool"). Candidates imported by the portal itself are the
 * portal's own records. Assignment-scoped roles only see applicants to jobs
 * they are assigned to. Merged duplicates are hidden.
 */
export async function visibleCandidateWhere(
  ctx: TenantContext
): Promise<Prisma.TenantCandidateWhereInput> {
  const teamId = ctx.team.id;

  if (ctx.scope === 'assigned') {
    return {
      teamId,
      mergedIntoId: null,
      applications: {
        some: {
          teamId,
          job: { teamId, assignments: { some: { userId: ctx.user.id } } },
        },
      },
    };
  }

  const consentUsers = await talentPoolConsentUserIds(teamId);

  return {
    teamId,
    mergedIntoId: null,
    OR: [
      { applications: { some: { teamId } } },
      { source: { not: 'portal' } },
      ...(consentUsers.length ? [{ userId: { in: consentUsers } }] : []),
    ],
  };
}

const listInclude = {
  tagLinks: { include: { tag: { select: { id: true, name: true } } } },
  poolMembers: { include: { pool: { select: { id: true, name: true } } } },
  _count: { select: { applications: true } },
} satisfies Prisma.TenantCandidateInclude;

type Row = Prisma.TenantCandidateGetPayload<{ include: typeof listInclude }>;

const toSummary = (c: Row) => ({
  id: c.id,
  name: c.name,
  email: c.email,
  phone: c.phone,
  source: c.source,
  createdAt: c.createdAt,
  tags: c.tagLinks.map((l) => l.tag),
  pools: c.poolMembers.map((m) => m.pool),
  applicationCount: c._count.applications,
});

export async function listCandidates(
  ctx: TenantContext,
  f: {
    q?: string;
    tagId?: string;
    poolId?: string;
    source?: string;
    cursor?: string;
    limit: number;
  }
) {
  const teamId = ctx.team.id;
  const base = await visibleCandidateWhere(ctx);

  const where: Prisma.TenantCandidateWhereInput = {
    AND: [
      base,
      ...(f.q
        ? [
            {
              OR: [
                { name: { contains: f.q, mode: 'insensitive' as const } },
                { email: { contains: f.q, mode: 'insensitive' as const } },
              ],
            },
          ]
        : []),
      ...(f.tagId ? [{ tagLinks: { some: { teamId, tagId: f.tagId } } }] : []),
      ...(f.poolId
        ? [{ poolMembers: { some: { teamId, poolId: f.poolId } } }]
        : []),
      ...(f.source ? [{ source: f.source }] : []),
    ],
    teamId,
  };

  const rows = await prisma.tenantCandidate.findMany({
    where,
    include: listInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: f.limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, f.limit);

  const total = await prisma.tenantCandidate.count({ where });

  return {
    total,
    candidates: page.map(toSummary),
    nextCursor: rows.length > f.limit ? page[page.length - 1].id : null,
  };
}

async function getVisible(ctx: TenantContext, candidateId: string) {
  const base = await visibleCandidateWhere(ctx);
  const c = await prisma.tenantCandidate.findFirst({
    where: { AND: [base, { id: candidateId }], teamId: ctx.team.id },
    include: listInclude,
  });

  if (!c) {
    throw new ApiError(404, 'Candidate not found.');
  }

  return c;
}

export async function getCandidate(ctx: TenantContext, candidateId: string) {
  const teamId = ctx.team.id;
  const c = await getVisible(ctx, candidateId);

  const scopeJobs: Prisma.JobApplicationWhereInput =
    ctx.scope === 'assigned'
      ? { job: { teamId, assignments: { some: { userId: ctx.user.id } } } }
      : {};

  const [applications, notes, profile] = await Promise.all([
    prisma.jobApplication.findMany({
      where: { teamId, tenantCandidateId: c.id, ...scopeJobs },
      orderBy: { createdAt: 'desc' },
      include: {
        job: { select: { id: true, title: true } },
        stage: { select: { name: true, kind: true } },
      },
    }),
    prisma.candidateNote.findMany({
      where: { teamId, tenantCandidateId: c.id },
      orderBy: { createdAt: 'desc' },
    }),
    // The global profile is shown only for candidates visible to this portal
    c.userId
      ? prisma.candidateProfile.findUnique({
          where: { userId: c.userId },
          select: {
            headline: true,
            summary: true,
            location: true,
            skills: { select: { skill: true } },
            experiences: {
              select: {
                company: true,
                title: true,
                startDate: true,
                endDate: true,
                current: true,
              },
              orderBy: { startDate: 'desc' },
            },
            educations: { select: { institution: true, degree: true } },
          },
        })
      : null,
  ]);

  const authorIds = Array.from(
    new Set(notes.map((n) => n.authorId).filter(Boolean) as string[])
  );
  const authors = await prisma.user.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, name: true },
  });
  const authorName = new Map(authors.map((a) => [a.id, a.name]));

  return {
    ...toSummary(c),
    profile,
    applications: applications.map((a) => ({
      id: a.id,
      job: a.job,
      stage: a.stage,
      appliedAt: a.createdAt,
    })),
    notes: notes.map((n) => ({
      id: n.id,
      body: n.body,
      author: n.authorId ? (authorName.get(n.authorId) ?? null) : null,
      createdAt: n.createdAt,
    })),
  };
}

export async function addNote(
  ctx: TenantContext,
  candidateId: string,
  body: string
) {
  const c = await getVisible(ctx, candidateId);

  return prisma.candidateNote.create({
    data: {
      teamId: ctx.team.id,
      tenantCandidateId: c.id,
      authorId: ctx.user.id,
      body,
    },
  });
}

// ---------------------------------------------------------------------------
// Tags and pools
// ---------------------------------------------------------------------------

export async function setTags(
  ctx: TenantContext,
  candidateId: string,
  names: string[]
) {
  const teamId = ctx.team.id;
  const c = await getVisible(ctx, candidateId);
  const wanted = Array.from(
    new Set(names.map((n) => n.trim()).filter(Boolean))
  );

  await prisma.$transaction(async (tx) => {
    const tags: { id: string }[] = [];

    for (const name of wanted) {
      tags.push(
        await tx.candidateTag.upsert({
          where: { teamId_name: { teamId, name } },
          create: { teamId, name },
          update: {},
        })
      );
    }

    await tx.candidateTagLink.deleteMany({
      where: { teamId, tenantCandidateId: c.id },
    });
    await tx.candidateTagLink.createMany({
      data: tags.map((t) => ({ teamId, tenantCandidateId: c.id, tagId: t.id })),
    });
  });
}

export const listTags = (teamId: string) =>
  prisma.candidateTag.findMany({ where: { teamId }, orderBy: { name: 'asc' } });

export const listPools = (teamId: string) =>
  prisma.talentPool.findMany({
    where: { teamId },
    orderBy: { name: 'asc' },
    include: { _count: { select: { members: true } } },
  });

export async function createPool(
  ctx: TenantContext,
  name: string,
  description?: string
) {
  try {
    return await prisma.talentPool.create({
      data: { teamId: ctx.team.id, name, description },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ApiError(409, 'A pool with this name already exists.');
    }

    throw error;
  }
}

export async function deletePool(ctx: TenantContext, poolId: string) {
  const r = await prisma.talentPool.deleteMany({
    where: { id: poolId, teamId: ctx.team.id },
  });

  if (!r.count) {
    throw new ApiError(404, 'Pool not found.');
  }
}

export async function setPoolMember(
  ctx: TenantContext,
  poolId: string,
  candidateId: string,
  member: boolean
) {
  const teamId = ctx.team.id;
  const pool = await prisma.talentPool.findFirst({
    where: { id: poolId, teamId },
  });

  if (!pool) {
    throw new ApiError(404, 'Pool not found.');
  }

  const c = await getVisible(ctx, candidateId);

  if (member) {
    await prisma.talentPoolMember.createMany({
      data: [{ teamId, poolId, tenantCandidateId: c.id, addedBy: ctx.user.id }],
      skipDuplicates: true,
    });
  } else {
    await prisma.talentPoolMember.deleteMany({
      where: { teamId, poolId, tenantCandidateId: c.id },
    });
  }
}

// ---------------------------------------------------------------------------
// CSV import / export
// ---------------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function importCandidates(
  ctx: TenantContext,
  csv: string,
  opts: { poolId?: string } = {}
) {
  const teamId = ctx.team.id;

  if (csv.length > MAX_IMPORT_BYTES) {
    throw new ApiError(413, 'The CSV file is too large (max 1 MB).');
  }

  const rows = parseCsv(csv);

  if (rows.length < 2) {
    throw new ApiError(
      422,
      'The CSV needs a header row and at least one candidate.'
    );
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (n: string) => header.indexOf(n);

  if (col('email') < 0 || col('name') < 0) {
    throw new ApiError(422, 'The CSV header must contain "name" and "email".');
  }

  if (rows.length - 1 > MAX_IMPORT_ROWS) {
    throw new ApiError(
      422,
      `At most ${MAX_IMPORT_ROWS} rows can be imported at once.`
    );
  }

  if (opts.poolId) {
    const pool = await prisma.talentPool.findFirst({
      where: { id: opts.poolId, teamId },
    });

    if (!pool) {
      throw new ApiError(404, 'Pool not found.');
    }
  }

  const result = {
    created: 0,
    skipped: 0,
    errors: [] as { row: number; message: string }[],
  };

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[col('name')] ?? '').trim().slice(0, 120);
    const email = (r[col('email')] ?? '').trim().toLowerCase();
    const phone =
      col('phone') >= 0 ? (r[col('phone')] ?? '').trim().slice(0, 30) : '';
    const tags =
      col('tags') >= 0
        ? (r[col('tags')] ?? '')
            .split(/[;|]/)
            .map((t) => t.trim().slice(0, 40))
            .filter(Boolean)
        : [];

    if (!name || !EMAIL.test(email) || email.length > 254) {
      result.errors.push({
        row: i + 1,
        message: 'Name and a valid email are required.',
      });
      continue;
    }

    const existing = await prisma.tenantCandidate.findFirst({
      where: { teamId, email },
    });

    if (existing) {
      result.skipped++;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const c = await tx.tenantCandidate.create({
        data: { teamId, name, email, phone: phone || null, source: 'import' },
      });

      for (const tag of Array.from(new Set(tags))) {
        const t = await tx.candidateTag.upsert({
          where: { teamId_name: { teamId, name: tag } },
          create: { teamId, name: tag },
          update: {},
        });

        await tx.candidateTagLink.create({
          data: { teamId, tenantCandidateId: c.id, tagId: t.id },
        });
      }

      if (opts.poolId) {
        await tx.talentPoolMember.create({
          data: {
            teamId,
            poolId: opts.poolId,
            tenantCandidateId: c.id,
            addedBy: ctx.user.id,
          },
        });
      }
    });
    result.created++;
  }

  return result;
}

export async function exportCandidatesCsv(ctx: TenantContext, ids?: string[]) {
  const base = await visibleCandidateWhere(ctx);
  const rows = await prisma.tenantCandidate.findMany({
    where: {
      AND: [base, ...(ids?.length ? [{ id: { in: ids } }] : [])],
      teamId: ctx.team.id,
    },
    include: listInclude,
    orderBy: { createdAt: 'asc' },
    take: 10000,
  });

  return {
    count: rows.length,
    csv: toCsv(
      [
        'name',
        'email',
        'phone',
        'source',
        'tags',
        'applications',
        'created_at',
      ],
      rows.map((c) => [
        c.name,
        c.email,
        c.phone ?? '',
        c.source,
        c.tagLinks.map((l) => l.tag.name).join(';'),
        c._count.applications,
        c.createdAt.toISOString(),
      ])
    ),
  };
}

// ---------------------------------------------------------------------------
// Duplicates and merge
// ---------------------------------------------------------------------------

const digits = (s: string | null) => (s ?? '').replace(/\D/g, '');
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Candidate pairs that look like the same person (same phone or same name). */
export async function findDuplicates(ctx: TenantContext) {
  const base = await visibleCandidateWhere(ctx);
  const rows = await prisma.tenantCandidate.findMany({
    where: { AND: [base], teamId: ctx.team.id },
    select: { id: true, name: true, email: true, phone: true, createdAt: true },
    take: 5000,
    orderBy: { createdAt: 'asc' },
  });

  const groups = new Map<string, typeof rows>();
  const add = (key: string, row: (typeof rows)[number]) =>
    groups.set(key, [...(groups.get(key) ?? []), row]);

  for (const r of rows) {
    if (digits(r.phone).length >= 7) {
      add(`phone:${digits(r.phone).slice(-10)}`, r);
    }

    if (normName(r.name).length >= 5) {
      add(`name:${normName(r.name)}`, r);
    }
  }

  const seen = new Set<string>();
  const out: { reason: string; candidates: (typeof rows)[number][] }[] = [];

  groups.forEach((list, key) => {
    if (list.length < 2) {
      return;
    }

    const sig = list
      .map((x) => x.id)
      .sort()
      .join(',');

    if (!seen.has(sig)) {
      seen.add(sig);
      out.push({ reason: key.split(':')[0], candidates: list });
    }
  });

  return out;
}

/**
 * Merges `sourceId` into `targetId` in one transaction. Notes, tags, pool
 * memberships and non-conflicting applications move to the target. An
 * application to a job the target also applied to stays on the (hidden) source
 * record so no history is lost.
 */
export async function mergeCandidates(
  ctx: TenantContext,
  sourceId: string,
  targetId: string
) {
  const teamId = ctx.team.id;

  if (sourceId === targetId) {
    throw new ApiError(400, 'Choose two different candidates.');
  }

  const [source, target] = await Promise.all([
    getVisible(ctx, sourceId),
    getVisible(ctx, targetId),
  ]);

  return prisma.$transaction(async (tx) => {
    const targetJobs = (
      await tx.jobApplication.findMany({
        where: { teamId, tenantCandidateId: target.id },
        select: { jobId: true },
      })
    ).map((a) => a.jobId);

    const moved = await tx.jobApplication.updateMany({
      where: {
        teamId,
        tenantCandidateId: source.id,
        jobId: { notIn: targetJobs },
      },
      data: { tenantCandidateId: target.id },
    });

    await tx.candidateNote.updateMany({
      where: { teamId, tenantCandidateId: source.id },
      data: { tenantCandidateId: target.id },
    });

    const have = new Set(
      (
        await tx.candidateTagLink.findMany({
          where: { teamId, tenantCandidateId: target.id },
          select: { tagId: true },
        })
      ).map((l) => l.tagId)
    );

    for (const link of await tx.candidateTagLink.findMany({
      where: { teamId, tenantCandidateId: source.id },
    })) {
      if (have.has(link.tagId)) {
        await tx.candidateTagLink.deleteMany({
          where: { teamId, id: link.id },
        });
      } else {
        await tx.candidateTagLink.updateMany({
          where: { teamId, id: link.id },
          data: { tenantCandidateId: target.id },
        });
      }
    }

    const inPools = new Set(
      (
        await tx.talentPoolMember.findMany({
          where: { teamId, tenantCandidateId: target.id },
          select: { poolId: true },
        })
      ).map((m) => m.poolId)
    );

    for (const m of await tx.talentPoolMember.findMany({
      where: { teamId, tenantCandidateId: source.id },
    })) {
      if (inPools.has(m.poolId)) {
        await tx.talentPoolMember.deleteMany({ where: { teamId, id: m.id } });
      } else {
        await tx.talentPoolMember.updateMany({
          where: { teamId, id: m.id },
          data: { tenantCandidateId: target.id },
        });
      }
    }

    await tx.tenantCandidate.update({
      where: { id: target.id, teamId },
      data: { phone: target.phone ?? source.phone ?? null },
    });
    await tx.tenantCandidate.update({
      where: { id: source.id, teamId },
      data: { mergedIntoId: target.id },
    });

    return {
      targetId: target.id,
      sourceId: source.id,
      movedApplications: moved.count,
    };
  });
}
