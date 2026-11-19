/** Plan names, limits and default entitlements. Pure data: safe in the browser. */
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
