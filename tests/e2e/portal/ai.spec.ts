import { expect, test, type Page } from '@playwright/test';

import { prisma } from '@/lib/prisma';
import { LoginPage } from '../support/fixtures';
import { user } from '../support/helper';
import { makePdf } from '../../../__tests__/helpers/files';

// Needs the app started with AI_DEFAULT_PROVIDER=fake (and the fake allowed): no network, no key.
const slug = 'ai-co';
const cand = {
  name: 'Nina Node',
  email: 'nina.node@gmail.com',
  password: 'candidate@123',
};

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await prisma.team.deleteMany({ where: { slug } });
  await prisma.user.deleteMany({ where: { email: cand.email } });
});

const login = async (page: Page, email: string, password: string) => {
  const l = new LoginPage(page);
  await l.goto();
  await l.credentialLogin(email, password);
  await page.waitForURL(/\/(teams\/.+|me|onboarding)/);
};

let applicationId = '';

test('set up a portal, a job, and a candidate who uploads a resume and applies', async ({
  page,
  browser,
}) => {
  await login(page, user.email, user.password);
  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Company name').fill('AI Co');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create portal' }).click();
  await page.waitForURL(`/teams/${slug}/dashboard`);

  const created = await page.request.post(`/api/teams/${slug}/jobs`, {
    data: {
      title: 'Backend Engineer',
      descriptionHtml: '<p>Build and run the services behind our product.</p>',
      workMode: 'REMOTE',
      skills: [
        { skill: 'Node.js', required: true },
        { skill: 'PostgreSQL', required: true },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const jobId = (await created.json()).data.id;
  expect(
    (
      await page.request.post(`/api/teams/${slug}/jobs/${jobId}/actions`, {
        data: { action: 'publish' },
      })
    ).status()
  ).toBe(200);

  const ctx = await browser.newContext();
  const cp = await ctx.newPage();
  expect(
    (await cp.request.post('/api/candidate/register', { data: cand })).status()
  ).toBe(201);
  await login(cp, cand.email, cand.password);
  const up = await cp.request.post('/api/candidate/resumes', {
    data: makePdf([
      'Nina Node, backend engineer with six years of experience building APIs.',
      'Skills: Node.js, PostgreSQL, Docker',
    ]),
    headers: { 'Content-Type': 'application/pdf', 'X-File-Name': 'nina.pdf' },
  });
  expect(up.status()).toBe(201);
  const apply = await cp.request.post(
    `/api/public/portals/${slug}/jobs/backend-engineer/apply`,
    {
      data: {
        resumeId: (await up.json()).data.id,
        consent: { application: true, talentPool: true },
      },
    }
  );
  expect(apply.status()).toBe(201);
  applicationId = (await apply.json()).data.applicationId;
  await ctx.close();
});

test('AI settings: test the connection, switch a feature off and save', async ({
  page,
}) => {
  await login(page, user.email, user.password);
  await page.goto(`/teams/${slug}/ai`);
  await expect(
    page.getByRole('heading', { name: 'AI providers, usage & governance' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText('Connection works.')).toBeVisible();

  await page.getByLabel('Candidate communication drafts').uncheck();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  const team = await prisma.team.findUniqueOrThrow({ where: { slug } });
  const cfg = await prisma.aIProviderConfig.findFirstOrThrow({
    where: { teamId: team.id },
  });
  expect((cfg.enabledFeatures as Record<string, boolean>)['comms.draft']).toBe(
    false
  );
  // the key field never shows a secret
  await expect(page.getByLabel('Your own API key (optional)')).toHaveValue('');
});

test('the job form writes a draft description with AI', async ({ page }) => {
  await login(page, user.email, user.password);
  await page.goto(`/teams/${slug}/jobs/new`);
  await page.getByLabel('Title', { exact: true }).fill('Platform Engineer');
  await page.getByRole('button', { name: 'Write with AI' }).click();
  await expect(page.getByText('Draft written')).toBeVisible();
  await expect(page.locator('textarea[name="descriptionHtml"]')).toHaveValue(
    /Join our team/
  );
});

test('an assessment explains itself and never moves the application', async ({
  page,
}) => {
  await login(page, user.email, user.password);
  await page.goto(`/teams/${slug}/applications/${applicationId}`);
  await page.getByRole('button', { name: 'Assess candidate' }).click();
  await expect(
    page.getByText('It never decides an application.')
  ).toBeVisible();
  await expect(page.getByRole('img', { name: /%$/ })).toBeVisible();
  await expect(page.locator('.badge', { hasText: /^Applied$/ })).toBeVisible();
});

test('natural-language talent search shows removable filter chips', async ({
  page,
}) => {
  await login(page, user.email, user.password);
  await page.goto(`/teams/${slug}/talent`);
  await page
    .getByLabel('Search in plain language')
    .fill('experienced backend engineer');
  await page
    .getByRole('button', { name: 'Search', exact: true })
    .first()
    .click();
  await expect(page.getByText('AI read this as:')).toBeVisible();
  await expect(
    page.getByRole('link', { name: cand.name }).first()
  ).toBeVisible();
  await page
    .getByRole('button', { name: /Remove filter/ })
    .first()
    .click();
  await expect(
    page.getByText('Protected attributes are never filters')
  ).toBeVisible();
});

test('the copilot answers and lists what it used', async ({ page }) => {
  await login(page, user.email, user.password);
  await page.goto(`/teams/${slug}/copilot`);
  await page
    .getByRole('button', { name: 'Summarize applications for my jobs' })
    .click();
  await expect(
    page.getByText('Here is what I found in your records.')
  ).toBeVisible();
});

test('the candidate can opt in to AI recommendations per portal', async ({
  page,
}) => {
  await login(page, cand.email, cand.password);
  await page.goto('/me/privacy');
  const toggle = page.getByLabel('AI Co');
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.reload();
  await expect(page.getByLabel('AI Co')).toBeChecked();
});
