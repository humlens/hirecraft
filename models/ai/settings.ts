import { assertEntitlement } from '@/lib/entitlements';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { z } from 'zod';
import { encryptSecret, keyHint } from '@/lib/ai/crypto';
import { DEFAULT_MODELS, PROVIDER_NAMES, resolveAI } from '@/lib/ai/config';
import { FEATURES, FEATURE_KEYS } from '@/lib/ai/features';
import { creditsUsedThisMonth } from '@/lib/ai/run';
import { ApiError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import type { TenantContext } from '@/lib/tenant';

const privateV4 = (ip: string) => {
  const [a, b] = ip.split('.').map(Number);

  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
};

const privateV6 = (ip: string) =>
  /^(::1|::|fe80:|fc|fd)/i.test(ip) ||
  (/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.test(ip) &&
    privateV4(ip.split(':').pop() as string));

/**
 * A portal can point the "OpenAI compatible" provider at its own server. To
 * stop that being used to reach internal services (SSRF), the URL must be
 * https and must not resolve to a private, loopback or link-local address.
 */
export async function assertSafeBaseUrl(raw: string) {
  let u: URL;

  try {
    u = new URL(raw);
  } catch {
    throw new ApiError(422, 'The base URL is not a valid URL.');
  }

  if (process.env.AI_ALLOW_PRIVATE_BASE_URLS === 'true') {
    return;
  }

  if (u.protocol !== 'https:') {
    throw new ApiError(422, 'The base URL must use https.');
  }

  if (u.username || u.password) {
    throw new ApiError(422, 'The base URL must not contain credentials.');
  }

  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => []);

  if (!addrs.length) {
    throw new ApiError(422, 'The base URL host could not be resolved.');
  }

  for (const { address } of addrs) {
    if (isIP(address) === 4 ? privateV4(address) : privateV6(address)) {
      throw new ApiError(
        422,
        'The base URL must not point to a private or internal address.'
      );
    }
  }
}

export const aiSettingsSchema = z.object({
  provider: z.enum(['OPENAI', 'ANTHROPIC', 'GEMINI', 'OPENAI_COMPATIBLE']),
  baseUrl: z.string().trim().max(300).nullable().optional(),
  /** write-only: omit to keep the stored key, "" or null together with clearKey to remove it */
  apiKey: z.string().trim().min(8).max(300).optional(),
  clearKey: z.boolean().optional(),
  modelByTier: z
    .object({
      fast: z.string().trim().max(100).optional(),
      standard: z.string().trim().max(100).optional(),
    })
    .default({}),
  enabledFeatures: z.record(z.string(), z.boolean()).default({}),
  logRetentionDays: z.number().int().min(1).max(365).default(30),
});

/** Never includes the API key, only whether one is stored and its last 4 characters. */
export async function getAiSettings(ctx: TenantContext) {
  const row = await prisma.aIProviderConfig.findFirst({
    where: { teamId: ctx.team.id },
  });
  const resolved = await resolveAI(ctx.team.id).catch(() => null);

  return {
    configured: !!row,
    provider: row?.provider ?? null,
    baseUrl: row?.baseUrl ?? null,
    hasOwnKey: !!row?.encryptedApiKey,
    keyHint: row?.keyHint ?? null,
    modelByTier: (row?.modelByTier ?? {}) as Record<string, string>,
    enabledFeatures: Object.fromEntries(
      FEATURE_KEYS.map((k) => [
        k,
        ((row?.enabledFeatures ?? {}) as Record<string, boolean>)[k] !== false,
      ])
    ),
    logRetentionDays: row?.logRetentionDays ?? 30,
    effective: resolved && {
      provider: resolved.providerName,
      ownKey: resolved.ownKey,
      models: resolved.models,
    },
    providers: PROVIDER_NAMES,
    defaultModels: DEFAULT_MODELS,
    features: FEATURE_KEYS.map((k) => ({
      key: k,
      label: FEATURES[k].label,
      credits: FEATURES[k].credits,
    })),
  };
}

