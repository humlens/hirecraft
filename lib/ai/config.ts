import { enforcementOn, getEntitlements } from '../entitlements';
import { ApiError } from '../errors';
import env from '../env';
import { prisma } from '../prisma';
import { decryptSecret } from './crypto';
import { AnthropicProvider } from './providers/anthropic';
import { fakeProvider } from './providers/fake';
import { GeminiProvider } from './providers/gemini';
import { OpenAIProvider } from './providers/openai';
import type { AIProvider, Tier } from './types';

export const PROVIDER_NAMES = [
  'openai',
  'anthropic',
  'gemini',
  'openai_compatible',
] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number] | 'fake';

/** Default model per provider and tier. Override per portal or with AI_MODEL_FAST / AI_MODEL_STANDARD. */
export const DEFAULT_MODELS: Record<string, Record<Tier, string>> = {
  openai: { fast: 'gpt-4o-mini', standard: 'gpt-4o', best: 'gpt-4.1' },
  anthropic: {
    fast: 'claude-haiku-5-5',
    standard: 'claude-sonnet-5-5',
    best: 'claude-opus-5-5',
  },
  gemini: {
    fast: 'gemini-2.0-flash',
    standard: 'gemini-2.5-flash',
    best: 'gemini-2.5-pro',
  },
  openai_compatible: { fast: 'default', standard: 'default', best: 'default' },
  fake: { fast: 'fake-fast', standard: 'fake-standard', best: 'fake-best' },
};

export type ResolvedAI = {
  providerName: ProviderName;
  provider: AIProvider;
  models: Record<Tier, string>;
  /** true when the portal's own API key is used (no platform credits are charged) */
  ownKey: boolean;
  /** per-feature tier chosen by the portal (defaults come from the feature) */
  tierByFeature: Record<string, Tier>;
  enabledFeatures: Record<string, boolean>;
  logRetentionDays: number;
  monthlyCredits: number;
};

const fakeAllowed = () =>
  process.env.NODE_ENV !== 'production' || process.env.AI_ALLOW_FAKE === 'true';

function build(
  name: ProviderName,
  apiKey: string,
  baseUrl?: string | null
): AIProvider {
  switch (name) {
    case 'openai':
      return new OpenAIProvider({ apiKey, baseURL: baseUrl || undefined });
    case 'openai_compatible':
      return new OpenAIProvider({
        apiKey: apiKey || 'none',
        baseURL: baseUrl || undefined,
        name: 'openai_compatible',
      });
    case 'anthropic':
      return new AnthropicProvider({ apiKey, baseURL: baseUrl || undefined });
    case 'gemini':
      return new GeminiProvider({ apiKey, baseURL: baseUrl || undefined });
    case 'fake':
      return fakeProvider;
  }
}

const dbToName = (p: string) => p.toLowerCase() as ProviderName;

/** Platform default provider from the environment. */
function platformFromEnv(): {
  name: ProviderName;
  apiKey: string;
  baseUrl?: string;
} {
  const pick = env.ai.defaultProvider as ProviderName | '';

  if (pick === 'fake') {
    if (!fakeAllowed()) {
      throw new ApiError(
        503,
        'The fake AI provider is not allowed in production.'
      );
    }

    return { name: 'fake', apiKey: '' };
  }

  const keys: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    openai_compatible:
      process.env.OPENAI_COMPATIBLE_API_KEY || process.env.OPENAI_API_KEY,
  };
  const name = (pick ||
    PROVIDER_NAMES.find(
      (n) =>
        keys[n] ||
        (n === 'openai_compatible' && process.env.OPENAI_COMPATIBLE_BASE_URL)
    )) as ProviderName | undefined;

  if (!name || (!keys[name] && name !== 'openai_compatible')) {
    throw new ApiError(
      503,
      'AI is not configured on this server. Set AI_DEFAULT_PROVIDER and the provider API key.'
    );
  }

  return {
    name,
    apiKey: keys[name] ?? '',
    baseUrl:
      name === 'openai_compatible'
        ? process.env.OPENAI_COMPATIBLE_BASE_URL
        : undefined,
  };
}

/**
 * Chooses the provider for a portal: the portal's own configuration (own
 * key) when present, otherwise the platform default. Keys are decrypted here,
 * on the server, and never leave it.
 */
