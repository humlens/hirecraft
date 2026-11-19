import { expect, test } from '@playwright/test';

import { prisma } from '@/lib/prisma';
import { LoginPage } from '../support/fixtures';
import { user } from '../support/helper';

const portal = { name: 'City General Hospital', slug: 'city-general-hospital' };

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await prisma.team.deleteMany({ where: { slug: portal.slug } });
});

test('a hospital template gives the pipeline, wording and suggested roles', async ({
  page,
}) => {
  const login = new LoginPage(page);

  await login.goto();
  await login.credentialLogin(user.email, user.password);
  await page.waitForURL(/\/teams\/.+\/(settings|dashboard)/);

  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: /Hospital & health system/ }).click();
  await page.getByLabel('Company name').fill(portal.name);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByLabel('Hero title')).toHaveValue(/Care for people/);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByLabel('Registered Nurse, ICU')).toBeChecked();
  await page.getByLabel('Registered Nurse, ICU').uncheck();
  await page.getByRole('button', { name: 'Create portal' }).click();
  await page.waitForURL(`/teams/${portal.slug}/dashboard`);

  const team = await prisma.team.findUniqueOrThrow({
    where: { slug: portal.slug },
  });
  const stages = await prisma.pipelineStage.findMany({
    where: { teamId: team.id, jobId: null },
  });

  expect(stages.map((s) => s.name)).toContain('Credential Verification');

  const jobs = await prisma.job.findMany({ where: { teamId: team.id } });
  const titles = jobs.map((j) => j.title);

  expect(titles).toContain('Hospitalist Physician');
  expect(titles).not.toContain('Registered Nurse, ICU');
  expect(jobs.every((j) => j.status === 'DRAFT')).toBe(true);
});

test('a job starts from a healthcare template, publishes and shows licence and shift', async ({
  page,
}) => {
  const login = new LoginPage(page);

  await login.goto();
  await login.credentialLogin(user.email, user.password);
  await page.waitForURL(/\/teams\/.+\/(settings|dashboard)/);

  await page.goto(`/teams/${portal.slug}/jobs/new`);
  await page.getByRole('button', { name: /Registered Nurse, ICU/ }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
    'Registered Nurse, ICU'
  );
  await expect(page.getByLabel('Registration body')).toHaveValue(
    'Nursing council'
  );
  // templates leave the location to the employer; onsite jobs need one to publish
  await page.getByLabel('city 1').fill('Pune');
  await page.getByLabel('country 1').fill('India');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await page.waitForURL(
    new RegExp(`/teams/${portal.slug}/jobs/[0-9a-f-]{36}$`)
  );
  await page.getByRole('button', { name: 'Publish' }).first().click();
  await expect(
    page.locator('.badge', { hasText: /^PUBLISHED$/ })
  ).toBeVisible();

  await page.goto(`/p/${portal.slug}/jobs/registered-nurse-icu`);
  await expect(page.getByText('Critical care', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Rotating shifts', { exact: true })
  ).toBeVisible();
  await expect(page.getByText('ACLS', { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Current registration with Nursing council is required/)
  ).toBeVisible();
});
