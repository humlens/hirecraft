/*
 * Service worker: installability, an offline page, public job pages, Web Push.
 *
 * Privacy rule: only NON-SENSITIVE content is ever cached. That is the public
 * careers pages (/p/<portal>[/jobs/...]), hashed static assets, icons and the
 * offline page. Nothing under /api, no signed-in page (/me, /teams, /auth,
 * /dashboard ...), no apply page, no response that says it is private/no-store
 * or sets a cookie.
 */
const VERSION = 'v1';
const STATIC_CACHE = `static-${VERSION}`;
const PAGES_CACHE = `public-pages-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const PRECACHE = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];
const MAX_PAGES = 30;

/** What to do with a request. Pure, so it can be unit tested. */
function classify(url, method, mode, origin) {
  if (method !== 'GET') return 'network';

  const u = typeof url === 'string' ? new URL(url) : url;

  if (u.origin !== origin) return 'network';

  const p = u.pathname;

  if (p.startsWith('/api/')) return 'network';
  if (p.startsWith('/_next/static/')) return 'static';
  if (
    p.startsWith('/icons/') ||
    p === '/manifest.webmanifest' ||
    p === OFFLINE_URL
  )
    return 'static';

  if (mode === 'navigate') {
    return isPublicPage(p) ? 'public-page' : 'navigate-network';
  }

  return 'network';
}

/** Public careers pages only; the apply flow and every signed-in area are excluded. */
function isPublicPage(path) {
  return /^\/p\/[^/]+(\/jobs(\/[^/]+)?|\/about|\/contact|\/privacy)?\/?$/.test(
    path
  );
}

/**
 * A response may be stored only if it is clearly public. Static assets must also
 * not be marked private/no-store. Public careers pages are server-rendered by
 * Next.js, which always sends "private, no-store" for them, so for those the
 * path allow-list (isPublicPage) is what makes them safe, and a Set-Cookie
 * still disqualifies the response.
 */
function isCacheable(response, ignoreCacheControl) {
  if (!response || response.status !== 200 || response.type === 'opaque')
    return false;

  const cc = (response.headers.get('Cache-Control') || '').toLowerCase();

  if (!ignoreCacheControl && /no-store|private/.test(cc)) return false;
  if (response.headers.get('Set-Cookie')) return false;

  return true;
}

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();

  for (let i = 0; i < keys.length - max; i++) {
    await cache.delete(keys[i]);
  }
}

/** Only same-origin relative targets may be opened from a notification. */
function safeTarget(raw, origin) {
  try {
    const u = new URL(raw || '/', origin);

    return u.origin === origin ? u.pathname + u.search + u.hash : '/';
  } catch {
    return '/';
  }
}

function parsePush(data) {
  try {
    const j = data ? data.json() : {};

    return {
      title:
        typeof j.title === 'string' && j.title
          ? j.title.slice(0, 80)
          : 'Notification',
      body: typeof j.body === 'string' ? j.body.slice(0, 140) : '',
      url: typeof j.url === 'string' ? j.url : '/',
      tag: typeof j.tag === 'string' ? j.tag : undefined,
    };
  } catch {
    return { title: 'Notification', body: '', url: '/', tag: undefined };
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    classify,
    isPublicPage,
    isCacheable,
    safeTarget,
    parsePush,
  };
}

if (
  typeof self !== 'undefined' &&
  typeof self.addEventListener === 'function'
) {
  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches
        .open(STATIC_CACHE)
        .then((c) => c.addAll(PRECACHE))
        .then(() => self.skipWaiting())
    );
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((k) => k !== STATIC_CACHE && k !== PAGES_CACHE)
              .map((k) => caches.delete(k))
          )
        )
        .then(() => self.clients.claim())
    );
  });

  self.addEventListener('message', (event) => {
    // sent on sign-out: forget every stored page
    if (event.data && event.data.type === 'CLEAR_CACHES') {
      event.waitUntil(caches.delete(PAGES_CACHE));
    }
  });

  self.addEventListener('fetch', (event) => {
    const req = event.request;
    const kind = classify(req.url, req.method, req.mode, self.location.origin);

    if (kind === 'network') return; // the browser handles it

    if (kind === 'static') {
      event.respondWith(
        caches.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (isCacheable(res)) {
                const copy = res.clone();

                caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
              }

              return res;
            })
        )
      );

      return;
    }

    if (kind === 'public-page') {
      event.respondWith(
        fetch(req)
          .then((res) => {
            if (isCacheable(res, true)) {
              const copy = res.clone();

              caches
                .open(PAGES_CACHE)
                .then((c) => c.put(req, copy))
                .then(() => trim(PAGES_CACHE, MAX_PAGES));
            }

            return res;
          })
          .catch(() =>
            caches.match(req).then((hit) => hit || caches.match(OFFLINE_URL))
          )
      );

      return;
    }

    // signed-in navigation: network only, offline page if it fails; never stored
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
  });

  self.addEventListener('push', (event) => {
    const p = parsePush(event.data);

    event.waitUntil(
      self.registration.showNotification(p.title, {
        body: p.body,
        tag: p.tag,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        data: { url: safeTarget(p.url, self.location.origin) },
      })
    );
  });

  self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const target = safeTarget(
      event.notification.data && event.notification.data.url,
      self.location.origin
    );

    event.waitUntil(
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((list) => {
          for (const c of list) {
            if ('focus' in c) {
              return c
                .focus()
                .then(() => ('navigate' in c ? c.navigate(target) : undefined));
            }
          }

          return self.clients.openWindow(target);
        })
    );
  });
}
