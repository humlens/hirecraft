import http from 'http';
import { devices, expect, test, type Page } from '@playwright/test';

import { prisma } from '@/lib/prisma';
import { LoginPage } from '../support/fixtures';
import { user } from '../support/helper';

/**
 * Needs the app started with
 *   ENTITLEMENTS_ENFORCEMENT=on PLATFORM_ADMIN_EMAILS=jackson@example.com PORTAL_CNAME_TARGET=portals.platform.test
 * (limits are off by default for self-hosted installs without billing).
 */
const slug = 'plan-co';
const PHONE = devices['Pixel 5'];

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await prisma.team.deleteMany({ where: { slug } });
});

const login = async (page: Page, email: string, password: string) => {
  const l = new LoginPage(page);
  await l.goto();
  await l.credentialLogin(email, password);
  await page.waitForURL(/\/(teams\/.+|me|onboarding)/);
};

const jobs: string[] = [];

test('set up a Free portal with three draft jobs', async ({ page }) => {
  await prisma.user.updateMany({
    where: { email: user.email },
    data: { emailVerified: new Date() },
  });
  await login(page, user.email, user.password);
  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Company name').fill('Plan Co');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create portal' }).click();
  await page.waitForURL(`/teams/${slug}/dashboard`);

  for (const title of ['First role', 'Second role', 'Third role']) {
    const r = await page.request.post(`/api/teams/${slug}/jobs`, {
      data: {
        title,
        descriptionHtml:
          '<p>Build and run the services behind our product.</p>',
        workMode: 'REMOTE',
      },
    });
    expect(r.status()).toBe(201);
    jobs.push((await r.json()).data.id);
  }
});

test('the plan limit is enforced and the upgrade message reaches the user', async ({
  page,
}) => {
  await login(page, user.email, user.password);

  for (const id of jobs.slice(0, 2)) {
    const r = await page.request.post(`/api/teams/${slug}/jobs/${id}/actions`, {
      data: { action: 'publish' },
    });
    expect(r.status()).toBe(200);
  }

  await page.goto(`/teams/${slug}/jobs/${jobs[2]}`);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(
    page.getByText(/Your Free plan allows 2 active jobs/)
  ).toBeVisible();
  await expect(page.getByText(/Upgrade to Starter/)).toBeVisible();

  const api = await page.request.post(
    `/api/teams/${slug}/jobs/${jobs[2]}/actions`,
    { data: { action: 'publish' } }
  );
  expect(api.status()).toBe(402);
  expect((await api.json()).error).toMatchObject({
    code: 'plan_limit',
    upgradeTo: 'starter',
  });

  const plan = await (await page.request.get(`/api/teams/${slug}/plan`)).json();
  expect(plan.data.usage.activeJobs).toBe(2);
  expect(plan.data.limits.activeJobs).toBe(2);
});

test('a failed payment shows a banner, then makes the portal read-only', async ({
  page,
}) => {
  await login(page, user.email, user.password);

  const team = await prisma.team.findUniqueOrThrow({ where: { slug } });
  await prisma.team.update({
    where: { id: team.id },
    data: { paymentFailedAt: new Date(Date.now() - 2 * 86400_000) },
  });
  await page.goto(`/teams/${slug}/jobs`);
  await expect(
    page.getByRole('alert').filter({ hasText: 'A payment failed' })
  ).toBeVisible();

  await prisma.team.update({
    where: { id: team.id },
    data: { paymentFailedAt: new Date(Date.now() - 9 * 86400_000) },
  });
  await page.goto(`/teams/${slug}/jobs`);
  await expect(
    page.getByRole('alert').filter({ hasText: 'read-only' })
  ).toBeVisible();

  const write = await page.request.post(`/api/teams/${slug}/jobs`, {
    data: {
      title: 'Blocked role',
      descriptionHtml: '<p>Build and run the services behind our product.</p>',
      workMode: 'REMOTE',
    },
  });
  expect(write.status()).toBe(402);
  expect((await write.json()).error.code).toBe('read_only');
  expect((await page.request.get(`/api/teams/${slug}/jobs`)).status()).toBe(
    200
  );

  await prisma.team.update({
    where: { id: team.id },
    data: { paymentFailedAt: null },
  });
});

