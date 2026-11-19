import { z } from 'zod';
import { route, queryWithout } from '@/lib/apiRoute';
import {
  checkDowngrade,
  getPlanOverview,
  isPlan,
  LIMIT_LABELS,
  PLAN_LABELS,
  PLANS,
  DEFAULT_ENTITLEMENTS,
  getPlanDefinition,
} from '@/lib/entitlements';
import env from '@/lib/env';
import { prisma } from '@/lib/prisma';
import { requireTenantContext } from '@/lib/tenant';
import { validateWithSchema } from '@/lib/zod';

// The portal's plan, limits, usage and billing lifecycle. Any member may read it
// (it contains no secrets); `?target=<plan>` previews a change.
export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, { allowReadOnly: true });
    const q = validateWithSchema(
      z.object({ target: z.string().max(20).optional() }),
      queryWithout(req, 'slug')
    );
    const overview = await getPlanOverview(ctx.team.id);
    const sub = ctx.team.billingId
      ? await prisma.subscription.findFirst({
          where: { customerId: ctx.team.billingId, active: true },
          orderBy: { endDate: 'desc' },
        })
      : null;
    const plans = await Promise.all(
      PLANS.map(async (p) => ({
        key: p,
        label: PLAN_LABELS[p],
        ...(await getPlanDefinition(p)),
      }))
    );

    res.status(200).json({
      data: {
        ...overview,
        limitLabels: LIMIT_LABELS,
        salesUrl: env.salesContactUrl || null,
        plans,
        defaults: DEFAULT_ENTITLEMENTS,
        subscription: sub && {
          renewsAt: sub.endDate,
          cancelAt: sub.cancelAt,
        },
        ...(q.target && isPlan(q.target)
          ? {
              change: {
                target: q.target,
                ...(await checkDowngrade(ctx.team.id, q.target)),
              },
            }
          : {}),
      },
    });
  },
});
