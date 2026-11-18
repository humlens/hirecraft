/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const SRC = fs.readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
const ORIGIN = 'https://app.example.com';

type Listener = (e: any) => void;

/** Loads the worker in a sandbox with fakes for the service-worker globals. */
function load() {
  const listeners: Record<string, Listener> = {};
  const stores = new Map<string, Map<string, any>>();
  const cacheFor = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());

    const m = stores.get(name)!;

    return {
      addAll: async (urls: string[]) =>
        urls.forEach((u) => m.set(u, { url: u })),
      put: async (req: any, res: any) =>
        void m.set(typeof req === 'string' ? req : req.url, res),
      match: async (req: any) => m.get(typeof req === 'string' ? req : req.url),
      keys: async () => Array.from(m.keys()).map((url) => ({ url })),
      delete: async (req: any) =>
        m.delete(typeof req === 'string' ? req : req.url),
    };
  };
  const shown: any[] = [];
  const opened: string[] = [];
  const clientsList: any[] = [];
  const self: any = {
    location: { origin: ORIGIN },
    addEventListener: (t: string, fn: Listener) => (listeners[t] = fn),
    skipWaiting: jest.fn(),
    clients: {
      claim: jest.fn(),
      matchAll: async () => clientsList,
      openWindow: async (u: string) => void opened.push(u),
    },
    registration: {
      showNotification: async (title: string, o: any) =>
        void shown.push({ title, ...o }),
    },
  };
  const caches = {
    open: async (n: string) => cacheFor(n),
    match: async (req: any) => {
      for (const m of Array.from(stores.values())) {
        const k = typeof req === 'string' ? req : req.url;

        if (m.has(k)) return m.get(k);
      }
    },
    keys: async () => Array.from(stores.keys()),
    delete: async (n: string) => stores.delete(n),
  };
  const sandbox: any = {
    self,
    caches,
    URL,
    fetch: jest.fn(),
    module: { exports: {} },
    console,
  };

  vm.runInNewContext(SRC, sandbox);

  return {
    listeners,
    stores,
    shown,
    opened,
    clientsList,
    sandbox,
    fns: sandbox.module.exports,
  };
}

const res = (
  init: {
    status?: number;
    headers?: Record<string, string>;
    type?: string;
  } = {}
) => ({
  status: init.status ?? 200,
  type: init.type ?? 'basic',
  headers: { get: (k: string) => init.headers?.[k] ?? null },
  clone() {
    return this;
  },
});

describe('service worker: what may be cached', () => {
  const { fns } = load();
  const c = (p: string, method = 'GET', mode = 'navigate', origin = ORIGIN) =>
    fns.classify(new URL(p, origin).toString(), method, mode, ORIGIN);

  it('never touches the API, other origins or non-GET requests', () => {
    expect(c('/api/candidate/profile', 'GET', 'cors')).toBe('network');
    expect(c('/api/teams/acme/jobs', 'GET', 'cors')).toBe('network');
    expect(c('/api/public/portals/acme/jobs', 'GET', 'cors')).toBe('network');
    expect(c('/p/acme', 'POST')).toBe('network');
    expect(c('/anything', 'GET', 'cors', 'https://evil.example')).toBe(
      'network'
    );
  });

  it('caches only public careers pages; every signed-in page is network-only', () => {
    for (const p of [
      '/p/acme',
      '/p/acme/',
      '/p/acme/jobs',
      '/p/acme/jobs/senior-engineer',
      '/p/acme/about',
    ]) {
      expect(c(p)).toBe('public-page');
    }

    for (const p of [
      '/me',
      '/me/applications',
      '/me/profile',
      '/teams/acme/talent',
      '/teams/acme/review',
      '/dashboard',
      '/auth/login',
      '/notifications',
      '/p/acme/apply/senior-engineer', // needs a session
      '/p/acme/jobs/a/b',
      '/p/../me',
    ]) {
      expect(c(p)).toBe('navigate-network');
    }
  });

  it('serves hashed static assets, icons, manifest and the offline page from cache', () => {
    expect(c('/_next/static/chunks/a.js', 'GET', 'no-cors')).toBe('static');
    expect(c('/icons/icon-192.png', 'GET', 'no-cors')).toBe('static');
    expect(c('/manifest.webmanifest', 'GET', 'cors')).toBe('static');
    expect(c('/offline.html')).toBe('static');
  });

  it('stores a response only if it is clearly public', () => {
    expect(fns.isCacheable(res())).toBe(true);
    expect(
      fns.isCacheable(
        res({ headers: { 'Cache-Control': 'public, max-age=60' } })
      )
    ).toBe(true);
    expect(
      fns.isCacheable(res({ headers: { 'Cache-Control': 'private' } }))
    ).toBe(false);
    expect(
      fns.isCacheable(res({ headers: { 'Cache-Control': 'no-store' } }))
    ).toBe(false);
    expect(fns.isCacheable(res({ headers: { 'Set-Cookie': 'a=b' } }))).toBe(
      false
    );
    expect(fns.isCacheable(res({ status: 302 }))).toBe(false);
    expect(fns.isCacheable(res({ status: 500 }))).toBe(false);
    expect(fns.isCacheable(res({ type: 'opaque' }))).toBe(false);
    expect(fns.isCacheable(null)).toBe(false);

    // public pages are SSR'd with "private, no-store"; the path allow-list governs, cookies still block
    expect(
      fns.isCacheable(
        res({ headers: { 'Cache-Control': 'private, no-store' } }),
        true
      )
    ).toBe(true);
    expect(
      fns.isCacheable(res({ headers: { 'Set-Cookie': 'a=b' } }), true)
    ).toBe(false);
  });
});