export async function saveAiSettings(
  ctx: TenantContext,
  input: z.infer<typeof aiSettingsSchema>
) {
  const teamId = ctx.team.id;

  if (input.baseUrl) {
    await assertSafeBaseUrl(input.baseUrl);
  }

  if (input.provider === 'OPENAI_COMPATIBLE' && !input.baseUrl) {
    throw new ApiError(422, 'OpenAI-compatible providers need a base URL.');
  }

  const unknown = Object.keys(input.enabledFeatures).filter(
    (k) => !(k in FEATURES)
  );

  if (unknown.length) {
    throw new ApiError(422, `Unknown feature: ${unknown[0]}`);
  }

  if (input.apiKey) {
    await assertEntitlement(teamId, { feature: 'byoKey' });
  }

  const existing = await prisma.aIProviderConfig.findFirst({
    where: { teamId },
  });
  const key = input.apiKey
    ? {
        encryptedApiKey: encryptSecret(input.apiKey),
        keyHint: keyHint(input.apiKey),
      }
    : input.clearKey
      ? { encryptedApiKey: null, keyHint: null }
      : {};
  const data = {
    provider: input.provider,
    baseUrl: input.baseUrl || null,
    modelByTier: input.modelByTier,
    enabledFeatures: input.enabledFeatures,
    logRetentionDays: input.logRetentionDays,
    ...key,
  };

  if (existing) {
    await prisma.aIProviderConfig.updateMany({
      where: { id: existing.id, teamId },
      data,
    });
  } else {
    await prisma.aIProviderConfig.create({ data: { teamId, ...data } });
  }

  return getAiSettings(ctx);
}

export async function getUsage(ctx: TenantContext) {
  const teamId = ctx.team.id;
  const start = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)
  );
  const [rows, used, resolved, errors] = await Promise.all([
    prisma.aIUsage.groupBy({
      by: ['feature'],
      where: { teamId, createdAt: { gte: start } },
      _count: { _all: true },
      _sum: { credits: true, inputTokens: true, outputTokens: true },
    }),
    creditsUsedThisMonth(teamId),
    resolveAI(teamId).catch(() => null),
    prisma.aIUsage.findMany({
      where: { teamId, status: { not: 'OK' }, createdAt: { gte: start } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { feature: true, status: true, error: true, createdAt: true },
    }),
  ]);

  return {
    month: start.toISOString().slice(0, 7),
    creditsUsed: used,
    creditsLimit: resolved?.ownKey ? null : (resolved?.monthlyCredits ?? null),
    ownKey: resolved?.ownKey ?? false,
    byFeature: rows.map((r) => ({
      feature: r.feature,
      calls: r._count._all,
      credits: r._sum.credits ?? 0,
      inputTokens: r._sum.inputTokens ?? 0,
      outputTokens: r._sum.outputTokens ?? 0,
    })),
    recentProblems: errors,
  };
}

/** Redacted request log (kept for the configured retention period). */
export async function getRequestLog(ctx: TenantContext, limit = 25) {
  return prisma.aIRequestLog.findMany({
    where: { teamId: ctx.team.id, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      feature: true,
      input: true,
      output: true,
      createdAt: true,
      expiresAt: true,
    },
  });
}

export async function testConnection(ctx: TenantContext) {
  const resolved = await resolveAI(ctx.team.id);
  const started = Date.now();

  try {
    const r = await resolved.provider.generateText({
      model: resolved.models.fast,
      prompt: 'Reply with the single word OK.',
      maxTokens: 10,
    });

    return {
      ok: true,
      provider: resolved.providerName,
      model: r.model,
      latencyMs: Date.now() - started,
      ownKey: resolved.ownKey,
    };
  } catch (error: any) {
    return {
      ok: false,
      provider: resolved.providerName,
      error: String(error?.message ?? error).slice(0, 200),
    };
  }
}
