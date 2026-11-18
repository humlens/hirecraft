import { devices, expect, test, type Page } from '@playwright/test';

import { prisma } from '@/lib/prisma';
import { LoginPage } from '../support/fixtures';
import { user } from '../support/helper';

// Needs the app started with VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY set.
const slug = 'mobile-co';
const cand = {
  name: 'Mia Mobile',
  email: 'mia.mobile@gmail.com',
  password: 'candidate@123',
};
const PHONE = devices['Pixel 5'];

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await prisma.team.deleteMany({ where: { slug } });
  await prisma.user.deleteMany({
    where: { email: { in: [cand.email, 'second.mobile@gmail.com'] } },
  });
});

const login = async (page: Page, email: string, password: string) => {
  const l = new LoginPage(page);
  await l.goto();
  await l.credentialLogin(email, password);
  await page.waitForURL(/\/(teams\/.+|me|onboarding)/);
};

const noHorizontalScroll = async (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1
  );

let jobId = '';
let applicationId = '';

test('set up: portal, published job, two candidates who applied', async ({
  page,
  browser,
}) => {
  await login(page, user.email, user.password);
  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Company name').fill('Mobile Co');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create portal' }).click();
  await page.waitForURL(`/teams/${slug}/dashboard`);

  const created = await page.request.post(`/api/teams/${slug}/jobs`, {
    data: {
      title: 'Mobile Engineer',
      descriptionHtml: '<p>Build and run the apps behind our product.</p>',
      workMode: 'REMOTE',
    },
  });
  expect(created.status()).toBe(201);
  jobId = (await created.json()).data.id;
  await page.request.post(`/api/teams/${slug}/jobs/${jobId}/actions`, {
    data: { action: 'publish' },
  });

  for (const [i, c] of [
    cand,
    {
      name: 'Sam Second',
      email: 'second.mobile@gmail.com',
      password: 'candidate@123',
    },
  ].map((c, i) => [i, c] as const)) {
    const ctx = await browser.newContext();
    const cp = await ctx.newPage();
    expect(
      (await cp.request.post('/api/candidate/register', { data: c })).status()
    ).toBe(201);
    await login(cp, c.email, c.password);
    const up = await cp.request.post('/api/candidate/resumes', {
      data: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(300, 'x')]),
      headers: { 'Content-Type': 'application/pdf', 'X-File-Name': 'cv.pdf' },
    });
    const apply = await cp.request.post(
      `/api/public/portals/${slug}/jobs/mobile-engineer/apply`,
      {
        data: {
          resumeId: (await up.json()).data.id,
          consent: { application: true, talentPool: true },
        },
      }
    );
    expect(apply.status()).toBe(201);
    if (i === 0) applicationId = (await apply.json()).data.applicationId;
    await ctx.close();
  }
});

test('PWA files are public, valid and served with the right headers', async ({
  request,
}) => {
  const m = await request.get('/manifest.webmanifest');
  expect(m.status()).toBe(200);

  const manifest = await m.json();
  expect(manifest).toMatchObject({
    display: 'standalone',
    scope: '/',
    theme_color: '#3346D3',
  });
  expect(
    manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')
  ).toBe(true);

  for (const icon of manifest.icons) {
    const r = await request.get(icon.src);
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toContain('image/png');
  }

  const sw = await request.get('/sw.js');
  expect(sw.status()).toBe(200);
  expect(sw.headers()['cache-control']).toContain('no-cache');
  expect(sw.headers()['service-worker-allowed']).toBe('/');
  expect((await request.get('/offline.html')).status()).toBe(200);

  const pm = await request.get(`/api/public/portals/${slug}/manifest`);
  expect(pm.status()).toBe(200);
  expect((await pm.json()).start_url).toBe(`/p/${slug}`);
});

test('public pages link their manifest and allow the worker in the CSP', async ({
  page,
}) => {
  const r = await page.goto(`/p/${slug}`);
  // the CSP is only sent when SECURITY_HEADERS_ENABLED is on; when it is, the worker must be allowed
  const csp = r?.headers()['content-security-policy'];
  if (csp) expect(csp).toContain("worker-src 'self'");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    `/api/public/portals/${slug}/manifest`
  );
});

test('offline: visited public job pages still open; signed-in pages show the offline notice and are never cached', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto(`/p/${slug}/jobs/mobile-engineer`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  // reload once so the worker controls the page and stores it
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.reload();

  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls: string[] = [];
    for (const n of names) {
      for (const k of await (await caches.open(n)).keys())
        urls.push(new URL(k.url).pathname);
    }
    return urls;
  });
  expect(cached).toContain(`/p/${slug}/jobs/mobile-engineer`);
  expect(
    cached.some(
      (p) =>
        p.startsWith('/api/') || p.startsWith('/me') || p.startsWith('/teams')
    )
  ).toBe(false);

  await ctx.setOffline(true);
  await page.goto(`/p/${slug}/jobs/mobile-engineer`);
  await expect(page.getByText('Mobile Engineer').first()).toBeVisible();

  await page.goto('/me/applications').catch(() => undefined);
  await expect(
    page.getByRole('heading', { name: 'You are offline' })
  ).toBeVisible();
  await ctx.close();
});

