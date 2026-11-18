import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { validateWithSchema } from '@/lib/zod';
import { decryptSecret, encryptSecret } from '@/lib/ai/crypto';
import env from '@/lib/env';
import {
  assertEntitlement,
  enforcementOn,
  getEntitlements,
} from '@/lib/entitlements';
import { ApiError } from '@/lib/errors';
import { calendarFor } from '@/lib/integrations/calendar';
import {
  buildAuthUrl,
  exchangeCode,
  newNonce,
  oauthClient,
  redirectUri,
  refreshTokens,
  signState,
  verifyState,
  type Fetch,
} from '@/lib/integrations/oauth';
import { webhookPartner } from '@/lib/integrations/partners';
import {
  getProvider,
  oauthConfigured,
  PROVIDERS,
} from '@/lib/integrations/registry';
import { prisma } from '@/lib/prisma';
import { buildTenantContext, type TenantContext } from '@/lib/tenant';
import { assertSafeBaseUrl } from './ai/settings';
import { getApplication } from './application';

type Creds = {
  accessToken?: string;
  refreshToken?: string | null;
  expiresAt?: number;
  secret?: string;
};

const readCreds = (enc: string | null): Creds =>
  enc ? (JSON.parse(decryptSecret(enc)) as Creds) : {};
const writeCreds = (c: Creds) => encryptSecret(JSON.stringify(c));

/** Every provider with this portal's state. Secrets are never returned. */
export async function listIntegrations(ctx: TenantContext) {
  const rows = await prisma.integration.findMany({
    where: { teamId: ctx.team.id },
  });
  const byKey = new Map(rows.map((r) => [r.provider, r]));
  const e = await getEntitlements(ctx.team.id);

  return PROVIDERS.map((p) => {
    const row = byKey.get(p.key);

    return {
      key: p.key,
      kind: p.kind,
      name: p.name,
      description: p.description,
      auth: p.auth,
      href: p.href ?? null,
      entitled: !enforcementOn() || e.features.includes(p.feature),
      availableOnServer: p.auth === 'oauth' ? oauthConfigured(p) : true,
      connected: row?.status === 'CONNECTED',
      accountLabel: row?.accountLabel ?? null,
      config: row
        ? {
            ...((row.config ?? {}) as Record<string, unknown>),
            hasSecret: !!readCreds(row.encryptedCredentials).secret,
          }
        : null,
      lastError: row?.lastError ?? null,
    };
  });
}

const providerOrThrow = (key: string) => {
  const p = getProvider(key);

  if (!p) throw new ApiError(404, 'Unknown integration.');

  return p;
};

export async function startOAuth(ctx: TenantContext, providerKey: string) {
  const p = providerOrThrow(providerKey);

  if (p.auth !== 'oauth')
    throw new ApiError(422, 'This integration does not use OAuth.');

  await assertEntitlement(ctx.team.id, { feature: p.feature });

  const client = oauthClient(p.key);

  if (!client)
    throw new ApiError(503, `${p.name} is not configured on this server.`);

  const nonce = newNonce();
  const state = signState({
    teamId: ctx.team.id,
    userId: ctx.user.id,
    provider: p.key,
    nonce,
    exp: Date.now() + 10 * 60_000,
  });

  return {
    nonce,
    url: buildAuthUrl(p.key, {
      clientId: client.clientId,
      redirect: redirectUri(env.appUrl, p.key),
      state,
    }),
  };
}

/** Finishes the OAuth flow. The caller must be the user who started it, in the browser that started it. */
export async function completeOAuth(
  providerKey: string,
  args: {
    code: string;
    state: string;
    cookieNonce: string | undefined;
    userId: string;
  },
  f: Fetch = fetch
) {
  const st = verifyState(args.state);

  if (
    st.provider !== providerKey ||
    st.userId !== args.userId ||
    !args.cookieNonce ||
    args.cookieNonce !== st.nonce
  ) {
    throw new ApiError(400, 'Invalid state.');
  }

  // membership and permission are re-checked: the link may have been opened later
  const ctx = await buildTenantContext(st.teamId, st.userId);

  if (!ctx.permissions.has('integrations.manage')) {
    throw new ApiError(
      403,
      'You do not have the "integrations.manage" permission.'
    );
  }

  const p = providerOrThrow(providerKey);

  await assertEntitlement(st.teamId, { feature: p.feature });

  const client = oauthClient(providerKey);

  if (!client)
    throw new ApiError(503, `${p.name} is not configured on this server.`);

  const { tokens, label } = await exchangeCode(
    providerKey,
    {
      code: args.code,
      ...client,
      redirect: redirectUri(env.appUrl, providerKey),
    },
    f
  );

  if (!tokens.refreshToken) {
    throw new ApiError(
      502,
      'The provider did not grant offline access. Please try again.'
    );
  }

  const data = {
    kind: p.kind,
    status: 'CONNECTED',
    accountLabel: label,
    encryptedCredentials: writeCreds({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    }),
    connectedById: st.userId,
    lastError: null,
    config: { video: true },
  };

  await prisma.integration.upsert({
    where: { teamId_provider: { teamId: st.teamId, provider: providerKey } },
    create: { teamId: st.teamId, provider: providerKey, ...data },
    update: data,
  });

  return { slug: ctx.team.slug, provider: providerKey };
}