export async function resolveAI(teamId: string | null): Promise<ResolvedAI> {
  const [tenant, platformRow] = await Promise.all([
    teamId ? prisma.aIProviderConfig.findFirst({ where: { teamId } }) : null,
    prisma.aIProviderConfig.findFirst({ where: { teamId: null } }),
  ]);

  const useTenantKey = !!tenant?.encryptedApiKey;
  const row = useTenantKey ? tenant : platformRow;
  let providerName: ProviderName;
  let provider: AIProvider;

  if (useTenantKey && tenant) {
    providerName = dbToName(tenant.provider);
    provider = build(
      providerName,
      decryptSecret(tenant.encryptedApiKey as string),
      tenant.baseUrl
    );
  } else if (platformRow?.encryptedApiKey) {
    providerName = dbToName(platformRow.provider);
    provider = build(
      providerName,
      decryptSecret(platformRow.encryptedApiKey),
      platformRow.baseUrl
    );
  } else {
    const p = platformFromEnv();

    providerName = p.name;
    provider = build(p.name, p.apiKey, p.baseUrl);
  }

  const defaults = DEFAULT_MODELS[providerName];
  const tiers =
    ((row?.modelByTier ?? {}) as Partial<Record<Tier, string>>) || {};

  // the portal's plan sets its monthly credits (an explicit per-portal value wins)
  let planCredits: number | undefined;

  if (teamId && enforcementOn()) {
    const e = await getEntitlements(teamId);

    planCredits = e.limits.aiCreditsPerMonth ?? Number.MAX_SAFE_INTEGER;
  }

  return {
    providerName,
    provider,
    models: {
      fast: tiers.fast || process.env.AI_MODEL_FAST || defaults.fast,
      standard:
        tiers.standard || process.env.AI_MODEL_STANDARD || defaults.standard,
      best: tiers.best || process.env.AI_MODEL_BEST || defaults.best,
    },
    tierByFeature:
      ((tenant?.tierByFeature ?? {}) as Record<string, Tier>) || {},
    ownKey: useTenantKey,
    // tenant settings (features, retention, credits) apply even with the platform key
    enabledFeatures:
      ((tenant?.enabledFeatures ?? {}) as Record<string, boolean>) || {},
    logRetentionDays: tenant?.logRetentionDays ?? 30,
    monthlyCredits:
      tenant?.monthlyCredits ?? planCredits ?? env.ai.monthlyCredits,
  };
}

/**
 * Provider used for embeddings. Anthropic has none, so a portal on Claude
 * falls back to the platform embedding provider.
 */
export async function resolveEmbedding(teamId: string | null) {
  const main = await resolveAI(teamId);
  const model = env.ai.embeddingModel;

  if (main.providerName !== 'anthropic') {
    return {
      provider: main.provider,
      model,
      providerName: main.providerName,
      ownKey: main.ownKey,
    };
  }

  const platform = platformFromEnvSafe();

  if (!platform) {
    throw new ApiError(
      503,
      'No embedding provider is configured (Anthropic has no embeddings API).'
    );
  }

  return {
    provider: build(platform.name, platform.apiKey, platform.baseUrl),
    model,
    providerName: platform.name,
    ownKey: false,
  };
}

function platformFromEnvSafe() {
  const order: ProviderName[] = ['openai', 'gemini', 'openai_compatible'];

  if (env.ai.defaultProvider === 'fake' && fakeAllowed()) {
    return { name: 'fake' as ProviderName, apiKey: '' };
  }

  for (const n of order) {
    const key =
      n === 'openai'
        ? process.env.OPENAI_API_KEY
        : n === 'gemini'
          ? process.env.GEMINI_API_KEY
          : process.env.OPENAI_COMPATIBLE_API_KEY;

    if (
      key ||
      (n === 'openai_compatible' && process.env.OPENAI_COMPATIBLE_BASE_URL)
    ) {
      return {
        name: n,
        apiKey: key ?? '',
        baseUrl:
          n === 'openai_compatible'
            ? process.env.OPENAI_COMPATIBLE_BASE_URL
            : undefined,
      };
    }
  }

  return null;
}

export { build as buildProvider };
