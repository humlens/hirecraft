import { expect, test, type Page } from '@playwright/test';

import { hashPassword } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { LoginPage } from '../support/fixtures';
import { user } from '../support/helper';

const slug = 'hire-co';
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(300, 'x')]);
const people = {
  hm: {
    name: 'Harper Manager',
    email: 'harper.hm@example.com',
    password: 'hm@12345',
    role: 'hiring_manager',
  },
  iv: {
    name: 'Ira Interviewer',
    email: 'ira.iv@example.com',
    password: 'iv@12345',
    role: 'interviewer',
  },
};
const cand = {
  name: 'Dana Hire',
  email: 'dana.hire@gmail.com',
  password: 'candidate@123',
};

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await prisma.team.deleteMany({ where: { slug } });
  await prisma.user.deleteMany({
    where: { email: { in: [people.hm.email, people.iv.email, cand.email] } },
  });
});

const login = async (page: Page, email: string, password: string) => {
  const l = new LoginPage(page);
  await l.goto();
  await l.credentialLogin(email, password);
  await page.waitForURL(/\/(teams\/.+|me|onboarding)/);
};

let jobId = '';
let applicationId = '';

test('set up a portal, a published job, an application and a hiring team', async ({
  page,
  browser,
}) => {
  await login(page, user.email, user.password);

  // portal through the wizard
  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Company name').fill('Hire Co');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create portal' }).click();
  await page.waitForURL(`/teams/${slug}/dashboard`);

  const team = await prisma.team.findUniqueOrThrow({ where: { slug } });
  for (const p of Object.values(people)) {
    const u = await prisma.user.create({
      data: {
        name: p.name,
        email: p.email,
        password: await hashPassword(p.password),
        emailVerified: new Date(),
      },
    });
    const role = await prisma.portalRole.findFirstOrThrow({
      where: { teamId: team.id, key: p.role },
    });
    await prisma.teamMember.create({
      data: {
        teamId: team.id,
        userId: u.id,
        role: role.baseRole,
        portalRoleId: role.id,
      },
    });
  }

  // job (API with the owner's session), then publish
  const created = await page.request.post(`/api/teams/${slug}/jobs`, {
    data: {
      title: 'Staff Engineer',
      descriptionHtml:
        '<p>Build and operate the services that run our whole product.</p>',
      workMode: 'REMOTE',
    },
  });
  expect(created.status()).toBe(201);
  jobId = (await created.json()).data.id;
  const pub = await page.request.post(
    `/api/teams/${slug}/jobs/${jobId}/actions`,
    { data: { action: 'publish' } }
  );
  expect(pub.status()).toBe(200);

  // candidate registers, uploads a resume and applies (own browser session)
  const ctx = await browser.newContext();
  const cp = await ctx.newPage();
  const reg = await cp.request.post('/api/candidate/register', { data: cand });
  expect(reg.status()).toBe(201);
  await login(cp, cand.email, cand.password);
  const up = await cp.request.post('/api/candidate/resumes', {
    data: PDF,
    headers: { 'Content-Type': 'application/pdf', 'X-File-Name': 'dana.pdf' },
  });
  expect(up.status()).toBe(201);
  const apply = await cp.request.post(
    `/api/public/portals/${slug}/jobs/staff-engineer/apply`,
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

test('recruiter schedules an interview; the invitation is only a draft', async ({
  page,
}) => {
  await login(page, user.email, user.password);
  await page.goto(`/teams/${slug}/applications/${applicationId}`);
  await page.getByRole('button', { name: 'Schedule interview' }).click();

  const start = new Date(Date.now() + 3 * 86400_000);
  const local = new Date(start.getTime() - start.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  await page.getByLabel('Starts at').fill(local);
  await page.getByText(people.iv.name, { exact: true }).click();
  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(page.getByText('Interview scheduled')).toBeVisible();

  await page.goto(`/teams/${slug}/interviews`);
  await expect(page.getByRole('link', { name: cand.name })).toBeVisible();

  // the invitation to the candidate waits for a human
  await page.goto(`/teams/${slug}/messages`);
  await expect(page.getByLabel('Subject').first()).toHaveValue(
    'Interview invitation: Staff Engineer'
  );
  await expect(
    page.locator('.badge', { hasText: /^DRAFT$/ }).first()
  ).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).first().click();
  await expect(
    page.locator('.badge', { hasText: /^APPROVED$/ }).first()
  ).toBeVisible();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  // no SMTP server in the test environment: sending is refused and the message stays approved
  await expect(
    page.getByRole('alert').filter({ hasText: 'Email is not configured' })
  ).toBeVisible();
  expect(
    await prisma.messageDraft.count({
      where: {
        teamId: (await prisma.team.findUniqueOrThrow({ where: { slug } })).id,
        status: 'SENT',
      },
    })
  ).toBe(0);
});

test('the interviewer submits a scorecard after the interview', async ({
  page,
}) => {
  const team = await prisma.team.findUniqueOrThrow({ where: { slug } });
  await prisma.interview.updateMany({
    where: { teamId: team.id },
    data: { startsAt: new Date(Date.now() - 3600_000) },
  });

  await login(page, people.iv.email, people.iv.password);
  await page.goto(`/teams/${slug}/interviews`);
  await page.getByRole('link', { name: cand.name }).click();
  await page
    .getByRole('radiogroup', { name: 'Technical skills' })
    .getByRole('radio', { name: '4' })
    .click();
  await page
    .getByRole('radiogroup', { name: 'Communication' })
    .getByRole('radio', { name: '3' })
    .click();
  await page.getByRole('button', { name: 'Submit feedback' }).click();
  await expect(page.getByText('Feedback saved')).toBeVisible();
  await expect(
    page.locator('.badge', { hasText: /^HIRE$/ }).first()
  ).toBeVisible();
});

test('offer: created, approved by the hiring manager, sent, accepted by the candidate', async ({
  page,
  browser,
}) => {
  await login(page, user.email, user.password);
  await page.goto(`/teams/${slug}/applications/${applicationId}`);
  await page.getByRole('button', { name: 'Create offer' }).first().click();
  await page.getByLabel('Fixed', { exact: true }).fill('2400000');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForURL(new RegExp(`/teams/${slug}/offers/[0-9a-f-]{36}$`));
  const offerUrl = page.url();
  await expect(page.locator('.badge', { hasText: /^DRAFT$/ })).toBeVisible();

  // the approval chain is pre-filled: keep only the hiring manager
  const others = page.getByRole('button', {
    name: new RegExp(`^Remove (?!${people.hm.name})`),
  });

  while (await others.count()) {
    await others.first().click();
  }

  if (
    !(await page
      .getByRole('button', { name: `Remove ${people.hm.name}` })
      .count())
  ) {
    await page
      .getByLabel('Add approver')
      .selectOption({ label: people.hm.name });
  }

  await page.getByRole('button', { name: 'Request approval' }).click();
  await expect(page.getByText('PENDING_APPROVAL')).toBeVisible();

  // the hiring manager approves
  const hmCtx = await browser.newContext();
  const hm = await hmCtx.newPage();
  await login(hm, people.hm.email, people.hm.password);
  await hm.goto(offerUrl);
  await hm.getByRole('button', { name: 'Approve' }).click();
  await expect(
    hm.locator('.badge', { hasText: /^APPROVED$/ }).first()
  ).toBeVisible();
  await hmCtx.close();

  await page.reload();
  await page.getByRole('button', { name: 'Send offer to candidate' }).click();
  await expect(page.getByText('SENT', { exact: true }).first()).toBeVisible();

  // the candidate accepts
  const cCtx = await browser.newContext();
  const c = await cCtx.newPage();
  await login(c, cand.email, cand.password);
  await c.goto('/me/offers');
  await expect(c.getByText('Staff Engineer')).toBeVisible();
  c.once('dialog', (d) => d.accept());
  await c.getByRole('button', { name: 'Accept' }).click();
  await expect(c.getByText('ACCEPTED', { exact: true })).toBeVisible();
  await c.goto('/me/applications');
  await expect(c.locator('[aria-current="step"]')).toHaveText('Hired');
  await c.goto('/me/notifications');
  await expect(c.getByText(/moved to Hired/)).toBeVisible();
  await cCtx.close();
});

test('analytics, talent import/export and pipeline settings', async ({
  page,
}) => {
  await login(page, user.email, user.password);

  await page.goto(`/teams/${slug}/analytics`);
  await expect(page.getByText('Hires')).toBeVisible();
  const hires = page.locator('div', { hasText: /^Hires\s*1$/ });
  await expect(hires.first()).toBeVisible();
  await expect(page.getByText('Recruiter workload')).toBeVisible();
  await expect(page.getByText('Stage conversion')).toBeVisible();
  await page.getByLabel('Period').selectOption('30');
  await expect(page.getByText('Source of applications')).toBeVisible();

  await page.goto(`/teams/${slug}/talent`);
  await expect(page.getByRole('link', { name: cand.name })).toBeVisible();
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await page
    .getByLabel('CSV content')
    .fill('name,email,tags\nIvy Import,ivy@import.test,golang;remote');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Ivy Import' })).toBeVisible();
  const exp = await page.request.get(`/api/teams/${slug}/talent/export`);
  expect(exp.status()).toBe(200);
  expect(await exp.text()).toContain('ivy@import.test');

  await page.getByRole('link', { name: cand.name }).click();
  await page.getByLabel('New note').fill('Great system design interview');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('Great system design interview')).toBeVisible();

  await page.goto(`/teams/${slug}/settings/pipeline`);
  await page.getByLabel('New stage').fill('Case study');
  await page.getByRole('button', { name: 'Add stage' }).click();
  await expect(page.getByLabel('Stage name 11')).toHaveValue('Case study');

  // automation rules: build one with the new score trigger, then switch it off
  await page.getByRole('button', { name: 'New rule' }).click();
  await page.getByLabel('Rule name').fill('Strong match tag');
  await page.getByLabel('When', { exact: true }).selectOption('MATCH_SCORED');
  await page.getByLabel('Then', { exact: true }).selectOption('ADD_TAG');
  await page.getByLabel('Tag', { exact: true }).fill('ai-strong');
  await page.getByRole('button', { name: 'Add rule' }).click();
  await expect(page.getByText('scores ≥ 75% match')).toBeVisible();
  await page.getByRole('switch', { name: /Disable Strong match tag/ }).click();
  await expect(
    page.getByRole('switch', { name: /Enable Strong match tag/ })
  ).toBeVisible();

  // notifications reach the bell
  await page.goto(`/teams/${slug}/settings`);
  await expect(page.getByRole('link', { name: 'Notifications' })).toBeVisible();
});
