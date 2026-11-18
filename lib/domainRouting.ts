/**
 * Pure helpers for serving a portal on its own domain. Used by middleware.ts
 * (edge runtime), so no Node-only imports here.
 */

export const isPlatformHost = (
  host: string,
  platformHosts: string[],
  baseDomain: string
) => {
  const h = host.toLowerCase().replace(/:\d+$/, '');

  return (
    !h ||
    h === 'localhost' ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(h) ||
    platformHosts.includes(h) ||
    (!!baseDomain && (h === baseDomain || h.endsWith(`.${baseDomain}`)))
  );
};

// public portal pages that get a short URL on a custom domain
const PRETTY = /^\/(jobs(\/[^/]+)?|about|contact|privacy)?\/?$/;

/**
 * What to do with a request to `pathname` on a verified custom domain of
 * portal `slug`:
 *  - pass: let it through unchanged (assets, public APIs, the portal's own pages)
 *  - rewrite: serve /p/<slug>/... under the short URL
 *  - redirect: signed-in and apply flows live on the platform host (cookies are per host)
 */
export type DomainAction =
  | { kind: 'pass' }
  | { kind: 'rewrite'; to: string }
  | { kind: 'redirect' }
  | { kind: 'notfound' };

export function customDomainAction(
  pathname: string,
  slug: string
): DomainAction {
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/icons/') ||
    pathname.startsWith('/api/public/') ||
    pathname === '/sw.js' ||
    pathname === '/offline.html' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/favicon.ico'
  ) {
    return { kind: 'pass' };
  }

  if (pathname === '/sitemap.xml' || pathname === '/robots.txt') {
    return { kind: 'rewrite', to: `/p/${slug}${pathname}` };
  }

  const own = `/p/${slug}`;

  if (pathname === own || pathname.startsWith(`${own}/`)) {
    // applying needs a session, which only exists on the platform host
    return pathname.startsWith(`${own}/apply/`)
      ? { kind: 'redirect' }
      : { kind: 'pass' };
  }

  if (PRETTY.test(pathname)) {
    return {
      kind: 'rewrite',
      to: pathname === '/' ? own : `${own}${pathname.replace(/\/$/, '')}`,
    };
  }

  // another portal's pages must never be reachable through this domain
  if (pathname.startsWith('/p/')) {
    return { kind: 'notfound' };
  }

  return { kind: 'redirect' };
}
