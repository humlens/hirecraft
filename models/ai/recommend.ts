import { Prisma } from '@prisma/client';
import { normSkill } from './match';
import { prisma, unguardedPrisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

/** Portals for which the user's LATEST AI_RECOMMENDATIONS consent is "granted". */
async function consentedTeams(userId: string) {
  const rows = await unguardedPrisma.$queryRaw<{ teamId: string }[]>`
    SELECT "teamId" FROM (
      SELECT DISTINCT ON ("teamId") "teamId", granted, "revokedAt"
      FROM "CandidateConsent"
      WHERE "userId" = ${userId} AND purpose = 'AI_RECOMMENDATIONS'
      ORDER BY "teamId", "grantedAt" DESC
    ) c WHERE granted = true AND "revokedAt" IS NULL`;

  return rows.map((r) => r.teamId);
}

/** Portals the candidate has applied to, with their current recommendation consent. */
export async function listRecommendationConsents(userId: string) {
  const [tcs, granted] = await Promise.all([
    unguardedPrisma.tenantCandidate.findMany({
      where: { userId },
      select: { teamId: true, team: { select: { name: true, slug: true } } },
    }),
    consentedTeams(userId),
  ]);

  return tcs.map((t) => ({
    teamId: t.teamId,
    portal: t.team.name,
    slug: t.team.slug,
    granted: granted.includes(t.teamId),
  }));
}

export async function setRecommendationConsent(
  userId: string,
  teamId: string,
  granted: boolean
) {
  const known = await unguardedPrisma.tenantCandidate.findFirst({
    where: { userId, teamId },
    select: { id: true },
  });

  if (!known) {
    throw new ApiError(404, 'You have not applied to this portal.');
  }

  const team = await unguardedPrisma.team.findUnique({
    where: { id: teamId },
    select: { updatedAt: true },
  });

  // Appended, never edited: the history of consent decisions is kept.
  await unguardedPrisma.candidateConsent.create({
    data: {
      userId,
      teamId,
      purpose: 'AI_RECOMMENDATIONS',
      granted,
      policyVersion: team?.updatedAt.toISOString() ?? 'v1',
    },
  });
}

/**
 * Open jobs of the portals the candidate agreed to, closest to their anonymised
 * profile embedding. "Why it matches" is computed from skills (no model call:
 * nothing about the candidate leaves the server).
 */
export async function recommendForCandidate(userId: string, limit = 10) {
  const teams = await consentedTeams(userId);

  if (!teams.length) {
    return { consented: false, jobs: [] as unknown[] };
  }

  const profile = await prisma.candidateProfile.findUnique({
    where: { userId },
    include: { skills: true },
  });
  const embedded = profile
    ? await prisma.$queryRaw<
        { ok: boolean }[]
      >`SELECT (embedding IS NOT NULL) ok FROM "CandidateProfile" WHERE id = ${profile.id}`
    : [];

  if (!profile || !embedded[0]?.ok) {
    return { consented: true, jobs: [] as unknown[] };
  }

  const rows = await unguardedPrisma.$queryRaw<{ id: string; sim: number }[]>`
    SELECT j.id, 1 - (j.embedding <=> p.embedding) sim
    FROM "Job" j
    JOIN "Team" t ON t.id = j."teamId" AND t.status = 'ACTIVE'
    CROSS JOIN (SELECT embedding FROM "CandidateProfile" WHERE id = ${profile.id}) p
    WHERE j."teamId" IN (${Prisma.join(teams)})
      AND j.embedding IS NOT NULL AND j."deletedAt" IS NULL AND j.visibility = 'PUBLIC'
      AND (j.status = 'PUBLISHED' OR (j.status = 'SCHEDULED' AND j."publishAt" <= now()))
      AND (j."closesAt" IS NULL OR j."closesAt" > now())
      AND NOT EXISTS (
        SELECT 1 FROM "JobApplication" a
        JOIN "TenantCandidate" c ON c.id = a."tenantCandidateId"
        WHERE a."jobId" = j.id AND c."userId" = ${userId})
    ORDER BY j.embedding <=> p.embedding
    LIMIT ${limit}`;

  const jobs = await unguardedPrisma.job.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    select: {
      id: true,
      title: true,
      slug: true,
      workMode: true,
      department: true,
      team: { select: { name: true, slug: true } },
      skills: { select: { skill: true, required: true } },
      locations: { select: { city: true, country: true } },
    },
  });
  const sim = new Map(rows.map((r) => [r.id, r.sim]));
  const mine = new Set(profile.skills.map((s) => normSkill(s.skill)));

  return {
    consented: true,
    jobs: rows
      .map((r) => jobs.find((j) => j.id === r.id)!)
      .filter(Boolean)
      .map((j) => ({
        id: j.id,
        title: j.title,
        slug: j.slug,
        portal: j.team,
        workMode: j.workMode,
        locations: j.locations,
        similarity: Math.round((sim.get(j.id) ?? 0) * 1000) / 1000,
        why: {
          matchedSkills: j.skills
            .filter((s) => mine.has(normSkill(s.skill)))
            .map((s) => s.skill),
          missingSkills: j.skills
            .filter((s) => s.required && !mine.has(normSkill(s.skill)))
            .map((s) => s.skill),
        },
      })),
  };
}
