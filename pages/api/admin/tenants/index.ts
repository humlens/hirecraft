import { z } from 'zod';
import { route } from '@/lib/apiRoute';
import {
  LIMIT_KEYS,
  measure,
  monthStart,
  planStateOf,
  PLAN_LABELS,
  getPlanDefinition,
} from '@/lib/entitlements';
import { requirePlatformAdmin } from '@/lib/platformAdmin';
import { unguardedPrisma } from '@/lib/prisma';
import { validateWithSchema } from '@/lib/zod';

// All portals with plan, usage and status, plus the headline numbers.
export default route({
  GET: async (req, res) => {
    await requirePlatformAdmin(req, res);

    const { q, page } = validateWithSchema(
      z.object({
        q: z.string().trim().max(100).optional(),
        page: z.coerce.number().int().min(1).max(1000).default(1),
      }),
      req.query
    );
    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { slug: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const [teams, total, active, paid, issues, credits] = await Promise.all([
      unguardedPrisma.team.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * 50,
        take: 50,
        include: {
          members: {
            where: { role: 'OWNER' },
            take: 1,
            include: { user: { select: { name: true, email: true } } },
          },
        },
      }),
      unguardedPrisma.team.count({ where }),
      unguardedPrisma.team.count({ where: { status: 'ACTIVE' } }),
      unguardedPrisma.team.count({
        where: {
          OR: [{ planKey: { not: 'free' } }, { planOverride: { not: null } }],
        },
      }),
      unguardedPrisma.team.count({ where: { paymentFailedAt: { not: null } } }),
      unguardedPrisma.aIUsage.aggregate({
        where: { status: 'OK', createdAt: { gte: monthStart() } },
        _sum: { credits: true },
      }),
    ]);

    const usedByTeam = new Map(
      (
        await unguardedPrisma.aIUsage.groupBy({
          by: ['teamId'],
          where: {
            status: 'OK',
            createdAt: { gte: monthStart() },
            teamId: { in: teams.map((t) => t.id) },
          },
          _sum: { credits: true },
        })
      ).map((r) => [r.teamId, r._sum.credits ?? 0])
    );
    const rows = await Promise.all(
      teams.map(async (t) => {
        const state = planStateOf(t);
        const limits = (await getPlanDefinition(state.plan)).limits;
        const usage = Object.fromEntries(
          await Promise.all(
            LIMIT_KEYS.map(async (k) => [k, await measure(t.id, k)] as const)
          )
        );

        return {
          id: t.id,
          name: t.name,
          slug: t.slug,
          owner: t.members[0]?.user ?? null,
          plan: state.plan,
          planLabel: PLAN_LABELS[state.plan],
          planOverride: t.planOverride,
          status: t.status,
          suspendedReason: t.suspendedReason,
          paymentIssue: !!t.paymentFailedAt,
          readOnly: state.readOnly,
          usage,
          limits,
          aiCreditsUsed: usedByTeam.get(t.id) ?? 0,
          createdAt: t.createdAt,
        };
      })
    );

    res.status(200).json({
      data: {
        total,
        stats: {
          activePortals: active,
          paidPlans: paid,
          paymentIssues: issues,
          aiCreditsThisMonth: credits._sum.credits ?? 0,
        },
        tenants: rows,
      },
    });
  },
});