describe('service worker: events', () => {
  const fetchEvent = (url: string, mode = 'navigate') => {
    let promise: Promise<any> | undefined;

    return {
      event: {
        request: { url: ORIGIN + url, method: 'GET', mode },
        respondWith: (p: any) => (promise = p),
      },
      result: () => promise,
    };
  };

  it('stores a public page and serves it when the network is down', async () => {
    const w = load();
    const page = res();

    w.sandbox.fetch.mockResolvedValueOnce(page);

    const a = fetchEvent('/p/acme/jobs/dev');

    w.listeners.fetch(a.event);
    expect(await a.result()).toBe(page);
    await new Promise((r) => setImmediate(r));
    expect(Array.from(w.stores.get('public-pages-v1')!.keys())).toEqual([
      ORIGIN + '/p/acme/jobs/dev',
    ]);

    w.sandbox.fetch.mockRejectedValueOnce(new Error('offline'));

    const b = fetchEvent('/p/acme/jobs/dev');

    w.listeners.fetch(b.event);
    expect(await b.result()).toBe(page);
  });

  it('falls back to the offline page for uncached or signed-in navigation, and stores nothing', async () => {
    const w = load();

    await w.listeners.install({ waitUntil: (p: Promise<unknown>) => p });
    w.sandbox.fetch.mockResolvedValue(
      res({ headers: { 'Cache-Control': 'private' } })
    );

    const signedIn = fetchEvent('/me/applications');

    w.listeners.fetch(signedIn.event);
    await signedIn.result();
    expect(w.stores.get('public-pages-v1')).toBeUndefined();

    w.sandbox.fetch.mockRejectedValue(new Error('offline'));

    const offline = fetchEvent('/teams/acme/talent');

    w.listeners.fetch(offline.event);
    expect(await offline.result()).toEqual({ url: '/offline.html' });

    // a public page that was never visited also falls back
    const unseen = fetchEvent('/p/other');

    w.listeners.fetch(unseen.event);
    expect(await unseen.result()).toEqual({ url: '/offline.html' });
  });

  it('does not cache a private response even on a public path', async () => {
    const w = load();

    w.sandbox.fetch.mockResolvedValueOnce(
      res({ headers: { 'Set-Cookie': 'x=1' } })
    );

    const e = fetchEvent('/p/acme');

    w.listeners.fetch(e.event);
    await e.result();
    await new Promise((r) => setImmediate(r));
    expect(w.stores.get('public-pages-v1')?.size ?? 0).toBe(0);
  });

  it('does not intercept API calls', () => {
    const w = load();
    const e = fetchEvent('/api/candidate/profile', 'cors');
    const spy = jest.fn();

    w.listeners.fetch({ ...e.event, respondWith: spy });
    expect(spy).not.toHaveBeenCalled();
  });

  it('forgets stored pages on request (sign-out) and on activation of a new version', async () => {
    const w = load();

    w.sandbox.fetch.mockResolvedValueOnce(res());

    const e = fetchEvent('/p/acme');

    w.listeners.fetch(e.event);
    await e.result();
    await new Promise((r) => setImmediate(r));
    expect(w.stores.has('public-pages-v1')).toBe(true);

    await w.listeners.message({
      data: { type: 'CLEAR_CACHES' },
      waitUntil: (p: Promise<unknown>) => p,
    });
    expect(w.stores.has('public-pages-v1')).toBe(false);

    w.stores.set('static-v0', new Map());
    await w.listeners.activate({ waitUntil: (p: Promise<unknown>) => p });
    expect(w.stores.has('static-v0')).toBe(false);
  });
});

describe('service worker: push', () => {
  const push = (w: ReturnType<typeof load>, body: unknown, raw = false) =>
    w.listeners.push({
      data: { json: () => (raw ? JSON.parse(body as string) : body) },
      waitUntil: (p: Promise<unknown>) => p,
    });

  it('shows a notification with a safe, same-origin target', async () => {
    const w = load();

    await push(w, {
      title: 'Interview tomorrow',
      body: 'Technical round',
      url: '/teams/acme/interviews/1',
      tag: 'interview.reminder',
    });
    expect(w.shown[0]).toMatchObject({
      title: 'Interview tomorrow',
      body: 'Technical round',
      tag: 'interview.reminder',
      data: { url: '/teams/acme/interviews/1' },
    });
  });

  it('never opens another origin, and copes with bad payloads', async () => {
    const w = load();

    await push(w, { title: 'x', url: 'https://evil.example/phish' });
    await push(w, { title: 'x', url: '//evil.example' });
    await push(w, { title: 'x', url: 'javascript:alert(1)' });
    expect(w.shown.map((s) => s.data.url)).toEqual(['/', '/', '/']);

    await push(w, '{not json', true);
    expect(w.shown[3]).toMatchObject({
      title: 'Notification',
      data: { url: '/' },
    });

    await push(w, { title: 't'.repeat(500), body: 'b'.repeat(500) });
    expect(w.shown[4].title.length).toBe(80);
    expect(w.shown[4].body.length).toBe(140);
  });

  it('click focuses an open window and navigates, or opens a new one', async () => {
    const w = load();
    const close = jest.fn();
    const click = (url: string) =>
      w.listeners.notificationclick({
        notification: { close, data: { url } },
        waitUntil: (p: Promise<unknown>) => p,
      });

    await click('/me/applications');
    expect(close).toHaveBeenCalled();
    expect(w.opened).toEqual(['/me/applications']);

    const focus = jest.fn(async () => undefined);
    const navigate = jest.fn();

    w.clientsList.push({ focus, navigate });
    await click('https://evil.example/x');
    expect(focus).toHaveBeenCalled();
    await new Promise((r) => setImmediate(r));
    expect(navigate).toHaveBeenCalledWith('/');
  });
});
