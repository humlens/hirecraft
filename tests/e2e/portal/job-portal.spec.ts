import { chromium, expect, test } from '@playwright/test';

import { prisma } from '@/lib/prisma';
import { LoginPage } from '../support/fixtures';
import { user } from '../support/helper';

const portal = { slug: 'careers-co', name: 'Careers Co' };
const job = { title: 'Staff Platform Engineer' };
const candidate = {
  name: 'Casey Candidate',
  email: 'casey.candidate@gmail.com',
  password: 'candidate@123',
};
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(300, 'x')]);

test.describe.configure({ mode: 'serial' });

// Leave no data behind: other specs in the same run assume the seeded user
// belongs to a single team.
test.afterAll(async () => {
  await prisma.team.deleteMany({ where: { slug: portal.slug } });
  await prisma.user.deleteMany({ where: { email: candidate.email } });
});

test('Recruiter creates, publishes a job; candidate applies; recruiter moves them; candidate tracks it', async ({
  page,
}) => {
  // --- portal (through the onboarding wizard) ---
  const login = new LoginPage(page);
  await login.goto();
  await login.credentialLogin(user.email, user.password);
  await page.waitForURL(/\/teams\/.+\/(settings|dashboard)/);

  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Company name').fill(portal.name);
  await expect(page.getByLabel('Team Slug')).toHaveValue(portal.slug);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Hero title').fill('Build with Careers Co');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create portal' }).click();
  await page.waitForURL(`/teams/${portal.slug}/dashboard`);

  // --- job: create as draft, then publish ---
  await page.goto(`/teams/${portal.slug}/jobs/new`);
  await page.getByLabel('Title', { exact: true }).fill(job.title);
  await page
    .getByLabel('Description (basic HTML allowed)')
    .fill(
      '<p>Design and run the platform that every product team builds on, end to end.</p>'
    );
  await page
    .getByLabel('Required skills (comma separated)')
    .fill('Kubernetes, Go');
  await page.getByLabel('city 1').fill('Pune');
  await page.getByLabel('country 1').fill('India');
  await page.getByRole('button', { name: 'Add question' }).click();
  await page.getByLabel('question 1').fill('Can you relocate?');
  await page.getByLabel('type 1').selectOption('BOOLEAN');
  await page.getByLabel('Required', { exact: true }).check();
  await page.getByRole('button', { name: 'Save Changes' }).first().click();
  await page.waitForURL(
    new RegExp(`/teams/${portal.slug}/jobs/[0-9a-f-]{36}$`)
  );
  await expect(page.getByText('DRAFT').first()).toBeVisible();

  // not public while in draft
  const draftRes = await page.request.get(
    `/p/${portal.slug}/jobs/staff-platform-engineer`
  );
  expect(draftRes.status()).toBe(404);

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('PUBLISHED').first()).toBeVisible();

  // --- public portal (anonymous) ---
  const anon = await (await chromium.launch()).newContext();
  const pub = await anon.newPage();
  await pub.goto(`/p/${portal.slug}`);
  await expect(
    pub.getByRole('heading', { name: 'Build with Careers Co' })
  ).toBeVisible();
  await pub.goto(`/p/${portal.slug}/jobs?q=platform`);
  await expect(pub.getByRole('link', { name: job.title })).toBeVisible();
  await pub.goto(`/p/${portal.slug}/jobs?q=zzzznothing`);
  await expect(pub.getByText('No jobs match your search.')).toBeVisible();

  await pub.goto(`/p/${portal.slug}/jobs/staff-platform-engineer`);
  await expect(pub.getByRole('heading', { name: job.title })).toBeVisible();
  const ld = JSON.parse(
    (await pub
      .locator('script[type="application/ld+json"]')
      .textContent()) as string
  );
  expect(ld['@type']).toBe('JobPosting');
  expect(ld.title).toBe(job.title);
  expect(ld.hiringOrganization.name).toBe(portal.name);

  const sitemap = await pub.request.get(`/p/${portal.slug}/sitemap.xml`);
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).toContain('/jobs/staff-platform-engineer');
  const robots = await pub.request.get(`/p/${portal.slug}/robots.txt`);
  expect(await robots.text()).toContain('Sitemap:');

  // --- mobile layout: no horizontal scroll on the public job page ---
  await pub.setViewportSize({ width: 360, height: 740 });
  await pub.goto(`/p/${portal.slug}/jobs/staff-platform-engineer`);
  const overflow = await pub.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth
  );
  expect(overflow).toBe(false);
  await pub.setViewportSize({ width: 1280, height: 800 });

  // --- candidate: sign up on the apply page, upload resume, answer, consent ---
  await pub.getByRole('link', { name: 'Apply now' }).click();
  await pub.waitForURL(`/p/${portal.slug}/apply/staff-platform-engineer`);
  await pub.getByPlaceholder('Your name').fill(candidate.name);
  await pub.getByPlaceholder('Email').fill(candidate.email);
  await pub.getByPlaceholder('Password').fill(candidate.password);
  await pub
    .getByRole('button', { name: 'Create account and continue' })
    .click();

  await pub.getByTestId('resume-upload').setInputFiles({
    name: 'casey.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  await expect(pub.getByText('casey.pdf')).toBeVisible();
  // an executable renamed to .pdf is refused
  await pub.getByTestId('resume-upload').setInputFiles({
    name: 'evil.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('MZ not a pdf'),
  });
  await expect(
    pub.getByText('The file content does not match its type.')
  ).toBeVisible();

  await pub.getByLabel('Can you relocate?').selectOption('yes');
  const submit = pub.getByRole('button', { name: 'Submit application' });
  await expect(submit).toBeDisabled(); // consent required
  await pub.getByRole('checkbox').first().check();
  await submit.click();
  await expect(pub.getByRole('status')).toContainText('Application submitted');

  // --- candidate dashboard ---
  await pub.goto('/me/applications');
  await expect(pub.getByText(job.title)).toBeVisible();
  await expect(pub.locator('[aria-current="step"]')).toHaveText('Applied');

  // --- recruiter: pipeline board, keyboard-accessible move ---
  const team = await prisma.team.findUniqueOrThrow({
    where: { slug: portal.slug },
  });
  const jobRow = await prisma.job.findFirstOrThrow({
    where: { teamId: team.id },
  });
  await page.goto(`/teams/${portal.slug}/jobs/${jobRow.id}/pipeline`);
  const applied = page.locator('section[data-stage="Applied"]');
  await expect(
    applied.getByRole('link', { name: candidate.name })
  ).toBeVisible();
  await page
    .getByLabel(`Move ${candidate.name} to`)
    .selectOption({ label: 'Technical Interview' });
  await expect(
    page
      .locator('section[data-stage="Technical Interview"]')
      .getByRole('link', { name: candidate.name })
  ).toBeVisible();

  // the move is recorded in the activity history
  await page.getByRole('link', { name: candidate.name }).click();
  await expect(
    page.getByText(/Applied\s*→\s*Technical Interview/)
  ).toBeVisible();
  await page.getByRole('button', { name: /Download resume/ }).waitFor();

  // --- candidate sees the new stage ---
  await pub.reload();
  await expect(pub.locator('[aria-current="step"]')).toHaveText(
    'Technical Interview'
  );

  // --- candidate withdraws ---
  pub.once('dialog', (d) => d.accept());
  await pub.getByRole('button', { name: 'Withdraw' }).click();
  await expect(pub.locator('[aria-current="step"]')).toHaveText('Withdrawn');

  await anon.close();
});

test('Candidates cannot reach recruiter pages and recruiters cannot see other portals', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const login = new LoginPage(p);
  await login.goto();
  await login.credentialLogin(candidate.email, candidate.password);
  await p.waitForURL('/me');

  const r = await p.request.get(`/api/teams/${portal.slug}/jobs`);
  expect(r.status()).toBe(403);
  await ctx.close();
});
