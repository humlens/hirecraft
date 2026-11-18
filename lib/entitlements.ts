import { ApiError } from './errors';
import { prisma, unguardedPrisma } from './prisma';

/**
 * Plans, limits and features, enforced on the server.
 *
 * The plan of a portal comes from its Stripe price (`metadata.plan`, kept in
 * `Team.planKey` by the billing webhook) or a platform-admin override. Code
 * defaults below can be changed per plan by the platform admin (PlanEntitlement).
 *
 * Enforcement is on when billing is set up (STRIPE_SECRET_KEY) or when
 * ENTITLEMENTS_ENFORCEMENT=on. A self-hosted install without billing has no
 * limits unless you turn it on. ENTITLEMENTS_ENFORCEMENT=off always disables it.
 */
export const PLANS = ['free', 'starter', 'professional', 'enterprise'] as const;
export type Plan = (typeof PLANS)[number];

export const LIMIT_KEYS = [
  'activeJobs',
  'seats',
  'aiCreditsPerMonth',
  'storageGb',
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
/** null = unlimited */
export type Limits = Record<LimitKey, number | null>;

export const FEATURE_KEYS = [
  'ai.assist', // JD generator, search, interview assistant, message drafts
  'ai.match',
  'ai.copilot',
  'automation',
  'branding',
  'integrations', // calendar + video
  'integrations.advanced', // assessments, background checks
  'customRoles',
  'customDomain',
  'sso',
  'scim',
  'api',
  'byoKey',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const PLAN_LABELS: Record<Plan, string> = {
  free: 'Free',
  starter: 'Starter',
  professional: 'Professional',
  enterprise: 'Enterprise',
};

export const LIMIT_LABELS: Record<LimitKey, string> = {
  activeJobs: 'active jobs',
  seats: 'team seats',
  aiCreditsPerMonth: 'AI credits per month',
  storageGb: 'GB of candidate storage',
};

const STARTER: FeatureKey[] = ['ai.assist'];
const PRO: FeatureKey[] = [
  ...STARTER,
  'ai.match',
  'ai.copilot',
  'automation',
  'branding',
  'integrations',
];
const ENT: FeatureKey[] = [
  ...PRO,
  'integrations.advanced',
  'customRoles',
  'customDomain',
  'sso',
  'scim',
  'api',
  'byoKey',
];

export const DEFAULT_ENTITLEMENTS: Record<
  Plan,
  { limits: Limits; features: FeatureKey[] }
> = {
  free: {
    limits: { activeJobs: 2, seats: 2, aiCreditsPerMonth: 500, storageGb: 1 },
    features: STARTER,
  },
  starter: {
    limits: { activeJobs: 5, seats: 5, aiCreditsPerMonth: 5000, storageGb: 5 },
    features: STARTER,
  },
  professional: {
    limits: {
      activeJobs: 15,
      seats: 10,
      aiCreditsPerMonth: 50000,
      storageGb: 25,
    },
    features: PRO,
  },
  enterprise: {
    limits: {
      activeJobs: null,
      seats: null,
      aiCreditsPerMonth: 500000,
      storageGb: 500,
    },
    features: ENT,
  },
};

/** The cheapest plan that has a feature or a bigger limit (for the upgrade hint). */
const planRank = (p: string) => PLANS.indexOf(p as Plan);

export const isPlan = (p: string | null | undefined): p is Plan =>
  !!p && (PLANS as readonly string[]).includes(p);

export const enforcementOn = () => {
  const v = (process.env.ENTITLEMENTS_ENFORCEMENT || '').toLowerCase();

  if (v === 'off') return false;
  if (v === 'on') return true;

  return !!process.env.STRIPE_SECRET_KEY;
};

/** Days after the first failed payment before the portal turns read-only. */
export const GRACE_DAYS = 7;

// --- plan definitions (code defaults + platform overrides) ------------------

let cache: {
  at: number;
  rows: Map<string, { limits: Limits; features: FeatureKey[] }>;
} | null = null;

export const clearEntitlementCache = () => {
  cache = null;
};

export async function getPlanDefinition(plan: Plan) {
  if (!cache || Date.now() - cache.at > 30_000) {
    const rows = await prisma.planEntitlement.findMany();

    cache = {
      at: Date.now(),
      rows: new Map(
        rows.map((r) => [
          r.plan,
          {
            limits: r.limits as Limits,
            features: r.features as FeatureKey[],
          },
        ])
      ),
    };
  }

  const base = DEFAULT_ENTITLEMENTS[plan];
  const row = cache.rows.get(plan);

  return {
    limits: { ...base.limits, ...(row?.limits ?? {}) } as Limits,
    features: (row?.features ?? base.features) as FeatureKey[],
  };
}

// --- a portal's plan and lifecycle ------------------------------------------

export type PlanState = {
  plan: Plan;
  /** payment failed less than GRACE_DAYS ago */
  inGrace: boolean;
  graceEndsAt: Date | null;
  /** payment failed more than GRACE_DAYS ago: writes are refused */
  readOnly: boolean;
};

type TeamPlanFields = {
  planKey: string;
  planOverride: string | null;
  paymentFailedAt: Date | null;
};

export function planStateOf(team: TeamPlanFields, now = new Date()): PlanState {
  const plan = isPlan(team.planOverride)
    ? team.planOverride
    : isPlan(team.planKey)
      ? team.planKey
      : 'free';
  const failed = team.paymentFailedAt;
  const graceEndsAt = failed
    ? new Date(failed.getTime() + GRACE_DAYS * 86400_000)
    : null;
  const readOnly = !!graceEndsAt && now >= graceEndsAt && !team.planOverride;

  return {
    plan,
    graceEndsAt,
    inGrace: !!graceEndsAt && now < graceEndsAt && !team.planOverride,
    readOnly,
  };
}

export async function getPlanState(teamId: string) {
  const team = await unguardedPrisma.team.findUnique({
    where: { id: teamId },
    select: { planKey: true, planOverride: true, paymentFailedAt: true },
  });

  if (!team) {
    throw new ApiError(404, 'Portal not found.');
  }

  return planStateOf(team);
}

// --- usage ------------------------------------------------------------------

export const monthStart = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

export async function measure(teamId: string, key: LimitKey): Promise<number> {
  switch (key) {
    case 'activeJobs':
      return prisma.job.count({
        where: {
          teamId,
          deletedAt: null,
          status: { in: ['PUBLISHED', 'SCHEDULED'] },
        },
      });
    case 'seats': {
      const [members, invites] = await Promise.all([
        prisma.teamMember.count({ where: { teamId } }),
        unguardedPrisma.invitation.count({
          where: {
            teamId,
            expires: { gt: new Date() },
            sentViaEmail: true,
            email: { not: null },
          },
        }),
      ]);

      return members + invites;
    }
    case 'aiCreditsPerMonth': {
      const r = await prisma.aIUsage.aggregate({
        where: { teamId, status: 'OK', createdAt: { gte: monthStart() } },
        _sum: { credits: true },
      });

      return r._sum.credits ?? 0;
    }
    case 'storageGb': {
      const rows = await unguardedPrisma.$queryRaw<{ bytes: bigint | null }[]>`
        SELECT COALESCE(SUM(r."size"), 0) AS bytes
        FROM "JobApplication" a JOIN "CandidateResume" r ON r.id = a."resumeId"
        WHERE a."teamId" = ${teamId}`;

      return (
        Math.round((Number(rows[0]?.bytes ?? 0) / 1024 ** 3) * 1000) / 1000
      );
    }
  }
}

export async function getEntitlements(teamId: string) {
  const state = await getPlanState(teamId);
  const def = await getPlanDefinition(state.plan);

  return { ...state, ...def };
}

/** Everything the billing page needs: plan, limits, usage, lifecycle. */
export async function getPlanOverview(teamId: string) {
  const e = await getEntitlements(teamId);
  const usage = Object.fromEntries(
    await Promise.all(
      LIMIT_KEYS.map(async (k) => [k, await measure(teamId, k)] as const)
    )
  ) as Record<LimitKey, number>;

  return {
    plan: e.plan,
    label: PLAN_LABELS[e.plan],
    limits: e.limits,
    features: e.features,
    usage,
    lifecycle: {
      inGrace: e.inGrace,
      graceEndsAt: e.graceEndsAt,
      readOnly: e.readOnly,
    },
    enforced: enforcementOn(),
  };
}

// --- enforcement ------------------------------------------------------------

const upgradeTargetForFeature = (f: FeatureKey): Plan =>
  PLANS.find((p) => DEFAULT_ENTITLEMENTS[p].features.includes(f)) ??
  'enterprise';

export type EntitlementSpec =
  { feature: FeatureKey } | { limit: LimitKey; adding?: number };

/**
 * Throws 402 with an upgrade hint when the portal's plan does not allow the
 * feature, or when adding `adding` (default 1) would exceed the limit.
 */
export async function assertEntitlement(teamId: string, spec: EntitlementSpec) {
  if (!enforcementOn()) return;

  const e = await getEntitlements(teamId);

  if ('feature' in spec) {
    if (e.features.includes(spec.feature)) return;

    const need = upgradeTargetForFeature(spec.feature);

    throw new ApiError(
      402,
      `Your ${PLAN_LABELS[e.plan]} plan does not include this feature. Upgrade to ${PLAN_LABELS[need]} to use it.`,
      {
        code: 'plan_feature',
        feature: spec.feature,
        plan: e.plan,
        upgradeTo: need,
      }
    );
  }

  const limit = e.limits[spec.limit];

  if (limit === null) return;

  const used = await measure(teamId, spec.limit);

  if (used + (spec.adding ?? 1) <= limit) return;

  const need = PLANS.find(
    (p) =>
      planRank(p) > planRank(e.plan) &&
      (limitRank(DEFAULT_ENTITLEMENTS[p].limits[spec.limit]) ?? Infinity) >
        limit
  );

  throw new ApiError(
    402,
    `Your ${PLAN_LABELS[e.plan]} plan allows ${limit} ${LIMIT_LABELS[spec.limit]} and you are using ${used}.${need ? ` Upgrade to ${PLAN_LABELS[need]} for more.` : ''}`,
    {
      code: 'plan_limit',
      limit: spec.limit,
      allowed: limit,
      used,
      plan: e.plan,
      upgradeTo: need ?? null,
    }
  );
}

// null (unlimited) sorts above any number
const limitRank = (v: number | null) => (v === null ? Infinity : v);

/** Writes are refused once the grace period after a failed payment is over. */
export function assertWritableState(state: PlanState) {
  if (enforcementOn() && state.readOnly) {
    throw new ApiError(
      402,
      'This portal is read-only because a payment failed. Update your payment method on the billing page to continue.',
      { code: 'read_only' }
    );
  }
}

/**
 * Can the portal move to `target` without exceeding its limits? Used before a
 * downgrade is started; the answer lists what to close or remove first.
 */
export async function checkDowngrade(teamId: string, target: Plan) {
  const def = await getPlanDefinition(target);
  const blockers: { limit: LimitKey; used: number; allowed: number }[] = [];

  for (const k of LIMIT_KEYS) {
    const allowed = def.limits[k];

    if (allowed === null || k === 'aiCreditsPerMonth') continue; // credits reset monthly

    const used = await measure(teamId, k);

    if (used > allowed) blockers.push({ limit: k, used, allowed });
  }

  return { allowed: blockers.length === 0, blockers };
}

// --- metering ---------------------------------------------------------------

/** Adds to a monthly counter (for example jobs published, applications received). */
export async function recordUsage(teamId: string, metric: string, delta = 1) {
  try {
    const periodStart = monthStart();

    await prisma.usageCounter.upsert({
      where: { teamId_metric_periodStart: { teamId, metric, periodStart } },
      create: { teamId, metric, periodStart, value: delta },
      update: { value: { increment: delta } },
    });
  } catch (error) {
    console.error('recordUsage failed', error);
  }
}

/**
 * Nightly reconciliation: sets the gauges (active jobs, seats, storage, AI
 * credits) from the source tables so the counters cannot drift. Idempotent.
 */
export async function reconcileUsage(now = new Date()) {
  const periodStart = monthStart(now);
  const teams = await unguardedPrisma.team.findMany({ select: { id: true } });
  let rows = 0;

  for (const t of teams) {
    for (const k of LIMIT_KEYS) {
      const value = await measure(t.id, k);

      await prisma.usageCounter.upsert({
        where: {
          teamId_metric_periodStart: { teamId: t.id, metric: k, periodStart },
        },
        create: { teamId: t.id, metric: k, periodStart, value },
        update: { value },
      });
      rows++;
    }
  }

  return { teams: teams.length, rows };
}
