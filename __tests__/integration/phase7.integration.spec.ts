/**
 * @jest-environment node
 *
 * Phase 7 integration tests: richer analytics, automation triggers and sweeps,
 * offer band check, talent search scores and selective export.
 * Run with:  DATABASE_URL=postgresql://... npm run test:integration
 */
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const enabled = process.env.INTEGRATION === '1' && !!process.env.DATABASE_URL;
const suite = enabled ? describe : describe.skip;

process.env.APP_URL = 'http://localhost:4002';
process.env.VAPID_PUBLIC_KEY =
  'BF3egsLKXO9bsBBhLOL6JByVZP7ud8ZRJ3cN-TCn3znlFeZpA3qUoEqpM9FbyX1CCeLlkKh5eRpmYR5zcT2bi44';
process.env.VAPID_PRIVATE_KEY = 'Qr8xxXExYLAPMXa5pgSJ5SKco1rzFh8b5esDJj8lBEo';
process.env.VAPID_SUBJECT = 'mailto:ops@example.com';
delete process.env.SMTP_HOST;
process.env.AI_DEFAULT_PROVIDER = 'fake';
process.env.AI_ALLOW_FAKE = 'true';

let currentUser: { id: string; email: string; name: string } | null = null;

jest.mock('@/lib/session', () => ({
  getSession: jest.fn(async () => (currentUser ? { user: currentUser } : null)),
}));
jest.mock('@/lib/svix', () => ({
  sendEvent: jest.fn(async () => undefined),
  findOrCreateApp: jest.fn(async () => undefined),
}));
jest.mock('@/lib/retraced', () => ({ sendAudit: jest.fn() }));
jest.mock('@/lib/metrics', () => ({ recordMetric: jest.fn() }));
jest.mock('@/lib/recaptcha', () => ({ validateRecaptcha: jest.fn() }));
jest.mock('@/lib/email/sendEmail', () => ({
  sendEmail: jest.fn(async () => undefined),
}));
jest.mock('web-push', () => ({
  __esModule: true,
  default: {
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn(async () => ({ statusCode: 201 })),
  },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const load = () => ({
  prisma: require('@/lib/prisma')
    .prisma as typeof import('@/lib/prisma').prisma,
  createPortal: require('models/portal').createPortal,
  automation:
    require('models/automation') as typeof import('models/automation'),
  ticker: require('@/lib/ticker') as typeof import('@/lib/ticker'),
  jobsApi: require('pages/api/teams/[slug]/jobs/index').default,
  actionsApi: require('pages/api/teams/[slug]/jobs/[jobId]/actions').default,
  assignApi: require('pages/api/teams/[slug]/jobs/[jobId]/assignments').default,
  analyticsApi: require('pages/api/teams/[slug]/analytics/index').default,
  automationApi: require('pages/api/teams/[slug]/automation/index').default,
  offersApi: require('pages/api/teams/[slug]/offers/index').default,
  offerApi: require('pages/api/teams/[slug]/offers/[offerId]/index').default,
  searchApi: require('pages/api/teams/[slug]/talent/search').default,
  talentApi: require('pages/api/teams/[slug]/talent/index').default,
  aiSettingsApi: require('pages/api/teams/[slug]/ai/settings').default,
  invoicesApi: require('pages/api/teams/[slug]/payments/invoices').default,
  fromTemplatesApi: require('pages/api/teams/[slug]/jobs/from-templates')
    .default,
  jobApi: require('pages/api/teams/[slug]/jobs/[jobId]/index').default,
  exportApi: require('pages/api/teams/[slug]/talent/export').default,
});

suite('phase 7: analytics, automation, offers, talent (integration)', () => {
  const m = load();
  const { prisma } = m;
  const run = Date.now().toString(36);
  const users: Record<string, { id: string; email: string; name: string }> = {};
  let slug = '';
  let team: { id: string };
  let jobA = '';
  let jobB = '';

  const call = async (
    handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void>,
    as: string | null,
    opts: {
      method?: string;
      query?: Record<string, string>;
      body?: unknown;
    } = {}
  ) => {
    currentUser = as ? users[as] : null;

    const { req, res } = createMocks({
      method: (opts.method ?? 'GET') as never,
      query: opts.query ?? {},
      body: opts.body as never,
      headers: { 'user-agent': 'jest-browser/1.0' },
    });

    await handler(req as never, res as never);

    const text = res._getData();
    let json: any;

    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }

    return {
      status: res._getStatusCode(),
      json,
      text,
      headers: res.getHeaders(),
    };
  };

  const mkUser = async (key: string) => {
    const u = await prisma.user.create({
      data: {
        name: key,
        email: `${key}-${run}@p7-test.com`,
        emailVerified: new Date(),
      },
    });

    users[key] = { id: u.id, email: u.email, name: u.name };
  };

  const newJob = async (title: string) => {
    const r = await call(m.jobsApi, 'owner', {
      method: 'POST',
      query: { slug },
      body: {
        title,
        descriptionHtml:
          '<p>We are hiring an engineer to build and run our platform.</p>',
        workMode: 'REMOTE',
      },
    });

    expect(r.status).toBe(201);
    await call(m.actionsApi, 'owner', {
      method: 'POST',
      query: { slug, jobId: r.json.data.id },
      body: { action: 'publish' },
    });

    return r.json.data.id as string;
  };

  const application = async (key: string, jobId: string) => {
    const u = await prisma.user.create({
      data: {
        name: `Cand ${key}`,
        email: `${key}-${run}@cand7.com`,
        emailVerified: new Date(),
      },
    });

    await prisma.candidateProfile.create({
      data: {
        userId: u.id,
        headline: `${key} headline`,
        location: 'Pune',
        expectedSalary: 3600000,
        skills: { create: [{ skill: 'Node.js' }, { skill: 'SQL' }] },
      },
    });

    const tc = await prisma.tenantCandidate.create({
      data: {
        teamId: team.id,
        userId: u.id,
        name: `Cand ${key}`,
        email: u.email,
        source: 'portal',
      },
    });
    const stage = await prisma.pipelineStage.findFirstOrThrow({
      where: { teamId: team.id, jobId: null, name: 'Applied' },
    });
    const app = await prisma.jobApplication.create({
      data: {
        teamId: team.id,
        jobId,
        tenantCandidateId: tc.id,
        stageId: stage.id,
        answers: [],
      },
    });

    return { candidateId: tc.id, appId: app.id };
  };

  const rule = (body: object) =>
    call(m.automationApi, 'owner', {
      method: 'POST',
      query: { slug },
      body,
    });

  beforeAll(async () => {
    for (const k of ['owner', 'rec']) await mkUser(k);

    slug = `p7-${run}`;
    team = await m.createPortal({
      userId: users.owner.id,
      name: 'Acme P7',
      slug,
    });
    const role = await prisma.portalRole.findFirstOrThrow({
      where: { teamId: team.id, key: 'recruiter' },
    });

    await prisma.teamMember.create({
      data: {
        teamId: team.id,
        userId: users.rec.id,
        role: role.baseRole,
        portalRoleId: role.id,
      },
    });
    jobA = await newJob('Backend Engineer');
    jobB = await newJob('Designer');
    expect(
      (
        await call(m.assignApi, 'owner', {
          method: 'PUT',
          query: { slug, jobId: jobA },
          body: { assignments: [{ userId: users.rec.id, kind: 'RECRUITER' }] },
        })
      ).status
    ).toBe(200);
  });

  describe('analytics', () => {
    it('reports recruiter workload and the new KPIs, filterable by recruiter', async () => {
      await application('an1', jobA);
      await application('an2', jobB);

      const all = await call(m.analyticsApi, 'owner', { query: { slug } });

      expect(all.status).toBe(200);
      expect(all.json.data.kpis).toHaveProperty('avgTimeToFillDays');
      expect(all.json.data.kpis).toHaveProperty('interviewToOfferRate');
      expect(all.json.data.kpis.applications).toBe(2);

      const row = all.json.data.recruiters.find(
        (r: any) => r.id === users.rec.id
      );

      expect(row).toMatchObject({ openJobs: 1, activeCandidates: 1, hires: 0 });

      const mine = await call(m.analyticsApi, 'owner', {
        query: { slug, recruiterId: users.rec.id },
      });

      expect(mine.json.data.kpis.applications).toBe(1);
      expect(mine.json.data.range.recruiterId).toBe(users.rec.id);
    });
  });

  describe('automation triggers', () => {
    it('MATCH_SCORED fires at the threshold, once per application', async () => {
      const a = await application('ms1', jobA);
      const r = await rule({
        name: 'Strong match',
        trigger: { type: 'MATCH_SCORED', minScore: 75 },
        action: { type: 'ADD_TAG', tag: 'AI strong' },
      });

      expect(r.status).toBe(201);

      const fire = (score: number) =>
        m.automation.runAutomations({
          type: 'MATCH_SCORED',
          teamId: team.id,
          applicationId: a.appId,
          score,
        });

      expect(await fire(60)).toHaveLength(0);
      expect(await fire(80)).toHaveLength(1);
      expect(await fire(90)).toHaveLength(0);

      const links = await prisma.candidateTagLink.count({
        where: { teamId: team.id, tenantCandidateId: a.candidateId },
      });

      expect(links).toBe(1);
    });

    it('STAGE_STALE notifies the assigned recruiter once per stay', async () => {
      const a = await application('st1', jobA);
      const r = await rule({
        name: 'Stale in review',
        trigger: { type: 'STAGE_STALE', days: 5 },
        action: { type: 'NOTIFY_ASSIGNED', title: 'Waiting too long' },
      });

      expect(r.status).toBe(201);
      await prisma.$executeRaw`UPDATE "JobApplication" SET "updatedAt" = now() - interval '10 days' WHERE id = ${a.appId}`;

      expect(await m.automation.runAutomationSweeps()).toBeGreaterThanOrEqual(
        1
      );

      const n = await prisma.notification.count({
        where: {
          userId: users.rec.id,
          type: 'automation.alert',
          title: 'Waiting too long',
        },
      });

      expect(n).toBeGreaterThanOrEqual(1);

      // idempotent: the same stay does not fire again
      const before = await prisma.notification.count({
        where: { userId: users.rec.id, type: 'automation.alert' },
      });

      await m.automation.runAutomationSweeps();
      expect(
        await prisma.notification.count({
          where: { userId: users.rec.id, type: 'automation.alert' },
        })
      ).toBe(before);
    });

    it('JOB_LOW_APPLICANTS alerts once and only allows notifications', async () => {
      const bad = await rule({
        name: 'Bad job rule',
        trigger: { type: 'JOB_LOW_APPLICANTS', maxApplicants: 5, afterDays: 7 },
        action: { type: 'ADD_TAG', tag: 'x' },
      });

      expect(bad.status).toBe(422);

      const ok = await rule({
        name: 'Low applicants',
        trigger: { type: 'JOB_LOW_APPLICANTS', maxApplicants: 1, afterDays: 7 },
        action: { type: 'NOTIFY_ASSIGNED', title: 'Few applicants' },
      });

      expect(ok.status).toBe(201);
      // Designer has one application (an2) -> not fewer than 1; use a fresh job
      const quiet = await newJob('Quiet Role');

      await prisma.$executeRaw`UPDATE "Job" SET "publishedAt" = now() - interval '10 days' WHERE id = ${quiet}`;
      await call(m.assignApi, 'owner', {
        method: 'PUT',
        query: { slug, jobId: quiet },
        body: { assignments: [{ userId: users.rec.id, kind: 'RECRUITER' }] },
      });

      await m.automation.runAutomationSweeps();

      const count = () =>
        prisma.notification.count({
          where: { userId: users.rec.id, title: 'Few applicants' },
        });
      const first = await count();

      expect(first).toBeGreaterThanOrEqual(1);
      await m.automation.runAutomationSweeps();
      expect(await count()).toBe(first);
    });

    it('the ticker reports how many automations fired', async () => {
      const r = await m.ticker.runDueTasks();

      expect(typeof r.automationsFired).toBe('number');
    });
  });

  describe('offers: band check', () => {
    it('compares fixed pay with the job band and keeps the template', async () => {
      const a = await application('of1', jobA);

      await prisma.job.updateMany({
        where: { id: jobA, teamId: team.id },
        data: { salaryMin: 2800000, salaryMax: 4000000 },
      });

      const c = await call(m.offersApi, 'owner', {
        method: 'POST',
        query: { slug },
        body: { applicationId: a.appId, fixed: 3200000 },
      });

      expect(c.status).toBe(201);
      expect(c.json.data.band).toMatchObject({
        status: 'WITHIN',
        min: 2800000,
        max: 4000000,
        expected: 3600000,
      });

      const id = c.json.data.id as string;
      const up = await call(m.offerApi, 'owner', {
        method: 'PUT',
        query: { slug, offerId: id },
        body: { fixed: 5000000, templateKey: 'india-contract-v2' },
      });

      expect(up.status).toBe(200);
      expect(up.json.data.band.status).toBe('ABOVE');
      expect(up.json.data.templateKey).toBe('india-contract-v2');

      const bad = await call(m.offerApi, 'owner', {
        method: 'PUT',
        query: { slug, offerId: id },
        body: { templateKey: 'nope' },
      });

      expect(bad.status).toBe(422);
    });
  });

  describe('talent', () => {
    it('search results carry 0-100 scores; the list reports a total', async () => {
      const r = await call(m.searchApi, 'owner', {
        method: 'POST',
        query: { slug },
        body: {
          filters: {
            skills: ['Node.js'],
            keywords: [],
            location: null,
            minYears: null,
            maxYears: null,
            workMode: null,
          },
          limit: 10,
        },
      });

      expect(r.status).toBe(200);
      expect(r.json.data.results.length).toBeGreaterThan(0);

      const s = r.json.data.results[0].scores;

      expect(s.relevance).toBeGreaterThanOrEqual(0);
      expect(s.relevance).toBeLessThanOrEqual(100);

      const list = await call(m.talentApi, 'owner', { query: { slug } });

      expect(list.json.data.total).toBeGreaterThan(0);
    });

    it('exports only the selected candidates', async () => {
      const a = await application('ex1', jobA);
      const b = await application('ex2', jobA);
      const r = await call(m.exportApi, 'owner', {
        query: { slug, ids: a.candidateId },
      });

      expect(r.status).toBe(200);
      expect(r.text).toContain(`ex1-${run}@cand7.com`);
      expect(r.text).not.toContain(`ex2-${run}@cand7.com`);
      expect(b.candidateId).toBeTruthy();
    });
  });

  describe('AI settings: per-feature tiers', () => {
    it('stores a tier per feature and reports prompt version and roles', async () => {
      const put = await call(m.aiSettingsApi, 'owner', {
        method: 'PUT',
        query: { slug },
        body: {
          provider: 'OPENAI',
          tierByFeature: { 'match.assess': 'best', 'jd.generate': 'fast' },
          enabledFeatures: {},
          logRetentionDays: 90,
        },
      });

      expect(put.status).toBe(200);

      const get = await call(m.aiSettingsApi, 'owner', { query: { slug } });
      const f = (k: string) =>
        get.json.data.features.find((x: any) => x.key === k);

      expect(f('match.assess')).toMatchObject({
        tier: 'best',
        defaultTier: 'standard',
        roles: 'Recruiter+',
      });
      expect(f('match.assess').prompt).toMatch(/^match-assess v\d+$/);
      expect(f('resume.parse').tier).toBe('standard');
      expect(get.json.data.logRetentionDays).toBe(90);

      const bad = await call(m.aiSettingsApi, 'owner', {
        method: 'PUT',
        query: { slug },
        body: {
          provider: 'OPENAI',
          tierByFeature: { 'nope.feature': 'fast' },
        },
      });

      expect(bad.status).toBe(422);
    });
  });

  describe('billing history', () => {
    it('is empty without a Stripe customer and needs billing.manage', async () => {
      const ok = await call(m.invoicesApi, 'owner', { query: { slug } });

      expect(ok.status).toBe(200);
      expect(ok.json.data).toEqual([]);
      expect(
        (await call(m.invoicesApi, 'rec', { query: { slug } })).status
      ).toBe(403);
    });
  });

  describe('hospital and medical templates', () => {
    it('a portal created from the hospital template gets its pipeline and wording', async () => {
      const slugH = `p7h-${run}`;
      const t = await m.createPortal({
        userId: users.owner.id,
        name: 'City Hospital',
        slug: slugH,
        template: 'hospital',
      });
      const stages = await prisma.pipelineStage.findMany({
        where: { teamId: t.id, jobId: null },
        orderBy: { order: 'asc' },
      });
      const names = stages.map((x) => x.name);

      expect(names).toContain('Credential Verification');
      expect(names).toContain('Occupational Health Clearance');
      expect(stages.slice(-3).map((x) => x.kind)).toEqual([
        'HIRED',
        'REJECTED',
        'WITHDRAWN',
      ]);

      const branding = await prisma.portalBranding.findUniqueOrThrow({
        where: { teamId: t.id },
      });
      const profile = await prisma.portalProfile.findUniqueOrThrow({
        where: { teamId: t.id },
      });

      expect(branding.primaryColor).toBe('#0E7C86');
      expect(branding.heroTitle).toMatch(/Care for people/);
      expect(profile.industry).toBe('Hospitals & healthcare');
    });

    it('creates draft jobs from templates with licence questions and attributes', async () => {
      const r = await call(m.fromTemplatesApi, 'owner', {
        method: 'POST',
        query: { slug },
        body: { keys: ['icu-nurse', 'lab-technologist'] },
      });

      expect(r.status).toBe(201);
      expect(r.json.data).toHaveLength(2);

      const job = await call(m.jobApi, 'owner', {
        query: { slug, jobId: r.json.data[0].id },
      });

      expect(job.json.data.status).toBe('DRAFT');
      expect(job.json.data.attributes).toMatchObject({
        specialty: 'Critical care',
        shift: 'ROTATING',
        licenseRequired: true,
      });
      expect(job.json.data.questions.map((q: any) => q.prompt)).toEqual(
        expect.arrayContaining([
          'Nursing council registration number',
          'Which shifts can you work?',
        ])
      );
      expect(job.json.data.skills.some((s: any) => s.required)).toBe(true);
    });

    it('rejects unknown templates and invalid attributes', async () => {
      const bad = await call(m.fromTemplatesApi, 'owner', {
        method: 'POST',
        query: { slug },
        body: { keys: ['nope'] },
      });

      expect(bad.status).toBe(422);

      const invalid = await call(m.jobsApi, 'owner', {
        method: 'POST',
        query: { slug },
        body: {
          title: 'Night Nurse',
          descriptionHtml: '<p>x</p>',
          attributes: { shift: 'WEEKENDS' },
        },
      });

      expect(invalid.status).toBe(422);
    });

    it('only members who can create jobs may use templates', async () => {
      const r = await call(m.fromTemplatesApi, 'rec', {
        method: 'POST',
        query: { slug },
        body: { keys: ['icu-nurse'] },
      });

      // recruiters hold jobs.create by default; an outsider does not
      expect(r.status).toBe(201);
      expect(
        (
          await call(m.fromTemplatesApi, null, {
            method: 'POST',
            query: { slug },
            body: { keys: ['icu-nurse'] },
          })
        ).status
      ).toBe(401);
    });
  });
});
