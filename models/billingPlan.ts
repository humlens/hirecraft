import { isPlan, PLANS, type Plan } from '@/lib/entitlements';
import { prisma, unguardedPrisma } from '@/lib/prisma';

/** The plan named by a Stripe price (`metadata.plan`), if it is one of ours. */
export const planOfPrice = (metadata: unknown): Plan | null => {
  const p = (metadata as { plan?: string } | null)?.plan;

  return isPlan(p) ? p : null;
};

/**
 * Recomputes a portal's plan from its active Stripe subscriptions: the highest
 * plan among them, or Free when none is active (a cancelled subscription keeps
 * its plan until Stripe ends it at the period end, and no data is deleted).
 */
export async function syncTeamPlan(customerId: string) {
  const team = await unguardedPrisma.team.findFirst({
    where: { billingId: customerId },
    select: { id: true },
  });

  if (!team) return null;

  const subs = await prisma.subscription.findMany({
    where: { customerId, active: true },
  });
  const prices = await prisma.price.findMany({
    where: { id: { in: subs.map((s) => s.priceId) } },
    select: { id: true, metadata: true },
  });
  const plans = prices
    .map((p) => planOfPrice(p.metadata))
    .filter((p): p is Plan => !!p);
  const best =
    plans.sort((a, b) => PLANS.indexOf(b) - PLANS.indexOf(a))[0] ?? 'free';

  await unguardedPrisma.team.update({
    where: { id: team.id },
    data: { planKey: best },
  });

  return { teamId: team.id, plan: best };
}

/** The first failure starts the 7-day grace period; later retries do not restart it. */
export async function markPaymentFailed(customerId: string) {
  await unguardedPrisma.team.updateMany({
    where: { billingId: customerId, paymentFailedAt: null },
    data: { paymentFailedAt: new Date() },
  });
}

export async function markPaymentOk(customerId: string) {
  await unguardedPrisma.team.updateMany({
    where: { billingId: customerId, paymentFailedAt: { not: null } },
    data: { paymentFailedAt: null },
  });
}