test('phone layouts: no horizontal scrolling on any screen', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ ...PHONE });
  const page = await ctx.newPage();
  const failures: string[] = [];
  const check = async (path: string) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    if (!(await noHorizontalScroll(page))) failures.push(path);
  };

  for (const p of [
    `/p/${slug}`,
    `/p/${slug}/jobs`,
    `/p/${slug}/jobs/mobile-engineer`,
    '/auth/login',
    '/auth/join',
  ]) {
    await check(p);
  }

  await login(page, cand.email, cand.password);
  await page.goto('/me');
  await expect(
    page.getByRole('navigation', { name: 'Quick navigation' })
  ).toBeVisible();
  for (const p of [
    '/me',
    '/me/applications',
    '/me/profile',
    '/me/offers',
    '/me/notifications',
    '/me/privacy',
    `/p/${slug}/apply/mobile-engineer`,
  ]) {
    await check(p);
  }

  const owner = await browser.newContext({ ...PHONE });
  const op = await owner.newPage();
  await login(op, user.email, user.password);
  for (const p of [
    `/teams/${slug}/settings`,
    `/teams/${slug}/jobs`,
    `/teams/${slug}/jobs/new`,
    `/teams/${slug}/jobs/${jobId}`,
    `/teams/${slug}/jobs/${jobId}/pipeline`,
    `/teams/${slug}/applications/${applicationId}`,
    `/teams/${slug}/talent`,
    `/teams/${slug}/interviews`,
    `/teams/${slug}/offers`,
    `/teams/${slug}/messages`,
    `/teams/${slug}/analytics`,
    `/teams/${slug}/settings/pipeline`,
    `/teams/${slug}/portal`,
    `/teams/${slug}/members`,
    `/teams/${slug}/roles`,
    `/teams/${slug}/review`,
    `/teams/${slug}/ai`,
    `/teams/${slug}/copilot`,
    '/notifications',
  ]) {
    await op.goto(p);
    await op.waitForLoadState('networkidle');
    if (!(await noHorizontalScroll(op))) failures.push(p);
  }

  expect(failures).toEqual([]);
  await owner.close();
  await ctx.close();
});

test('review queue on a phone: skip, shortlist, cleared', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ ...PHONE });
  const page = await ctx.newPage();

  await login(page, user.email, user.password);
  await page.goto(`/teams/${slug}/review`);
  await expect(page.getByText('Review queue')).toBeVisible();
  await expect(page.getByText('To review', { exact: true })).toBeVisible();

  const first = await page.getByRole('article').getAttribute('aria-label');
  await page.getByRole('button', { name: 'Later' }).click();
  const second = await page.getByRole('article').getAttribute('aria-label');
  expect(second).not.toBe(first);

  await page.getByRole('button', { name: 'Shortlist' }).click();
  await expect(page.getByText(/^Moved to /)).toBeVisible();

  // only the skipped one is left, and it was not moved
  const team = await prisma.team.findUniqueOrThrow({ where: { slug } });
  const left = await prisma.jobApplication.count({
    where: { teamId: team.id, stage: { name: 'Applied' } },
  });
  expect(left).toBe(1);
  // the skipped card stays out of the way until asked for again
  await expect(page.getByText('Queue cleared')).toBeVisible();
  await page.getByRole('button', { name: 'Show skipped again' }).click();
  await expect(page.getByRole('article')).toHaveAttribute(
    'aria-label',
    first as string
  );

  await page.getByRole('button', { name: 'Shortlist' }).click();
  await expect(page.getByText('Queue cleared')).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Quick navigation' })
  ).toBeVisible();
  await ctx.close();
});

test('push is opt-in: nothing is asked until the user taps, then preferences include Push', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ ...PHONE });
  const page = await ctx.newPage();

  await login(page, cand.email, cand.password);
  await page.goto('/me/notifications');
  await expect(
    page.getByRole('heading', { name: 'Push notifications on this device' })
  ).toBeVisible();
  expect(await page.evaluate(() => Notification.permission)).toBe('default');
  await expect(
    page.getByRole('button', { name: 'Turn on notifications' })
  ).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Push' })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  expect(await prisma.pushSubscription.count()).toBe(0);
  await ctx.close();
});
