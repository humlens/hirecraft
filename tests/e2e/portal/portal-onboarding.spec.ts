import { chromium, expect, test } from '@playwright/test';

import { prisma } from '@/lib/prisma';
import { LoginPage } from '../support/fixtures';
import { user } from '../support/helper';

const portal = { name: 'Acme Careers', slug: 'acme-careers' };
const recruiter = {
  name: 'Rita',
  email: 'rita.recruiter@example.com',
  password: 'recruiter@123',
};

test.describe.configure({ mode: 'serial' });

// Leave no data behind: other specs in the same run assume the seeded user
// belongs to a single team.
test.afterAll(async () => {
  await prisma.team.deleteMany({ where: { slug: portal.slug } });
  await prisma.user.deleteMany({ where: { email: recruiter.email } });
});

test('Owner creates a branded portal through the onboarding wizard', async ({
  page,
}) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.credentialLogin(user.email, user.password);
  await page.waitForURL(/\/teams\/.+\/settings/);

  await page.goto('/onboarding');
  // 1. Account
  await expect(page.getByText(user.email)).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  // 2. Details
  await page.getByLabel('Company name').fill(portal.name);
  await expect(page.getByLabel('Team Slug')).toHaveValue(portal.slug);
  await page.getByRole('button', { name: 'Next' }).click();
  // 3. Branding
  await page.getByLabel('Hero title').fill('Build the future with us');
  await page.getByRole('button', { name: 'Next' }).click();
  // 4. Done
  await page.getByRole('button', { name: 'Create portal' }).click();

  await page.waitForURL(`/teams/${portal.slug}/settings`);

  // Creator is the Portal Owner (one transaction: team + owner + roles).
  const team = await prisma.team.findUniqueOrThrow({
    where: { slug: portal.slug },
    include: {
      portalProfile: true,
      portalBranding: true,
      members: { include: { portalRole: true, user: true } },
    },
  });
  expect(team.members).toHaveLength(1);
  expect(team.members[0].user.email).toBe(user.email);
  expect(team.members[0].role).toBe('OWNER');
  expect(team.members[0].portalRole?.key).toBe('portal_owner');
  expect(team.portalProfile?.companyName).toBe(portal.name);
  expect(team.portalBranding?.heroTitle).toBe('Build the future with us');

  // Portal + Roles tabs exist for the owner
  await expect(page.getByRole('link', { name: 'Portal' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Roles' })).toBeVisible();
});

test('Owner edits branding and sees the permission matrix', async ({
  page,
}) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.credentialLogin(user.email, user.password);
  await page.waitForURL(/\/teams\/.+\/settings/);

  await page.goto(`/teams/${portal.slug}/portal`);
  await page.getByLabel('Hero subtitle').fill('Open roles in engineering');
  await page.getByRole('button', { name: 'Save Changes' }).nth(1).click();
  await expect(page.getByText('Changes saved successfully.')).toBeVisible();

  await page.goto(`/teams/${portal.slug}/roles`);
  for (const role of [
    'Portal Owner',
    'Admin',
    'HR Manager',
    'Recruiter',
    'Hiring Manager',
    'Interviewer',
    'Viewer / Analyst',
  ]) {
    await expect(page.getByRole('columnheader', { name: role })).toBeVisible();
  }
});

test('Owner invites a recruiter who then has only recruiter permissions', async ({
  page,
}) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.credentialLogin(user.email, user.password);
  await page.waitForURL(/\/teams\/.+\/settings/);

  await page.goto(`/teams/${portal.slug}/members`);
  await expect(page.getByRole('cell', { name: 'Portal Owner' })).toBeVisible();

  await page.getByRole('button', { name: 'Invite Member' }).click();
  await page.getByPlaceholder('jackson@boxyhq.com').fill(recruiter.email);
  await page.locator('select[name="portalRoleId"]').first().selectOption({
    label: 'Recruiter',
  });
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(page.getByText('Invitation sent!')).toBeVisible();

  const invitation = await prisma.invitation.findFirstOrThrow({
    where: { email: recruiter.email },
  });
  expect(invitation.portalRoleId).not.toBeNull();

  // The recruiter signs up through the invitation and accepts it.
  const browser = await chromium.launch();
  const recruiterPage = await browser.newPage();
  const recruiterLogin = new LoginPage(recruiterPage);
  const link = `${process.env.APP_URL}/invitations/${invitation.token}`;

  await recruiterLogin.gotoInviteLink(link, portal.name);
  await recruiterLogin.createNewAccountViaInvite(
    recruiter.name,
    recruiter.password
  );
  await recruiterLogin.credentialLogin(recruiter.email, recruiter.password);
  await recruiterLogin.invitationAcceptPromptVisible(portal.name);
  await recruiterLogin.acceptInvitation();

  const permissions = await recruiterPage.request.get(
    `/api/teams/${portal.slug}/permissions`
  );
  expect(permissions.status()).toBe(200);
  const body = await permissions.json();
  expect(body.portal.role.name).toBe('Recruiter');
  expect(body.portal.keys).toEqual(
    expect.arrayContaining(['jobs.publish', 'applications.manage'])
  );
  for (const key of ['members.invite', 'roles.manage', 'billing.manage']) {
    expect(body.portal.keys).not.toContain(key);
  }

  // UI hides what the recruiter cannot use ...
  await recruiterPage.goto(`/teams/${portal.slug}/settings`);
  await expect(
    recruiterPage.getByRole('link', { name: 'Members' })
  ).toHaveCount(0);
  await expect(recruiterPage.getByRole('link', { name: 'Roles' })).toHaveCount(
    0
  );

  // ... and the server enforces it regardless of the UI.
  for (const path of ['roles', 'members']) {
    const r = await recruiterPage.request.get(
      `/api/teams/${portal.slug}/${path}`
    );
    expect(r.status()).toBe(403);
  }

  // Tenant isolation: the recruiter has no access to the first portal.
  const other = await prisma.team.findFirstOrThrow({
    where: { slug: { not: portal.slug } },
  });
  const cross = await recruiterPage.request.get(
    `/api/teams/${other.slug}/portal`
  );
  expect(cross.status()).toBe(403);

  await browser.close();
});
