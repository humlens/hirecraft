import { z } from 'zod';
import { route } from '@/lib/apiRoute';
import {
  clearEntitlementCache,
  DEFAULT_ENTITLEMENTS,
  FEATURE_KEYS,
  getPlanDefinition,
  isPlan,
  LIMIT_KEYS,
  PLAN_LABELS,
  PLANS,
} from '@/lib/entitlements';
import { ApiError } from '@/lib/errors';
import { logPlatformAction, requirePlatformAdmin } from '@/lib/platformAdmin';
import { prisma } from '@/lib/prisma';
import { validateWithSchema } from '@/lib/zod';

const limit = z.number().int().min(0).max(100_000_000).nullable();
const putSchema = z.object({
  plan: z.string(),
  limits: z.object(
    Object.fromEntries(LIMIT_KEYS.map((k) => [k, limit])) as Record<
      (typeof LIMIT_KEYS)[number],
      typeof limit
    >
  ),
  features: z.array(z.enum(FEATURE_KEYS)).max(FEATURE_KEYS.length),
});

// Plan limits and features. The platform admin edits them; code defaults fill the gaps.
export default route({
  GET: async (req, res) => {
    await requirePlatformAdmin(req, res);

    res.status(200).json({
      data: {
        limitKeys: LIMIT_KEYS,
        featureKeys: FEATURE_KEYS,
        plans: await Promise.all(
          PLANS.map(async (p) => ({
            key: p,
            label: PLAN_LABELS[p],
            defaults: DEFAULT_ENTITLEMENTS[p],
            current: await getPlanDefinition(p),
          }))
        ),
      },
    });
  },
  PUT: async (req, res) => {
    const admin = await requirePlatformAdmin(req, res);
    const input = validateWithSchema(putSchema, req.body);

    if (!isPlan(input.plan)) {
      throw new ApiError(422, 'Unknown plan.');
    }

    await prisma.planEntitlement.upsert({
      where: { plan: input.plan },
      create: {
        plan: input.plan,
        limits: input.limits,
        features: input.features,
      },
      update: { limits: input.limits, features: input.features },
    });
    clearEntitlementCache();
    await logPlatformAction(admin, 'plan.update', null, {
      plan: input.plan,
      limits: input.limits,
      features: input.features,
    });
    res.status(200).json({ data: await getPlanDefinition(input.plan) });
  },
});
