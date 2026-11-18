import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { ApiError } from '../errors';
import { getProvider } from './registry';

export type Fetch = typeof fetch;

type OAuthDef = {
  authUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: string[];
  extra: Record<string, string>;
  label: (j: any) => string | null;
};

const OAUTH: Record<string, OAuthDef> = {
  google_calendar: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scopes: [
      'openid',
      'email',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    extra: { access_type: 'offline', prompt: 'consent' },
    label: (j) => j?.email ?? null,
  },
  microsoft_calendar: {
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userinfoUrl: 'https://graph.microsoft.com/v1.0/me',
    scopes: ['offline_access', 'User.Read', 'Calendars.ReadWrite'],
    extra: { response_mode: 'query' },
    label: (j) => j?.mail ?? j?.userPrincipalName ?? null,
  },
};

const secret = () => process.env.NEXTAUTH_SECRET || 'dev-secret';

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** State = signed { team, user, provider, nonce, exp }; the nonce is also kept in a cookie. */
export function signState(p: {
  teamId: string;
  userId: string;
  provider: string;
  nonce: string;
  exp: number;
}) {
  const body = b64(JSON.stringify(p));
  const sig = createHmac('sha256', secret()).update(body).digest('base64url');

  return `${body}.${sig}`;
}

export function verifyState(state: string) {
  const [body, sig] = String(state).split('.');

  if (!body || !sig) throw new ApiError(400, 'Invalid state.');

  const expected = createHmac('sha256', secret()).update(body).digest();
  const given = Buffer.from(sig, 'base64url');

  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new ApiError(400, 'Invalid state.');
  }

  const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as {
    teamId: string;
    userId: string;
    provider: string;
    nonce: string;
    exp: number;
  };

  if (p.exp < Date.now())
    throw new ApiError(
      400,
      'The connection attempt expired. Please try again.'
    );

  return p;
}

export const newNonce = () => randomBytes(16).toString('hex');

export const redirectUri = (appUrl: string, provider: string) =>
  `${appUrl}/api/integrations/callback/${provider}`;

export function buildAuthUrl(
  provider: string,
  args: { clientId: string; redirect: string; state: string }
) {
  const d = OAUTH[provider];

  if (!d) throw new ApiError(404, 'Unknown provider.');

  const u = new URL(d.authUrl);

  u.searchParams.set('client_id', args.clientId);
  u.searchParams.set('redirect_uri', args.redirect);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', d.scopes.join(' '));
  u.searchParams.set('state', args.state);
  Object.entries(d.extra).forEach(([k, v]) => u.searchParams.set(k, v));

  return u.toString();
}

export type Tokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
};

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

async function tokenCall(
  provider: string,
  body: Record<string, string>,
  f: Fetch
): Promise<Tokens> {
  const d = OAUTH[provider];
  const r = await f(d.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form(body),
  });

  if (!r.ok) {
    throw new ApiError(
      502,
      'The provider refused the request. Please connect again.'
    );
  }

  const j = (await r.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? null,
    expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 - 60_000,
  };
}

export async function exchangeCode(
  provider: string,
  args: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirect: string;
  },
  f: Fetch = fetch
) {
  const d = OAUTH[provider];
  const tokens = await tokenCall(
    provider,
    {
      grant_type: 'authorization_code',
      code: args.code,
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.redirect,
    },
    f
  );
  const me = await f(d.userinfoUrl, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  const label = me.ok ? d.label(await me.json()) : null;

  return { tokens, label };
}

export async function refreshTokens(
  provider: string,
  args: { refreshToken: string; clientId: string; clientSecret: string },
  f: Fetch = fetch
) {
  const t = await tokenCall(
    provider,
    {
      grant_type: 'refresh_token',
      refresh_token: args.refreshToken,
      client_id: args.clientId,
      client_secret: args.clientSecret,
    },
    f
  );

  // providers may not return the refresh token again
  return { ...t, refreshToken: t.refreshToken ?? args.refreshToken };
}

export const oauthClient = (provider: string) => {
  const p = getProvider(provider);

  if (!p?.env) return null;

  const clientId = process.env[p.env.clientId];
  const clientSecret = process.env[p.env.clientSecret];

  return clientId && clientSecret ? { clientId, clientSecret } : null;
};