test('integrations page: apps need a plan, the custom domain shows its DNS records', async ({
  page,
}) => {
  await login(page, user.email, user.password);
  await page.goto(`/teams/${slug}/settings/integrations`);
  await expect(
    page.getByRole('heading', { name: 'Integrations, webhooks & domain' })
  ).toBeVisible();
  await expect(
    page.getByText('Not included in your plan').first()
  ).toBeVisible();

  // Free plan: the domain is refused with an upgrade hint
  const no = await page.request.post(`/api/teams/${slug}/domain`, {
    data: { hostname: 'careers.plan-co.example.org' },
  });
  expect(no.status()).toBe(402);

  // the platform admin can lift the plan for a portal
  const team = await prisma.team.findUniqueOrThrow({ where: { slug } });
  await prisma.team.update({
    where: { id: team.id },
    data: { planOverride: 'enterprise' },
  });

  await page.reload();
  await page.getByLabel('Domain').fill('Careers.Plan-Co.example.org');
  await page.getByRole('button', { name: 'Add domain' }).click();
  await expect(
    page.locator('strong', { hasText: 'careers.plan-co.example.org' })
  ).toBeVisible();
  await expect(
    page.getByText(/_verify\.careers\.plan-co\.example\.org/)
  ).toBeVisible();
  await expect(page.getByText('portals.platform.test')).toBeVisible();
  await expect(page.getByText('Waiting for DNS records')).toBeVisible();

  // DNS is not set up in the test environment, so verification does not succeed
  await page.getByRole('button', { name: 'Check DNS' }).click();
  await expect(page.getByText(/was not found yet/)).toBeVisible();
  expect(
    await prisma.portalDomain.count({
      where: { teamId: team.id, verifiedAt: { not: null } },
    })
  ).toBe(0);

  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByLabel('Domain')).toBeVisible();
});

test('platform admin: list, suspend with a reason, the portal is locked, activate', async ({
  page,
  request,
}) => {
  await login(page, user.email, user.password);
  await page.goto('/admin');
  await expect(
    page.getByRole('heading', { name: 'Platform admin' })
  ).toBeVisible();
  await page.getByLabel('Search tenants').fill(slug);
  await expect(page.getByRole('row', { name: /Plan Co/ })).toBeVisible();

  page.once('dialog', (d) => d.accept('spam job posts'));
  await page
    .getByRole('row', { name: /Plan Co/ })
    .getByRole('button', { name: 'Suspend' })
    .click();
  await expect(
    page.getByRole('row', { name: /Plan Co/ }).getByText('Suspended')
  ).toBeVisible();

  // every tenant API is locked, and the public pages show a notice
  const locked = await page.request.get(`/api/teams/${slug}/jobs`);
  expect(locked.status()).toBe(403);
  expect((await locked.json()).error.message).toContain('spam job posts');
  await page.goto(`/p/${slug}`);
  await expect(
    page.getByText('This careers portal is temporarily unavailable.')
  ).toBeVisible();
  expect(
    (await request.get(`/api/public/portals/${slug}/manifest`)).status()
  ).toBe(404);

  await page.goto('/admin');
  await page.getByLabel('Search tenants').fill(slug);
  await page
    .getByRole('row', { name: /Plan Co/ })
    .getByRole('button', { name: 'Activate' })
    .click();
  await expect(
    page.getByRole('row', { name: /Plan Co/ }).getByText('Active')
  ).toBeVisible();
  expect((await page.request.get(`/api/teams/${slug}/jobs`)).status()).toBe(
    200
  );

  await page.getByRole('tab', { name: 'Audit log' }).click();
  await expect(page.getByText('tenant.suspend').first()).toBeVisible();
  await expect(page.getByText('tenant.activate').first()).toBeVisible();
});

