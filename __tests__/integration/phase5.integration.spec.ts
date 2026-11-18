/**
 * @jest-environment node
 *
 * Phase 5 integration tests: Web Push (subscription consent, delivery rules,
 * cleanup), the recruiter review queue and the per-portal manifest.
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
  webpush: require('web-push').default as {
    sendNotification: jest.Mock;
    setVapidDetails: jest.Mock;
  },
  createPortal: require('models/portal').createPortal,
  notifications:
    require('@/lib/notifications') as typeof import('@/lib/notifications'),
  push: require('@/lib/push') as typeof import('@/lib/push'),
  jobsApi: require('pages/api/teams/[slug]/jobs/index').default,
  actionsApi: require('pages/api/teams/[slug]/jobs/[jobId]/actions').default,
  assignApi: require('pages/api/teams/[slug]/jobs/[jobId]/assignments').default,
  stageApi: require('pages/api/teams/[slug]/applications/stage').default,
  queueApi: require('pages/api/teams/[slug]/review-queue').default,
  configApi: require('pages/api/push/config').default,
  subscribeApi: require('pages/api/push/subscribe').default,
  prefsApi: require('pages/api/notifications/preferences').default,
  dashboardApi: require('pages/api/teams/[slug]/dashboard').default,
  slugCheckApi: require('pages/api/teams/slug-check').default,
  manifestApi: require('pages/api/public/portals/[portal]/manifest').default,
});

const keys = {
  p256dh:
    'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
  auth: 'tBHItJI5svbpez7KI4CCXg',
};
const ep = (n: string) =>
  `https://push.example.com/send/${n}-${Date.now().toString(36)}`;

suite('phase 5: push, review queue, manifest (integration)', () => {
  const m = load();
  const { prisma } = m;
  const run = Date.now().toString(36);
  const users: Record<string, { id: string; email: string; name: string }> = {};
  let slugA = '';
  let slugB = '';
  let teamA: { id: string };
  let teamB: { id: string };
  let jobA = '';
  let jobA2 = '';

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

    return { status: res._getStatusCode(), json, headers: res.getHeaders() };
  };

  const mkUser = async (key: string) => {
    const u = await prisma.user.create({
      data: {
        name: key,
        email: `${key}-${run}@p5-test.com`,
        emailVerified: new Date(),
      },
    });

    users[key] = { id: u.id, email: u.email, name: u.name };
  };

  const addMember = async (slug: string, user: string, roleKey: string) => {
    const team = await prisma.team.findUniqueOrThrow({ where: { slug } });
    const r = await prisma.portalRole.findFirstOrThrow({
      where: { teamId: team.id, key: roleKey },
    });

    await prisma.teamMember.create({
      data: {
        teamId: team.id,
        userId: users[user].id,
        role: r.baseRole,
        portalRoleId: r.id,
      },
    });
  };

  const subscribe = (as: string, endpoint: string) =>
    call(m.subscribeApi, as, { method: 'POST', body: { endpoint, keys } });

  const newJob = async (as: string, slug: string, title: string) => {
    const r = await call(m.jobsApi, as, {
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
    await call(m.actionsApi, as, {
      method: 'POST',
      query: { slug, jobId: r.json.data.id },
      body: { action: 'publish' },
    });

    return r.json.data.id as string;
  };

  const application = async (
    key: string,
    jobId: string,
    team = teamA,
    when = new Date()
  ) => {
    const u = await prisma.user.create({
      data: {
        name: `Cand ${key}`,
        email: `${key}-${run}@cand5.com`,
        emailVerified: new Date(),
      },
    });

    await prisma.candidateProfile.create({
      data: {
        userId: u.id,
        headline: `${key} headline`,
        location: 'Pune',
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
        createdAt: when,
      },
    });

    return { userId: u.id, appId: app.id };
  };

  beforeAll(async () => {
    for (const k of ['ownerA', 'ownerB', 'recA', 'rec2A', 'viewerA', 'hmA'])
      await mkUser(k);

    slugA = `p5a-${run}`;
    slugB = `p5b-${run}`;
    teamA = await m.createPortal({
      userId: users.ownerA.id,
      name: 'Acme P5',
      slug: slugA,
    });
    teamB = await m.createPortal({
      userId: users.ownerB.id,
      name: 'Beta P5',
      slug: slugB,
    });
    await addMember(slugA, 'recA', 'recruiter');
    await addMember(slugA, 'rec2A', 'recruiter');
    await addMember(slugA, 'viewerA', 'viewer');
    await addMember(slugA, 'hmA', 'hiring_manager');
    jobA = await newJob('ownerA', slugA, 'Backend Engineer');
    jobA2 = await newJob('ownerA', slugA, 'Designer');
    expect(
      (
        await call(m.assignApi, 'ownerA', {
          method: 'PUT',
          query: { slug: slugA, jobId: jobA },
          body: { assignments: [{ userId: users.recA.id, kind: 'RECRUITER' }] },
        })
      ).status
    ).toBe(200);
  });

  beforeEach(() => {
    m.webpush.sendNotification.mockClear();
    m.webpush.sendNotification.mockImplementation(async () => ({
      statusCode: 201,
    }));
  });

  afterAll(async () => {
    await prisma.team.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await prisma.user.deleteMany({
      where: { email: { contains: `-${run}@` } },
    });
    await prisma.$disconnect();
  });

  // =========================================================================
  describe('push subscriptions: the user opts in per device', () => {
    it('exposes the public key only to signed-in users, never the private key', async () => {
      expect((await call(m.configApi, null)).status).toBe(401);

      const r = await call(m.configApi, 'recA');

      expect(r.status).toBe(200);
      expect(r.json.data).toMatchObject({
        enabled: true,
        publicKey: process.env.VAPID_PUBLIC_KEY,
        devices: 0,
      });
      expect(JSON.stringify(r.json)).not.toContain(
        process.env.VAPID_PRIVATE_KEY as string
      );
    });

    it('validates the subscription (https endpoint, key shapes) and needs a session', async () => {
      const bad = [
        { endpoint: 'http://push.example.com/x', keys },
        { endpoint: 'not a url', keys },
        { endpoint: ep('v'), keys: { p256dh: 'short', auth: keys.auth } },
        { endpoint: ep('v'), keys: { p256dh: keys.p256dh, auth: '<script>' } },
        { endpoint: ep('v') },
        {},
      ];

      for (const body of bad) {
        expect(
          (await call(m.subscribeApi, 'recA', { method: 'POST', body })).status
        ).toBe(422);
      }

      expect(
        (
          await call(m.subscribeApi, null, {
            method: 'POST',
            body: { endpoint: ep('x'), keys },
          })
        ).status
      ).toBe(401);
      expect(
        await prisma.pushSubscription.count({
          where: { userId: users.recA.id },
        })
      ).toBe(0);
    });

    it('subscribes, is idempotent per endpoint, and reflects the device count', async () => {
      const e = ep('rec');

      expect((await subscribe('recA', e)).status).toBe(201);
      expect((await subscribe('recA', e)).status).toBe(201);
      expect(
        await prisma.pushSubscription.count({
          where: { userId: users.recA.id },
        })
      ).toBe(1);
      expect((await call(m.configApi, 'recA')).json.data.devices).toBe(1);

      const row = await prisma.pushSubscription.findUniqueOrThrow({
        where: { endpoint: e },
      });

      expect(row.userAgent).toBe('jest-browser/1.0');
    });

    it('limits devices per user', async () => {
      for (let i = 0; i < 10; i++)
        expect((await subscribe('rec2A', ep(`lim${i}`))).status).toBe(201);

      expect((await subscribe('rec2A', ep('lim-over'))).status).toBe(409);
    });

    it('a device that switches accounts follows the signed-in user; only the owner can unsubscribe', async () => {
      const e = ep('shared');

      await subscribe('viewerA', e);
      await subscribe('hmA', e);
      expect(
        (
          await prisma.pushSubscription.findUniqueOrThrow({
            where: { endpoint: e },
          })
        ).userId
      ).toBe(users.hmA.id);

      // another user cannot remove it
      await call(m.subscribeApi, 'viewerA', {
        method: 'DELETE',
        body: { endpoint: e },
      });
      expect(
        await prisma.pushSubscription.count({ where: { endpoint: e } })
      ).toBe(1);

      expect(
        (
          await call(m.subscribeApi, 'hmA', {
            method: 'DELETE',
            body: { endpoint: e },
          })
        ).status
      ).toBe(200);
      expect(
        await prisma.pushSubscription.count({ where: { endpoint: e } })
      ).toBe(0);
    });
  });

  // =========================================================================
  describe('push delivery follows consent and preferences', () => {
    const notify = (userIds: string[], over: Record<string, unknown> = {}) =>
      m.notifications.notify({
        userIds,
        type: 'interview.scheduled',
        title: 'Interview scheduled',
        body: 'Tuesday 15:30',
        link: '/teams/x/interviews/1',
        teamId: teamA.id,
        ...over,
      } as never);

    it('pushes only to users who subscribed a device', async () => {
      const r = await notify([users.recA.id, users.ownerA.id]); // ownerA has no device

      expect(r.inApp).toBe(2);
      expect(r.push).toBe(1);
      expect(m.webpush.sendNotification).toHaveBeenCalledTimes(1);

      const [sub, body] = m.webpush.sendNotification.mock.calls[0];

      expect(sub.endpoint).toContain('push.example.com/send/rec-');
      expect(sub.keys).toEqual(keys);
      expect(JSON.parse(body)).toEqual({
        title: 'Interview scheduled',
        body: 'Tuesday 15:30',
        url: '/teams/x/interviews/1',
        tag: 'interview.scheduled',
      });
    });

    it('respects the per-type preference and the type default', async () => {
      // type whose default is off
      await notify([users.recA.id], {
        type: 'job.published',
        title: 'Job published',
      });
      expect(m.webpush.sendNotification).not.toHaveBeenCalled();

      // user turns it on
      await call(m.prefsApi, 'recA', {
        method: 'PUT',
        body: {
          preferences: [
            { type: 'job.published', inApp: true, email: false, push: true },
          ],
        },
      });
      await notify([users.recA.id], {
        type: 'job.published',
        title: 'Job published',
      });
      expect(m.webpush.sendNotification).toHaveBeenCalledTimes(1);

      // and switches an on-by-default type off
      m.webpush.sendNotification.mockClear();
      await call(m.prefsApi, 'recA', {
        method: 'PUT',
        body: {
          preferences: [
            {
              type: 'interview.scheduled',
              inApp: true,
              email: true,
              push: false,
            },
          ],
        },
      });
      await notify([users.recA.id]);
      expect(m.webpush.sendNotification).not.toHaveBeenCalled();

      const prefs = (await call(m.prefsApi, 'recA')).json.data as {
        type: string;
        push: boolean;
      }[];

      expect(prefs.find((p) => p.type === 'interview.scheduled')!.push).toBe(
        false
      );
      expect(prefs.find((p) => p.type === 'job.published')!.push).toBe(true);
      expect(prefs.find((p) => p.type === 'offer.sent')!.push).toBe(true); // default
    });

    it('saving other channels does not change the push choice', async () => {
      await call(m.prefsApi, 'recA', {
        method: 'PUT',
        body: {
          preferences: [{ type: 'job.published', inApp: false, email: false }],
        },
      });
      expect(
        (await call(m.prefsApi, 'recA')).json.data.find(
          (p: { type: string }) => p.type === 'job.published'
        ).push
      ).toBe(true);
    });

    it('candidates get push for in-app-only notifications (never email)', async () => {
      await subscribe('viewerA', ep('cand'));

      const r = await notify([users.viewerA.id], {
        inAppOnly: true,
        type: 'interview.reminder',
        title: 'Interview in an hour',
      });

      expect(r.push).toBe(1);
      expect(r.email).toBe(0);
    });

    it('never links outside the site and shortens long text', async () => {
      await notify([users.rec2A.id], {
        link: 'https://evil.example/phish',
        title: 'T'.repeat(300),
        body: 'B'.repeat(500),
      });

      const body = JSON.parse(m.webpush.sendNotification.mock.calls[0][1]);

      expect(body.url).toBe('/');
      expect(body.title.length).toBeLessThanOrEqual(80);
      expect(body.body.length).toBeLessThanOrEqual(140);
      expect(m.push.safeRelativeUrl('//evil.example')).toBe('/');
      expect(m.push.safeRelativeUrl('/teams/a/b?x=1')).toBe('/teams/a/b?x=1');
      expect(m.push.safeRelativeUrl('javascript:alert(1)')).toBe('/');
    });

    it('removes subscriptions the push service reports gone (404/410) and keeps others on errors', async () => {
      const gone = ep('gone');
      const flaky = ep('flaky');

      await subscribe('hmA', gone);
      await subscribe('hmA', flaky);
      m.webpush.sendNotification.mockImplementation(
        async (sub: { endpoint: string }) => {
          if (sub.endpoint === gone)
            throw Object.assign(new Error('gone'), { statusCode: 410 });
          if (sub.endpoint === flaky)
            throw Object.assign(new Error('boom'), { statusCode: 500 });

          return { statusCode: 201 };
        }
      );

      const r = await m.push.sendPushToUsers([users.hmA.id], { title: 'x' });

      expect(r.removed).toBe(1);
      expect(r.failed).toBe(1);
      expect(
        await prisma.pushSubscription.count({ where: { endpoint: gone } })
      ).toBe(0);
      expect(
        await prisma.pushSubscription.count({ where: { endpoint: flaky } })
      ).toBe(1);
    });

    it('a push failure never breaks the notification or the in-app record', async () => {
      m.webpush.sendNotification.mockRejectedValue(new Error('network down'));

      const before = await prisma.notification.count({
        where: { userId: users.recA.id },
      });
      const r = await notify([users.recA.id]);

      expect(r.inApp).toBe(1);
      expect(
        await prisma.notification.count({ where: { userId: users.recA.id } })
      ).toBe(before + 1);
    });

    it('deleting a user removes their devices', async () => {
      await mkUser('gone');
      await subscribe('gone', ep('del'));
      await prisma.user.delete({ where: { id: users.gone.id } });
      expect(
        await prisma.pushSubscription.count({
          where: { userId: users.gone.id },
        })
      ).toBe(0);
    });
  });

  // =========================================================================
  describe('recruiter review queue', () => {
    const q = (as: string, slug = slugA, query: Record<string, string> = {}) =>
      call(m.queueApi, as, { query: { slug, ...query } });
    let first: Awaited<ReturnType<typeof application>>;
    let second: Awaited<ReturnType<typeof application>>;
    let otherJobApp: Awaited<ReturnType<typeof application>>;

    beforeAll(async () => {
      first = await application(
        'q1',
        jobA,
        teamA,
        new Date(Date.now() - 3 * 3600_000)
      );
      second = await application(
        'q2',
        jobA,
        teamA,
        new Date(Date.now() - 1 * 3600_000)
      );
      otherJobApp = await application(
        'q3',
        jobA2,
        teamA,
        new Date(Date.now() - 2 * 3600_000)
      );
      await prisma.matchAssessment.create({
        data: {
          teamId: teamA.id,
          applicationId: first.appId,
          score: 87,
          breakdown: {},
          matchedSkills: ['Node.js'],
          missingSkills: ['AWS'],
          explanation: 'Strong backend match.',
          evidence: [],
          suggestedQuestions: [],
          promptVersion: 1,
          model: 'fake',
        },
      });
    });

    it('lists waiting applications oldest first with the AI hint and the next stage', async () => {
      const r = await q('ownerA');

      expect(r.status).toBe(200);
      expect(
        r.json.data.items.map((i: { applicationId: string }) => i.applicationId)
      ).toEqual([first.appId, otherJobApp.appId, second.appId]);
      expect(r.json.data.counts).toEqual({ toReview: 3, shortlistedToday: 0 });

      const top = r.json.data.items[0];

      expect(top.candidate).toMatchObject({
        name: 'Cand q1',
        headline: 'q1 headline',
        location: 'Pune',
      });
      expect(top.candidate.skills.sort()).toEqual(['Node.js', 'SQL']);
      expect(top.match).toMatchObject({
        score: 87,
        explanation: 'Strong backend match.',
        missingSkills: ['AWS'],
      });
      expect(top.nextStage.name).toBe('AI Shortlisted');
      expect(r.json.data.items[2].match).toBeNull();
    });

    it('respects job assignment, portal boundaries and permissions', async () => {
      const rec = await q('recA');

      expect(
        rec.json.data.items
          .map((i: { applicationId: string }) => i.applicationId)
          .sort()
      ).toEqual([first.appId, second.appId].sort());
      expect(rec.json.data.counts.toReview).toBe(2);
      expect((await q('rec2A')).json.data.items).toHaveLength(0); // assigned to nothing
      expect((await q('ownerB', slugA)).status).toBe(403);
      expect((await q('ownerB', slugB)).json.data.items).toHaveLength(0);
      expect(
        (await q('recA', slugA, { jobId: jobA2 })).json.data.items
      ).toHaveLength(0); // not their job
      expect(
        (await call(m.queueApi, null, { query: { slug: slugA } })).status
      ).toBe(401);
    });

    it('filters by job and validates input', async () => {
      expect(
        (await q('ownerA', slugA, { jobId: jobA2 })).json.data.items.map(
          (i: { applicationId: string }) => i.applicationId
        )
      ).toEqual([otherJobApp.appId]);
      expect(
        (await q('ownerA', slugA, { jobId: 'nope' })).json.data.items
      ).toHaveLength(0);
      expect(
        (await q('ownerA', slugA, { limit: '1' })).json.data.items
      ).toHaveLength(1);
      expect((await q('ownerA', slugA, { limit: '500' })).status).toBe(422);
    });

    it('shortlisting moves the application through the audited stage change and drops it from the queue', async () => {
      const item = (await q('recA')).json.data.items[0];

      const r = await call(m.stageApi, 'recA', {
        method: 'POST',
        query: { slug: slugA },
        body: { applicationId: item.applicationId, stageId: item.nextStage.id },
      });

      expect(r.status).toBe(200);

      const after = await q('recA');

      expect(
        after.json.data.items.map(
          (i: { applicationId: string }) => i.applicationId
        )
      ).not.toContain(item.applicationId);
      expect(after.json.data.counts).toEqual({
        toReview: 1,
        shortlistedToday: 1,
      });
      expect(
        await prisma.applicationActivity.count({
          where: {
            teamId: teamA.id,
            applicationId: item.applicationId,
            type: 'STAGE_CHANGED',
            actorUserId: users.recA.id,
          },
        })
      ).toBe(1);
    });

    it('people without applications.manage cannot shortlist', async () => {
      const item = (await q('ownerA')).json.data.items[0];
      const r = await call(m.stageApi, 'viewerA', {
        method: 'POST',
        query: { slug: slugA },
        body: { applicationId: item.applicationId, stageId: item.nextStage.id },
      });

      expect(r.status).toBe(403);
    });

    it('excludes withdrawn applications and those past the first stage', async () => {
      const w = await application('q4', jobA);

      await prisma.jobApplication.update({
        where: { id: w.appId, teamId: teamA.id },
        data: { withdrawnAt: new Date() },
      });

      const ids = (await q('ownerA')).json.data.items.map(
        (i: { applicationId: string }) => i.applicationId
      );

      expect(ids).not.toContain(w.appId);
    });

    it("uses a job's own pipeline when it has one", async () => {
      const job = await newJob('ownerA', slugA, 'Custom Pipeline Role');
      const s1 = await prisma.pipelineStage.create({
        data: {
          teamId: teamA.id,
          jobId: job,
          name: 'Triage',
          order: 0,
          kind: 'ACTIVE',
        },
      });
      const s2 = await prisma.pipelineStage.create({
        data: {
          teamId: teamA.id,
          jobId: job,
          name: 'Phone screen',
          order: 1,
          kind: 'ACTIVE',
        },
      });
      const a = await application('q5', job);

      await prisma.jobApplication.update({
        where: { id: a.appId, teamId: teamA.id },
        data: { stageId: s1.id },
      });

      const r = await q('ownerA', slugA, { jobId: job });

      expect(r.json.data.items).toHaveLength(1);
      expect(r.json.data.items[0].nextStage).toEqual({
        id: s2.id,
        name: 'Phone screen',
      });
    });
  });

  // =========================================================================
  describe('per-portal web app manifest', () => {
    it('is public, branded and scoped to the portal', async () => {
      await prisma.portalBranding.update({
        where: { teamId: teamA.id },
        data: { primaryColor: '#0F766E' },
      });

      const r = await call(m.manifestApi, null, { query: { portal: slugA } });

      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toBe('application/manifest+json');
      expect(r.json).toMatchObject({
        display: 'standalone',
        start_url: `/p/${slugA}`,
        scope: `/p/${slugA}/`,
        theme_color: '#0F766E',
      });
      expect(r.json.name).toContain('Careers');
      expect(r.json.icons.map((i: { sizes: string }) => i.sizes)).toEqual([
        '192x192',
        '512x512',
        '512x512',
      ]);
    });

    it('is a 404 for unknown or suspended portals', async () => {
      expect(
        (await call(m.manifestApi, null, { query: { portal: 'nope-nope' } }))
          .status
      ).toBe(404);
      await prisma.team.update({
        where: { id: teamB.id },
        data: { status: 'SUSPENDED' },
      });
      expect(
        (await call(m.manifestApi, null, { query: { portal: slugB } })).status
      ).toBe(404);
    });
  });

  // =========================================================================
  describe('portal dashboard and address check', () => {
    const dash = (as: string, slug = slugA, days = '30') =>
      call(m.dashboardApi, as, { query: { slug, days } });

    it('shows the numbers the member is allowed to see', async () => {
      const owner = await dash('ownerA');

      expect(owner.status).toBe(200);
      expect(owner.json.data.kpis.activeJobs).toBe(3);
      expect(owner.json.data.kpis.applications).toBeGreaterThanOrEqual(3);
      expect(owner.json.data.funnel.map((f: { key: string }) => f.key)).toEqual(
        ['applied', 'screened', 'interviewed', 'offer', 'hired']
      );
      expect(owner.json.data.funnel[0].value).toBe(
        owner.json.data.kpis.applications
      );

      // a recruiter assigned to one job sees only that job's applications
      const rec = await dash('recA');

      expect(rec.json.data.kpis.activeJobs).toBe(1);
      expect(rec.json.data.kpis.applications).toBeLessThan(
        owner.json.data.kpis.applications
      );
      expect((await dash('rec2A')).json.data.kpis).toMatchObject({
        activeJobs: 0,
        applications: 0,
      });
    });

    it('lists jobs that need attention and recent notifications', async () => {
      const r = await dash('ownerA');

      expect(Array.isArray(r.json.data.attention)).toBe(true);
      expect(Array.isArray(r.json.data.notifications)).toBe(true);
    });

    it('validates the range and keeps portals apart', async () => {
      expect((await dash('ownerA', slugA, '45')).status).toBe(422);
      expect((await dash('ownerB', slugA)).status).toBe(403);
      expect(
        (await call(m.dashboardApi, null, { query: { slug: slugA } })).status
      ).toBe(401);
    });

    it('tells a signed-in user whether a portal address is free', async () => {
      const check = (slug: string, as: string | null = 'recA') =>
        call(m.slugCheckApi, as, { query: { slug } });

      expect((await check(slugA)).json.data).toEqual({
        slug: slugA,
        available: false,
      });
      expect((await check(`free-${run}-name`)).json.data.available).toBe(true);
      expect((await check('ab')).json.data.available).toBe(false); // too short
      expect((await check('Some Name!!')).json.data.slug).toBe('some-name');
      expect((await check(slugA, null)).status).toBe(401);
    });
  });
});
