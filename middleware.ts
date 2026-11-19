import micromatch from 'micromatch';
import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { customDomainAction, isPlatformHost } from './lib/domainRouting';
import env from './lib/env';

// Constants for security headers
const SECURITY_HEADERS = {
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=()',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-site',
} as const;

// Generate CSP
const generateCSP = (): string => {
  const policies = {
    'default-src': ["'self'"],
    'img-src': ["'self'", '*.dicebear.com', 'data:'],
    'script-src': [
      "'self'",
      "'unsafe-inline'",
      "'unsafe-eval'",
      '*.gstatic.com',
      '*.google.com',
    ],
    'style-src': ["'self'", "'unsafe-inline'"],
    'connect-src': [
      "'self'",
      '*.google.com',
      '*.gstatic.com',
      '*.ingest.sentry.io',
      '*.mixpanel.com',
    ],
    'frame-src': ["'self'", '*.google.com', '*.gstatic.com'],
    'font-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'frame-ancestors': ["'none'"],
  };

  return Object.entries(policies)
    .map(([key, values]) => `${key} ${values.join(' ')}`)
    .concat(['upgrade-insecure-requests'])
    .join('; ');
};

// Add routes that don't require authentication
const unAuthenticatedRoutes = [
  // the kit's public landing page (the matcher below now includes '/')
  '/',
  '/api/hello',
  '/api/health',
  '/api/auth/**',
  '/api/oauth/**',
  '/api/scim/v2.0/**',
  '/api/invitations/*',
  '/api/webhooks/stripe',
  '/api/webhooks/dsync',
  '/auth/**',
  '/invitations/*',
  '/terms-condition',
  '/unlock-account',
  '/login/saml',
  '/.well-known/*',
  // Public job portal (careers pages, sitemap, robots) and its public APIs
  '/p/**',
  '/api/public/**',
  // PWA: installability and offline page (no user data)
  '/sw.js',
  '/manifest.webmanifest',
  '/offline.html',
  '/icons/**',
  // brand assets (also fetched server-side by the image optimizer)
  '/logo*.png',
  '/logo.svg',
  '/favicon.*',
  '/home-hero.svg',
  '/user-default-profile.jpeg',
  '/api/candidate/register',
  // Local-disk storage driver (HMAC-signed URLs; S3 in production)
  '/api/storage/local',
  // Called by the worker / a scheduler; authenticated by CRON_SECRET
  '/api/internal/tick',
  '/api/internal/cron',
];

const hostOf = (u?: string) => {
  try {
    return u ? new URL(u).hostname.toLowerCase() : '';
  } catch {
    return '';
  }
};

// verified custom domain -> portal slug, cached briefly (edge runtime: no database here)
const domainCache = new Map<string, { slug: string | null; exp: number }>();

async function slugForHost(host: string) {
  const hit = domainCache.get(host);

  if (hit && hit.exp > Date.now()) {
    return hit.slug;
  }

  let slug: string | null = null;

  try {
    // env is inlined when the app is built: APP_URL (or INTERNAL_APP_URL) must be set at build time
    const configured = process.env.INTERNAL_APP_URL || env.appUrl;
    const base = /^https?:\/\//.test(configured)
      ? configured
      : `http://127.0.0.1:${process.env.PORT || 3000}`;
    const r = await fetch(
      `${base}/api/public/domains/resolve?host=${encodeURIComponent(host)}`
    );

    if (r.ok) {
      slug = (await r.json()).data?.slug ?? null;
    }
  } catch {
    // treated as unknown for a few seconds
  }

  domainCache.set(host, { slug, exp: Date.now() + (slug ? 30_000 : 10_000) });

  return slug;
}

// A request to a customer's own domain: serve their public portal, send everything else home.
async function handleCustomDomain(req: NextRequest, host: string) {
  // the lookup endpoint itself must never depend on a lookup
  if (req.nextUrl.pathname.startsWith('/api/public/domains/')) {
    return NextResponse.next();
  }

  const slug = await slugForHost(host);

  if (!slug) {
    return new NextResponse('This domain is not configured.', { status: 404 });
  }

  const { pathname, search } = req.nextUrl;
  const action = customDomainAction(pathname, slug);

  if (action.kind === 'notfound') {
    return new NextResponse('Not found', { status: 404 });
  }

  if (action.kind === 'redirect') {
    return NextResponse.redirect(new URL(`${pathname}${search}`, env.appUrl));
  }

  const response =
    action.kind === 'rewrite'
      ? NextResponse.rewrite(new URL(`${action.to}${search}`, req.url))
      : NextResponse.next();

  if (env.securityHeadersEnabled) {
    response.headers.set('Content-Security-Policy', generateCSP());
    Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
  }

  return response;
}

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const host = (req.headers.get('host') ?? '').toLowerCase();

  if (
    env.customDomains.enabled &&
    !isPlatformHost(
      host,
      [hostOf(env.appUrl), hostOf(process.env.NEXTAUTH_URL)].filter(Boolean),
      env.customDomains.baseDomain
    )
  ) {
    return handleCustomDomain(req, host.replace(/:\d+$/, ''));
  }

  // Bypass routes that don't require authentication
  if (micromatch.isMatch(pathname, unAuthenticatedRoutes)) {
    const response = NextResponse.next();

    // Public portal pages get the same security headers as the app
    if (env.securityHeadersEnabled && pathname.startsWith('/p/')) {
      response.headers.set('Content-Security-Policy', generateCSP());
      Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
        response.headers.set(key, value);
      });
    }

    return response;
  }

  const redirectUrl = new URL('/auth/login', req.url);
  redirectUrl.searchParams.set('callbackUrl', encodeURI(req.url));

  // JWT strategy
  if (env.nextAuth.sessionStrategy === 'jwt') {
    const token = await getToken({
      req,
    });

    if (!token) {
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Database strategy
  else if (env.nextAuth.sessionStrategy === 'database') {
    const url = new URL('/api/auth/session', req.url);

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        cookie: req.headers.get('cookie') || '',
      },
    });

    const session = await response.json();

    if (!session.user) {
      return NextResponse.redirect(redirectUrl);
    }
  }

  const requestHeaders = new Headers(req.headers);
  const csp = generateCSP();

  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  if (env.securityHeadersEnabled) {
    // Set security headers
    response.headers.set('Content-Security-Policy', csp);
    Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
  }

  // All good, let the request through
  return response;
}

export const config = {
  matcher: [
    // '/' is listed on its own: with i18n the pattern below does not match the root path
    '/',
    '/((?!_next/static|_next/image|favicon.ico|api/auth/session).*)',
  ],
};