test('a verified custom domain serves the public portal; everything else goes to the platform host', async () => {
  const team = await prisma.team.findUniqueOrThrow({ where: { slug } });
  const host = 'careers.plan-co.example.org';

  await prisma.portalDomain.create({
    data: {
      teamId: team.id,
      hostname: host,
      verificationToken: 'x',
      verifiedAt: new Date(),
      certificateStatus: 'READY',
    },
  });

  const get = (path: string, hostHeader: string) =>
    new Promise<{ status: number; location?: string; body: string }>(
      (resolve, reject) => {
        http
          .get(
            {
              host: '127.0.0.1',
              port: 4002,
              path,
              headers: { Host: hostHeader },
            },
            (res) => {
              let body = '';
              res.on('data', (c) => (body += c));
              res.on('end', () =>
                resolve({
                  status: res.statusCode ?? 0,
                  location: res.headers.location,
                  body,
                })
              );
            }
          )
          .on('error', reject);
      }
    );

  const home = await get('/', host);
  expect(home.status).toBe(200);
  expect(home.body).toContain('Plan Co');

  expect((await get('/jobs', host)).status).toBe(200);
  expect((await get('/sitemap.xml', host)).status).toBe(200);

  // sign-in, apply and the app live on the platform host (cookies are per host)
  for (const path of [
    '/me',
    '/auth/login',
    `/p/${slug}/apply/anything`,
    `/teams/${slug}/jobs`,
  ]) {
    const r = await get(path, host);
    expect(r.status).toBe(307);
    // an absolute platform URL (Next shortens it to a path when the platform is the listening origin, as here)
    expect(
      r.location === `http://localhost:4002${path}` || r.location === path
    ).toBe(true);
  }

  // another portal is never reachable through this domain, and unknown hosts are refused
  expect((await get('/p/some-other-portal', host)).status).toBe(404);
  expect((await get('/', 'unknown.example.org')).status).toBe(404);
  expect((await get('/', 'localhost:4002')).status).toBe(200); // the platform itself is unaffected

  // a suspended portal's domain shows the notice with a 403
  await prisma.team.update({
    where: { id: team.id },
    data: { status: 'SUSPENDED' },
  });
  expect((await get('/', host)).status).toBe(403);
  await prisma.team.update({
    where: { id: team.id },
    data: { status: 'ACTIVE' },
  });
  await prisma.portalDomain.deleteMany({ where: { teamId: team.id } });
});

test('only platform admins can open the admin area', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const c = {
    name: 'Nora Normal',
    email: 'nora.normal@gmail.com',
    password: 'candidate@123',
  };

  expect(
    (await page.request.post('/api/candidate/register', { data: c })).status()
  ).toBe(201);
  await login(page, c.email, c.password);

  for (const path of [
    '/api/admin/tenants',
    '/api/admin/plans',
    '/api/admin/audit',
    '/api/admin/ai',
  ]) {
    const r = await page.request.get(path);
    expect(r.status()).toBe(403);
    expect(await r.text()).not.toContain('Plan Co');
  }

  const patch = await page.request.patch(`/api/admin/tenants/anything`, {
    data: { status: 'SUSPENDED' },
  });
  expect(patch.status()).toBe(403);

  await page.goto('/admin');
  await expect(
    page.getByText('You do not have access to this area.').first()
  ).toBeVisible();
  await prisma.user.deleteMany({ where: { email: c.email } });
  await ctx.close();
});

test('phone layouts: integrations and admin do not scroll sideways', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ ...PHONE });
  const page = await ctx.newPage();

  await login(page, user.email, user.password);

  for (const p of [
    `/teams/${slug}/settings/integrations`,
    '/admin',
    `/teams/${slug}/billing`,
  ]) {
    await page.goto(p);
    await page.waitForLoadState('networkidle');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1
      )
    ).toBe(true);
  }

  await ctx.close();
});
