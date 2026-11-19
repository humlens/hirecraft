import { Prisma } from '@prisma/client';
import { embedTexts, toVectorLiteral } from '@/lib/ai/embeddings';
import { searchFiltersSchema, type SearchFilters } from '@/lib/ai/features';
import { runAIFeature } from '@/lib/ai/run';
import { ApiError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import type { TenantContext } from '@/lib/tenant';
import { visibleCandidateWhere } from 'models/talent';
import { aiContext } from './context';
import { experienceYears } from './resumeParse';
import { normSkill } from './match';

const RRF_K = 60;

/** Reciprocal Rank Fusion: score = sum over lists of 1 / (k + rank). */
export function rrf(lists: string[][]) {
  const score = new Map<string, number>();

  for (const list of lists) {
    list.forEach((id, i) =>
      score.set(id, (score.get(id) ?? 0) + 1 / (RRF_K + i + 1))
    );
  }

  return score;
}

const textQuery = (f: SearchFilters, raw: string) => {
  const words = [...f.skills, ...f.keywords];

  return (words.length ? words : raw.split(/\s+/).filter((w) => w.length > 2))
    .map((w) => w.replace(/[^\w+#.]/g, ' ').trim())
    .filter(Boolean)
    .join(' or ');
};

/**
 * Hybrid talent search over the candidates THIS member may see:
 *   natural language -> structured filters (shown as removable chips)
 *   rank = RRF( full-text rank, vector similarity, filter boosts )
 * `filters` can be passed back by the UI after the user removed a chip; then
 * the language model is not called again.
 */
export async function searchTalent(
  ctx: TenantContext,
  input: { query?: string; filters?: SearchFilters; limit: number }
) {
  const teamId = ctx.team.id;
  const raw = (input.query ?? '').trim();
  let filters: SearchFilters;
  let parsedByAI = false;

  if (input.filters) {
    filters = searchFiltersSchema.parse(input.filters);
  } else if (raw) {
    filters = (
      await runAIFeature(aiContext(ctx), 'search.parse', { query: raw })
    ).data;
    parsedByAI = true;
  } else {
    throw new ApiError(422, 'Enter a search query.');
  }

  // 1. candidates visible to this member, with a profile
  const base = await visibleCandidateWhere(ctx);
  const visible = await prisma.tenantCandidate.findMany({
    where: { AND: [base, { userId: { not: null } }], teamId },
    select: { id: true, userId: true, name: true, email: true },
    take: 5000,
  });
  const userIds = visible.map((v) => v.userId as string);

  if (!userIds.length) {
    return { filters, parsedByAI, results: [] };
  }

  const queryForText = [raw, ...filters.skills, ...filters.keywords]
    .join(' ')
    .trim();

  // 2a. full-text ranking
  const tsq = textQuery(filters, raw);
  const fts = tsq
    ? await prisma.$queryRaw<{ userId: string; r: number }[]>`
        SELECT p."userId", ts_rank(p.search, websearch_to_tsquery('english', ${tsq})) r
        FROM "CandidateProfile" p
        WHERE p."userId" IN (${Prisma.join(userIds)})
          AND p.search @@ websearch_to_tsquery('english', ${tsq})
        ORDER BY r DESC LIMIT 100`
    : [];

  // 2b. vector ranking (degrades to full-text only if embeddings are unavailable)
  let vec: { userId: string; sim: number }[] = [];
  let vectorUsed = false;

  if (queryForText) {
    try {
      const [qv] = await embedTexts({ teamId, userId: ctx.user.id }, [
        queryForText,
      ]);

      vec = await prisma.$queryRaw<{ userId: string; sim: number }[]>`
        SELECT p."userId", 1 - (p.embedding <=> ${toVectorLiteral(qv)}::vector) sim
        FROM "CandidateProfile" p
        WHERE p."userId" IN (${Prisma.join(userIds)}) AND p.embedding IS NOT NULL
        ORDER BY p.embedding <=> ${toVectorLiteral(qv)}::vector LIMIT 100`;
      vectorUsed = true;
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        ![402, 403, 429, 501, 502, 503].includes(error.status)
      ) {
        throw error;
      }
    }
  }

  // 2c. structured filters as boosts
  const profiles = await prisma.candidateProfile.findMany({
    where: { userId: { in: userIds } },
    select: {
      userId: true,
      headline: true,
      location: true,
      preferredLocations: true,
      updatedAt: true,
      skills: { select: { skill: true } },
      experiences: {
        select: { startDate: true, endDate: true, current: true },
      },
    },
  });
  const wanted = filters.skills.map(normSkill);
  const boosts = profiles
    .map((p) => {
      const have = new Set(p.skills.map((s) => normSkill(s.skill)));
      const matched = wanted.filter((w) => have.has(w)).length;
      const years = experienceYears(
        p.experiences.map((e) => ({
          start: e.startDate,
          end: e.endDate,
          current: e.current,
        }))
      );
      let boost = matched;

      if (
        filters.location &&
        [p.location, ...p.preferredLocations].some(
          (l) => l && l.toLowerCase().includes(filters.location!.toLowerCase())
        )
      )
        boost += 1;
      if (filters.minYears != null && years >= filters.minYears) boost += 1;
      if (filters.maxYears != null && years <= filters.maxYears) boost += 0.5;

      return { userId: p.userId, boost, matched, years, p };
    })
    .filter((b) => b.boost > 0)
    .sort((a, b) => b.boost - a.boost);

  const fused = rrf([
    fts.map((x) => x.userId),
    vec.map((x) => x.userId),
    boosts.map((b) => b.userId),
  ]);
  const ranked = Array.from(fused.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, input.limit);
  const byUser = new Map(visible.map((v) => [v.userId as string, v]));
  const prof = new Map(profiles.map((p) => [p.userId, p]));
  const ftsRank = new Map(fts.map((x, i) => [x.userId, i + 1]));
  const vecRank = new Map(vec.map((x, i) => [x.userId, i + 1]));
  const maxFts = Math.max(1e-9, ...fts.map((x) => x.r));
  const ftsScore = new Map(
    fts.map((x) => [x.userId, Math.round((x.r / maxFts) * 100)])
  );
  const vecScore = new Map(
    vec.map((x) => [
      x.userId,
      Math.max(0, Math.min(100, Math.round(x.sim * 100))),
    ])
  );
  const maxBoost = Math.max(1, ...boosts.map((b) => b.boost));

  return {
    filters,
    parsedByAI,
    vectorUsed,
    results: ranked.map(([userId, score]) => {
      const c = byUser.get(userId) as NonNullable<
        ReturnType<typeof byUser.get>
      >;
      const p = prof.get(userId);
      const b = boosts.find((x) => x.userId === userId);
      const keyword = ftsScore.get(userId) ?? null;
      const semantic = vecScore.get(userId) ?? null;
      const fit = b ? Math.round((b.boost / maxBoost) * 100) : null;
      // Blend of the signals that exist for this candidate (all 0-100)
      const parts = [keyword, semantic, fit].filter(
        (v): v is number => v != null
      );
      const relevance = parts.length
        ? Math.round(parts.reduce((a, v) => a + v, 0) / parts.length)
        : 0;

      return {
        candidateId: c.id,
        name: c.name,
        email: c.email,
        headline: p?.headline ?? null,
        location: p?.location ?? null,
        skills: (p?.skills ?? []).map((s) => s.skill),
        matchedSkills: b?.matched ?? 0,
        years: b?.years ?? null,
        score: Math.round(score * 10000) / 10000,
        scores: { relevance, keyword, semantic, fit },
        lastActiveAt: p?.updatedAt ?? null,
        why: {
          fullText: ftsRank.get(userId) ?? null,
          vector: vecRank.get(userId) ?? null,
          filterBoost: b?.boost ?? 0,
        },
      };
    }),
  };
}
