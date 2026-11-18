import {
  assertEntitlement,
  type FeatureKey as FeatureKeyPlan,
} from '../entitlements';
import type { Team } from '@prisma/client';
import { ApiError } from '../errors';
import env from '../env';
import { prisma } from '../prisma';
import { takeToken } from '../rateLimit';
import { sendAudit } from '../retraced';
import { resolveAI } from './config';
import {
  FEATURES,
  type FeatureDef,
  type FeatureKey,
  type FeatureOutputs,
} from './features';
import { getPrompt, renderPrompt } from './prompts';
import { redactForLog } from './redact';
import { AIOutputError, type Usage } from './types';

export type AIContext = {
  teamId: string | null;
  userId: string | null;
  /** Effective permissions of the caller; omitted for candidate-side / system calls. */
  permissions?: ReadonlySet<string>;
  /** For the audit event (portal calls only). */
  team?: Team;
  user?: { id: string; name?: string | null; email?: string | null };
};

export type AIResult<T> = {
  data: T;
  usage: Usage & { credits: number; latencyMs: number };
  model: string;
  provider: string;
  promptVersion: number;
};

const monthStart = () => {
  const d = new Date();

  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

export async function creditsUsedThisMonth(teamId: string) {
  const r = await prisma.aIUsage.aggregate({
    where: { teamId, status: 'OK', createdAt: { gte: monthStart() } },
    _sum: { credits: true },
  });

  return r._sum.credits ?? 0;
}

async function record(
  ctx: AIContext,
  feature: string,
  info: {
    provider: string;
    model: string;
    promptVersion: number;
    status: 'OK' | 'ERROR' | 'BLOCKED';
    error?: string;
    usage?: Usage;
    credits?: number;
    latencyMs?: number;
  },
  log?: { input: string; output?: string; retentionDays: number }
) {
  const usage = await prisma.aIUsage.create({
    data: {
      teamId: ctx.teamId,
      userId: ctx.userId,
      feature,
      provider: info.provider,
      model: info.model,
      promptKey: feature,
      promptVersion: info.promptVersion,
      inputTokens: Math.round(info.usage?.inputTokens ?? 0),
      outputTokens: Math.round(info.usage?.outputTokens ?? 0),
      credits: info.credits ?? 0,
      latencyMs: info.latencyMs ?? 0,
      status: info.status,
      error: info.error?.slice(0, 500) ?? null,
    },
  });

  if (log) {
    await prisma.aIRequestLog.create({
      data: {
        teamId: ctx.teamId,
        usageId: usage.id,
        feature,
        input: redactForLog(log.input),
        output: log.output ? redactForLog(log.output) : null,
        expiresAt: new Date(Date.now() + log.retentionDays * 86400_000),
      },
    });
  }

  return usage;
}

/**
 * The only entry point for generative AI calls.
 *
 *  1. permission (`ai.use`) and feature switches (platform + portal)
 *  2. rate limit (token bucket, per user) and credit limit (platform key only)
 *  3. active prompt version
 *  4. model call; output validated with zod, retried ONCE on a validation failure
 *  5. usage + redacted request log (retention per portal) + audit event
 */
const PLAN_FEATURE: Partial<Record<string, FeatureKeyPlan>> = {
  'jd.generate': 'ai.assist',
  'search.parse': 'ai.assist',
  'interview.questions': 'ai.assist',
  'interview.summary': 'ai.assist',
  'comms.draft': 'ai.assist',
  'match.assess': 'ai.match',
  'copilot.step': 'ai.copilot',
};

export async function runAIFeature<K extends FeatureKey>(
  ctx: AIContext,
  featureKey: K,
  vars: Record<string, unknown>
): Promise<AIResult<FeatureOutputs[K]>> {
  const feature = FEATURES[featureKey] as FeatureDef;

  if (!env.ai.enabled) {
    throw new ApiError(503, 'AI features are disabled on this server.');
  }

  if (
    !feature.candidateSide &&
    ctx.permissions &&
    !ctx.permissions.has('ai.use')
  ) {
    throw new ApiError(403, 'You do not have the "ai.use" permission.');
  }

  const resolved = await resolveAI(ctx.teamId);

  // plan gate (portal calls only): matching and the copilot need a higher plan
  if (ctx.teamId && PLAN_FEATURE[featureKey]) {
    await assertEntitlement(ctx.teamId, { feature: PLAN_FEATURE[featureKey]! });
  }

  if (resolved.enabledFeatures[featureKey] === false) {
    throw new ApiError(403, `${feature.label} is turned off for this portal.`);
  }

  const who = ctx.userId ?? ctx.teamId ?? 'system';

  if (!(await takeToken(`ai:${who}`, env.ai.ratePerMinute))) {
    throw new ApiError(429, 'Too many AI requests. Please wait a moment.');
  }

  const charge =
    !resolved.ownKey && !!ctx.teamId && !feature.candidateSide
      ? feature.credits
      : 0;

  if (charge > 0 && ctx.teamId) {
    const used = await creditsUsedThisMonth(ctx.teamId);

    if (used + charge > resolved.monthlyCredits) {
      await record(ctx, featureKey, {
        provider: resolved.providerName,
        model: '-',
        promptVersion: 0,
        status: 'BLOCKED',
        error: 'credit limit',
      });
      throw new ApiError(
        402,
        `The monthly AI credit limit (${resolved.monthlyCredits}) is reached. Upgrade your plan or add your own API key.`
      );
    }
  }

  const prompt = await getPrompt(featureKey);
  const system = prompt.system;
  const userPrompt = renderPrompt(prompt.body, vars);
  const model = resolved.models[feature.tier];
  const started = Date.now();
  let lastError: unknown;
  let hint = '';

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await resolved.provider.generateObject({
        model,
        system,
        prompt: userPrompt + hint,
        schema: feature.schema,
        schemaName: featureKey.replace(/\W/g, '_'),
      });
      const latencyMs = Date.now() - started;

      await record(
        ctx,
        featureKey,
        {
          provider: resolved.providerName,
          model: r.model,
          promptVersion: prompt.version,
          status: 'OK',
          usage: r.usage,
          credits: charge,
          latencyMs,
        },
        {
          input: `${system}\n\n${userPrompt}`,
          output: r.text,
          retentionDays: resolved.logRetentionDays,
        }
      );

      if (ctx.team && ctx.user) {
        sendAudit({
          action: 'ai.use' as never,
          crud: 'c',
          user: ctx.user as never,
          team: ctx.team,
        });
      }

      return {
        data: r.object as FeatureOutputs[K],
        usage: { ...r.usage, credits: charge, latencyMs },
        model: r.model,
        provider: resolved.providerName,
        promptVersion: prompt.version,
      };
    } catch (error: any) {
      lastError = error;

      if (error instanceof AIOutputError && attempt === 0) {
        // one retry with the validation problem spelled out
        hint = `\n\nYour previous reply was rejected: ${error.message}\nReply again with ONLY valid JSON for the schema.`;
        continue;
      }

      break;
    }
  }

  const message = (lastError as Error)?.message ?? 'AI request failed';

  await record(
    ctx,
    featureKey,
    {
      provider: resolved.providerName,
      model,
      promptVersion: prompt.version,
      status: 'ERROR',
      error: message,
      latencyMs: Date.now() - started,
    },
    {
      input: `${system}\n\n${userPrompt}`,
      retentionDays: resolved.logRetentionDays,
    }
  );

  if (lastError instanceof AIOutputError) {
    throw new ApiError(
      502,
      'The AI returned an unusable answer. Please try again.'
    );
  }

  if (lastError instanceof ApiError) {
    throw lastError;
  }

  throw new ApiError(
    502,
    'The AI provider request failed. Please try again later.'
  );
}