const webhookSchema = z.object({
  url: z.string().trim().url().max(500),
  secret: z.string().trim().min(16).max(200).optional(),
});

export async function saveWebhookIntegration(
  ctx: TenantContext,
  providerKey: string,
  input: unknown
) {
  const p = providerOrThrow(providerKey);

  if (p.auth !== 'webhook')
    throw new ApiError(422, 'This integration is not configured with a URL.');

  await assertEntitlement(ctx.team.id, { feature: p.feature });

  const { url, secret } = validateWithSchema(webhookSchema, input);

  await assertSafeBaseUrl(url);

  const existing = await prisma.integration.findFirst({
    where: { teamId: ctx.team.id, provider: providerKey },
  });
  const prev = readCreds(existing?.encryptedCredentials ?? null);
  const creds = { ...prev, ...(secret ? { secret } : {}) };

  if (!creds.secret)
    throw new ApiError(
      422,
      'A signing secret (at least 16 characters) is required.'
    );

  const data = {
    kind: p.kind,
    status: 'CONNECTED',
    config: { url },
    encryptedCredentials: writeCreds(creds),
    connectedById: ctx.user.id,
    lastError: null,
  };

  await prisma.integration.upsert({
    where: { teamId_provider: { teamId: ctx.team.id, provider: providerKey } },
    create: { teamId: ctx.team.id, provider: providerKey, ...data },
    update: data,
  });
}

export async function updateIntegrationConfig(
  ctx: TenantContext,
  providerKey: string,
  config: { video?: boolean }
) {
  const row = await prisma.integration.findFirst({
    where: { teamId: ctx.team.id, provider: providerKey },
  });

  if (!row) throw new ApiError(404, 'This integration is not connected.');

  await prisma.integration.update({
    where: { id: row.id, teamId: ctx.team.id },
    data: {
      config: {
        ...((row.config ?? {}) as object),
        ...(config.video === undefined ? {} : { video: !!config.video }),
      },
    },
  });
}

export async function disconnectIntegration(
  ctx: TenantContext,
  providerKey: string
) {
  providerOrThrow(providerKey);
  await prisma.integration.deleteMany({
    where: { teamId: ctx.team.id, provider: providerKey },
  });
}

/** A valid access token, refreshed (and saved) when it has expired. */
async function accessToken(
  row: {
    id: string;
    teamId: string;
    provider: string;
    encryptedCredentials: string | null;
  },
  f?: Fetch
) {
  const c = readCreds(row.encryptedCredentials);

  if (c.accessToken && c.expiresAt && c.expiresAt > Date.now())
    return c.accessToken;

  const client = oauthClient(row.provider);

  if (!client || !c.refreshToken)
    throw new ApiError(502, 'The connection needs to be renewed.');

  const t = await refreshTokens(
    row.provider,
    { refreshToken: c.refreshToken, ...client },
    f
  );

  await prisma.integration.update({
    where: { id: row.id, teamId: row.teamId },
    data: {
      encryptedCredentials: writeCreds({
        accessToken: t.accessToken,
        refreshToken: t.refreshToken,
        expiresAt: t.expiresAt,
      }),
    },
  });

  return t.accessToken;
}

// --- calendar sync for interviews (best effort, never fails the interview) -------------

async function calendarRow(teamId: string) {
  const row = await prisma.integration.findFirst({
    where: { teamId, kind: 'calendar', status: 'CONNECTED' },
    orderBy: { createdAt: 'asc' },
  });

  if (!row) return null;

  try {
    await assertEntitlement(teamId, { feature: 'integrations' });
  } catch {
    return null; // plan no longer includes it: stay quiet
  }

  return row;
}

const noteError = (teamId: string, id: string, error: unknown) =>
  prisma.integration
    .update({
      where: { id, teamId },
      data: {
        lastError: String((error as Error)?.message ?? error).slice(0, 200),
      },
    })
    .catch(() => undefined);

export async function syncInterviewCreated(
  teamId: string,
  interviewId: string,
  f?: Fetch
) {
  const row = await calendarRow(teamId);

  if (!row) return;

  try {
    const i = await prisma.interview.findFirst({
      where: { id: interviewId, teamId },
      include: {
        participants: true,
        application: {
          include: {
            job: { select: { title: true } },
            tenantCandidate: { select: { name: true } },
          },
        },
      },
    });

    if (!i) return;

    const users = await prisma.user.findMany({
      where: { id: { in: i.participants.map((p) => p.userId) } },
      select: { email: true },
    });
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { slug: true },
    });
    const token = await accessToken(row, f);
    const cfg = (row.config ?? {}) as { video?: boolean };
    const wantVideo = cfg.video !== false && !i.meetingUrl;
    const ev = await calendarFor(row.provider, f).createEvent(token, {
      title: `Interview: ${i.application.tenantCandidate.name} (${i.application.job.title}), round ${i.round}`,
      description: `${env.appUrl}/teams/${team?.slug}/interviews/${i.id}`,
      startsAt: i.startsAt,
      endsAt: new Date(i.startsAt.getTime() + i.durationMin * 60_000),
      attendees: users.map((u) => u.email),
      location: i.location,
      withVideo: wantVideo,
    });

    await prisma.interview.update({
      where: { id: i.id, teamId },
      data: {
        calendarEventIds: { provider: row.provider, id: ev.id },
        ...(wantVideo && ev.meetingUrl ? { meetingUrl: ev.meetingUrl } : {}),
      },
    });
    await prisma.integration.update({
      where: { id: row.id, teamId },
      data: { lastError: null },
    });
  } catch (error) {
    console.error('calendar sync failed', error);
    await noteError(teamId, row.id, error);
  }
}

export async function syncInterviewCancelled(
  teamId: string,
  interviewId: string,
  f?: Fetch
) {
  const i = await prisma.interview.findFirst({
    where: { id: interviewId, teamId },
    select: { calendarEventIds: true },
  });
  const ref = i?.calendarEventIds as { provider: string; id: string } | null;

  if (!ref) return;

  const row = await prisma.integration.findFirst({
    where: { teamId, provider: ref.provider, status: 'CONNECTED' },
  });

  if (!row) return;

  try {
    await calendarFor(row.provider, f).deleteEvent(
      await accessToken(row, f),
      ref.id
    );
    await prisma.interview.update({
      where: { id: interviewId, teamId },
      data: { calendarEventIds: Prisma.DbNull },
    });
  } catch (error) {
    console.error('calendar sync failed', error);
    await noteError(teamId, row.id, error);
  }
}

export async function syncInterviewRescheduled(
  teamId: string,
  interviewId: string,
  f?: Fetch
) {
  await syncInterviewCancelled(teamId, interviewId, f);
  await syncInterviewCreated(teamId, interviewId, f);
}

// --- assessments and background checks -------------------------------------------------

export async function requestPartner(
  ctx: TenantContext,
  applicationId: string,
  kind: 'assessment' | 'background_check',
  consentConfirmed: boolean,
  f?: Fetch
) {
  const p = providerOrThrow(kind);

  await assertEntitlement(ctx.team.id, { feature: p.feature });

  const app = await getApplication(ctx, applicationId); // 404 outside the caller's scope
  const row = await prisma.integration.findFirst({
    where: { teamId: ctx.team.id, provider: kind, status: 'CONNECTED' },
  });

  if (!row)
    throw new ApiError(409, `${p.name} is not connected for this portal.`);

  if (app.stage.kind !== 'ACTIVE' && app.stage.kind !== 'HIRED') {
    throw new ApiError(409, 'This application is no longer active.');
  }

  const url = ((row.config ?? {}) as { url?: string }).url as string;

  await assertSafeBaseUrl(url); // checked again at call time (DNS can change)

  const result = await webhookPartner(
    { url, secret: readCreds(row.encryptedCredentials).secret as string },
    f
  ).request({
    kind,
    applicationId,
    candidate: { name: app.candidate.name, email: app.candidate.email },
    job: { title: app.job.title },
    consentConfirmed,
  });

  await prisma.applicationActivity.create({
    data: {
      teamId: ctx.team.id,
      applicationId,
      actorUserId: ctx.user.id,
      type: 'NOTE',
      payload: {
        integration: kind,
        status: result.status,
        externalId: result.externalId,
        consentConfirmed,
      },
    },
  });

  return result;
}
