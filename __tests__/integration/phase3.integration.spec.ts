/**
 * @jest-environment node
 *
 * Phase 3 integration tests: talent database, interviews, offers, messages,
 * notifications, analytics, pipeline stages, automation and the ticker.
 * Run with:  DATABASE_URL=postgresql://... npm run test:integration
 */
import os from 'os';
import path from 'path';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const enabled = process.env.INTEGRATION === '1' && !!process.env.DATABASE_URL;
const suite = enabled ? describe : describe.skip;

process.env.STORAGE_LOCAL_DIR = path.join(
  os.tmpdir(),
  `hirecraft-p3-${Date.now()}`
);
process.env.APP_URL = 'http://localhost:4002';
process.env.SMTP_HOST = 'smtp.test.local';
process.env.CRON_SECRET = 'test-cron-secret';

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

/* eslint-disable @typescript-eslint/no-require-imports */
const load = () => ({
  prisma: require('@/lib/prisma')
    .prisma as typeof import('@/lib/prisma').prisma,
  unguarded: require('@/lib/prisma')
    .unguardedPrisma as typeof import('@/lib/prisma').unguardedPrisma,
  createPortal: require('models/portal').createPortal,
  // phase 2 endpoints used to build data
  jobsApi: require('pages/api/teams/[slug]/jobs/index').default,
  actionsApi: require('pages/api/teams/[slug]/jobs/[jobId]/actions').default,
  assignApi: require('pages/api/teams/[slug]/jobs/[jobId]/assignments').default,
  stageApi: require('pages/api/teams/[slug]/applications/stage').default,
  pipelineApi: require('pages/api/teams/[slug]/jobs/[jobId]/pipeline').default,
  registerApi: require('pages/api/candidate/register').default,
  applyApi: require('pages/api/public/portals/[portal]/jobs/[jobSlug]/apply')
    .default,
  resumesApi: require('pages/api/candidate/resumes/index').default,
  // phase 3
  talentApi: require('pages/api/teams/[slug]/talent/index').default,
  talentOneApi: require('pages/api/teams/[slug]/talent/[candidateId]/index')
    .default,
  notesApi: require('pages/api/teams/[slug]/talent/[candidateId]/notes')
    .default,
  tagsApi: require('pages/api/teams/[slug]/talent/[candidateId]/tags').default,
  tagListApi: require('pages/api/teams/[slug]/talent/tags').default,
  poolsApi: require('pages/api/teams/[slug]/talent/pools/index').default,
  poolApi: require('pages/api/teams/[slug]/talent/pools/[poolId]/index')
    .default,
  poolMembersApi:
    require('pages/api/teams/[slug]/talent/pools/[poolId]/members').default,
  importApi: require('pages/api/teams/[slug]/talent/import').default,
  exportApi: require('pages/api/teams/[slug]/talent/export').default,
  dupApi: require('pages/api/teams/[slug]/talent/duplicates').default,
  mergeApi: require('pages/api/teams/[slug]/talent/merge').default,
  appInterviewsApi:
    require('pages/api/teams/[slug]/applications/[applicationId]/interviews')
      .default,
  interviewsApi: require('pages/api/teams/[slug]/interviews/index').default,
  interviewApi: require('pages/api/teams/[slug]/interviews/[interviewId]/index')
    .default,
  feedbackApi:
    require('pages/api/teams/[slug]/interviews/[interviewId]/feedback').default,
  offersApi: require('pages/api/teams/[slug]/offers/index').default,
  offerApi: require('pages/api/teams/[slug]/offers/[offerId]/index').default,
  offerActionApi: require('pages/api/teams/[slug]/offers/[offerId]/actions')
    .default,
  messagesApi: require('pages/api/teams/[slug]/messages/index').default,
  messageApi: require('pages/api/teams/[slug]/messages/[messageId]/index')
    .default,
  messageActionApi:
    require('pages/api/teams/[slug]/messages/[messageId]/actions').default,
  analyticsApi: require('pages/api/teams/[slug]/analytics/index').default,
  analyticsExportApi: require('pages/api/teams/[slug]/analytics/export')
    .default,
  stagesApi: require('pages/api/teams/[slug]/stages/index').default,
  stageOneApi: require('pages/api/teams/[slug]/stages/[stageId]').default,
  reorderApi: require('pages/api/teams/[slug]/stages/reorder').default,
  jobPipelineCfgApi:
    require('pages/api/teams/[slug]/jobs/[jobId]/pipeline-config').default,
  automationApi: require('pages/api/teams/[slug]/automation/index').default,
  ruleApi: require('pages/api/teams/[slug]/automation/[ruleId]').default,
  notificationsApi: require('pages/api/notifications/index').default,
  prefsApi: require('pages/api/notifications/preferences').default,
  myInterviewsApi: require('pages/api/candidate/interviews').default,
  myOffersApi: require('pages/api/candidate/offers/index').default,
  respondApi: require('pages/api/candidate/offers/[id]/respond').default,
  tickApi: require('pages/api/internal/tick').default,
  ticker: require('@/lib/ticker') as typeof import('@/lib/ticker'),
  csv: require('@/lib/csv') as typeof import('@/lib/csv'),
  notifications:
    require('@/lib/notifications') as typeof import('@/lib/notifications'),
  rate: require('@/lib/rateLimit') as typeof import('@/lib/rateLimit'),
  svix: require('@/lib/svix') as { sendEvent: jest.Mock },
  retraced: require('@/lib/retraced') as { sendAudit: jest.Mock },
  mail: require('@/lib/email/sendEmail') as { sendEmail: jest.Mock },
});

const DESC =
  '<p>We are hiring an engineer to build and run our platform services.</p>';
const future = (ms: number) => new Date(Date.now() + ms).toISOString();

suite('phase 3 (integration)', () => {
  const m = load();
  const { prisma } = m;
  const run = Date.now().toString(36);
  const users: Record<string, { id: string; email: string; name: string }> = {};
  let slugA = '';
  let slugB = '';
  let teamA: { id: string };
  let jobId = '';

  const call = async (
    handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void>,
    as: string | null,
    opts: {
      method?: string;
      query?: Record<string, string>;
      body?: unknown;
      headers?: Record<string, string>;
    } = {}
  ) => {
    currentUser = as ? users[as] : null;
    m.rate.resetRateLimits();
    const { req, res } = createMocks({
      method: (opts.method ?? 'GET') as never,
      query: opts.query ?? {},
      body: opts.body as never,
      headers: { 'x-forwarded-for': '10.0.0.1', ...opts.headers },
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
      text: text as string,
      headers: res._getHeaders(),
    };
  };

  const q = (slug: string, extra: Record<string, string> = {}) => ({
    slug,
    ...extra,
  });
  const A = (extra: Record<string, string> = {}) => q(slugA, extra);

  const mkUser = async (key: string) => {
    const u = await prisma.user.create({
      data: {
        name: key,
        email: `${key}-${run}@p3-test.com`,
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

  const stageId = async (teamId: string, name: string) =>
    (
      await prisma.pipelineStage.findFirstOrThrow({
        where: { teamId, jobId: null, name },
      })
    ).id;

  const newJob = async (
    as: string,
    slug: string,
    extra: Record<string, unknown> = {}
  ) => {
    const r = await call(m.jobsApi, as, {
      method: 'POST',
      query: q(slug),
      body: {
        title: 'Platform Engineer',
        descriptionHtml: DESC,
        workMode: 'REMOTE',
        ...extra,
      },
    });
    expect(r.status).toBe(201);
    return r.json.data as { id: string; slug: string };
  };

  const publish = async (as: string, slug: string, id: string) => {
    const r = await call(m.actionsApi, as, {
      method: 'POST',
      query: q(slug, { jobId: id }),
      body: { action: 'publish' },
    });
    expect(r.status).toBe(200);
  };

  /** A candidate account + a tenant candidate + an application (direct DB, fast). */
  const makeApp = async (
    key: string,
    opts: {
      job?: string;
      team?: { id: string };
      stage?: string;
      email?: string;
      linkUser?: boolean;
      createdAt?: Date;
    } = {}
  ) => {
    const team = opts.team ?? teamA;
    const job = opts.job ?? jobId;
    const email = opts.email ?? `${key}-${run}@cand3.com`;
    let userId: string | null = null;
    if (opts.linkUser !== false) {
      if (!users[key]) {
        const u = await prisma.user.create({
          data: { name: key, email, emailVerified: new Date() },
        });
        users[key] = { id: u.id, email, name: key };
      }
      userId = users[key].id;
    }
    const tc = await prisma.tenantCandidate.create({
      data: { teamId: team.id, userId, name: key, email, source: 'portal' },
    });
    const stage = await prisma.pipelineStage.findFirstOrThrow({
      where: { teamId: team.id, jobId: null, name: opts.stage ?? 'Applied' },
    });
    const app = await prisma.jobApplication.create({
      data: {
        teamId: team.id,
        jobId: job,
        tenantCandidateId: tc.id,
        stageId: stage.id,
        answers: [],
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      },
    });
    await prisma.applicationActivity.create({
      data: {
        teamId: team.id,
        applicationId: app.id,
        actorUserId: userId,
        type: 'APPLIED',
        toStageId: stage.id,
        payload: { toName: stage.name },
      },
    });
    return { appId: app.id, candidateId: tc.id, email };
  };

  const notificationsOf = (userKey: string, type?: string) =>
    prisma.notification.findMany({
      where: { userId: users[userKey].id, ...(type ? { type } : {}) },
    });

  beforeAll(async () => {
    for (const k of [
      'ownerA',
      'ownerB',
      'adminA',
      'hrA',
      'recA',
      'rec2A',
      'hmA',
      'ivA',
      'ivB',
      'viewerA',
    ]) {
      await mkUser(k);
    }
    slugA = `p3a-${run}`;
    slugB = `p3b-${run}`;
    teamA = await m.createPortal({
      userId: users.ownerA.id,
      name: 'Acme P3',
      slug: slugA,
    });
    await m.createPortal({
      userId: users.ownerB.id,
      name: 'Beta P3',
      slug: slugB,
    });
    await addMember(slugA, 'adminA', 'admin');
    await addMember(slugA, 'hrA', 'hr_manager');
    await addMember(slugA, 'recA', 'recruiter');
    await addMember(slugA, 'rec2A', 'recruiter');
    await addMember(slugA, 'hmA', 'hiring_manager');
    await addMember(slugA, 'ivA', 'interviewer');
    await addMember(slugA, 'ivB', 'interviewer');
    await addMember(slugA, 'viewerA', 'viewer');

    const job = await newJob('ownerA', slugA, { title: 'Platform Engineer' });
    jobId = job.id;
    await publish('ownerA', slugA, jobId);
    const asg = await call(m.assignApi, 'ownerA', {
      method: 'PUT',
      query: A({ jobId }),
      body: {
        assignments: [
          { userId: users.recA.id, kind: 'RECRUITER' },
          { userId: users.hmA.id, kind: 'HIRING_MANAGER' },
          { userId: users.ivA.id, kind: 'INTERVIEWER' },
        ],
      },
    });
    expect(asg.status).toBe(200);
  });

  afterAll(async () => {
    const emails = Object.values(users).map((u) => u.email);
    await prisma.team.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  // =========================================================================
  describe('tenant guard on Phase 3 models', () => {
    it('refuses un-scoped queries on every new tenant table', async () => {
      for (const model of [
        'candidateNote',
        'candidateTag',
        'candidateTagLink',
        'talentPool',
        'talentPoolMember',
        'interview',
        'interviewParticipant',
        'interviewFeedback',
        'interviewReminder',
        'offer',
        'offerApproval',
        'messageDraft',
        'automationRule',
      ] as const) {
        await expect((prisma as any)[model].findMany()).rejects.toThrow(
          /teamId/
        );
      }
    });
  });

  // =========================================================================
  describe('notification delivery basics', () => {
    it('respects preferences and never throws', async () => {
      const before = (await notificationsOf('viewerA')).length;
      await prisma.notificationPreference.create({
        data: {
          userId: users.viewerA.id,
          type: 'job.published',
          inApp: false,
          email: false,
        },
      });
      const r = await m.notifications.notify({
        userIds: [users.viewerA.id, users.viewerA.id, 'no-such-user'],
        type: 'job.published',
        title: 'x',
      });
      expect(r).toEqual({ inApp: 0, email: 0 });
      expect((await notificationsOf('viewerA')).length).toBe(before);
      await prisma.notificationPreference.deleteMany({
        where: { userId: users.viewerA.id },
      });
      const ok = await m.notifications.notify({
        userIds: [users.viewerA.id],
        type: 'job.published',
        title: 'hello',
      });
      expect(ok.inApp).toBe(1);
      expect(
        m.notifications.textToHtml('<script>alert(1)</script>\nline2')
      ).not.toContain('<script>');
    });
  });

  // =========================================================================
  describe('talent database', () => {
    let a1: Awaited<ReturnType<typeof makeApp>>;
    let a2: Awaited<ReturnType<typeof makeApp>>;
    let otherJob = '';
    let a3: Awaited<ReturnType<typeof makeApp>>;

    beforeAll(async () => {
      a1 = await makeApp('tal1');
      a2 = await makeApp('tal2');
      otherJob = (await newJob('ownerA', slugA, { title: 'Unassigned Role' }))
        .id;
      await publish('ownerA', slugA, otherJob);
      a3 = await makeApp('tal3', { job: otherJob });
    });

    it('owner/HR see all applicants; recruiters only applicants of assigned jobs', async () => {
      const all = await call(m.talentApi, 'ownerA', {
        query: A({ limit: '100' }),
      });
      const names = all.json.data.candidates.map(
        (c: { name: string }) => c.name
      );
      expect(names).toEqual(expect.arrayContaining(['tal1', 'tal2', 'tal3']));

      const rec = await call(m.talentApi, 'recA', {
        query: A({ limit: '100' }),
      });
      const recNames = rec.json.data.candidates.map(
        (c: { name: string }) => c.name
      );
      expect(recNames).toEqual(expect.arrayContaining(['tal1', 'tal2']));
      expect(recNames).not.toContain('tal3');

      const rec2 = await call(m.talentApi, 'rec2A', {
        query: A({ limit: '100' }),
      });
      expect(rec2.json.data.candidates).toHaveLength(0);

      expect(
        (
          await call(m.talentOneApi, 'recA', {
            query: A({ candidateId: a3.candidateId }),
          })
        ).status
      ).toBe(404);
      expect(
        (
          await call(m.talentOneApi, 'recA', {
            query: A({ candidateId: a1.candidateId }),
          })
        ).status
      ).toBe(200);
      expect(
        (
          await call(m.talentOneApi, 'hrA', {
            query: A({ candidateId: a3.candidateId }),
          })
        ).status
      ).toBe(200);
    });

    it('requires candidates.read; viewers and other portals are refused', async () => {
      expect((await call(m.talentApi, 'viewerA', { query: A() })).status).toBe(
        403
      );
      expect((await call(m.talentApi, 'hmA', { query: A() })).status).toBe(403);
      expect((await call(m.talentApi, 'ownerB', { query: A() })).status).toBe(
        403
      );
      expect((await call(m.talentApi, null, { query: A() })).status).toBe(401);
      // portal B cannot read A's candidate through B's slug
      expect(
        (
          await call(m.talentOneApi, 'ownerB', {
            query: q(slugB, { candidateId: a1.candidateId }),
          })
        ).status
      ).toBe(404);
    });

    it('hides candidates that never applied and gave no consent; shows those with talent-pool consent', async () => {
      const ghost = await prisma.user.create({
        data: { name: 'ghost', email: `ghost-${run}@cand3.com` },
      });
      users.ghost = { id: ghost.id, email: ghost.email, name: 'ghost' };
      const tc = await prisma.tenantCandidate.create({
        data: {
          teamId: teamA.id,
          userId: ghost.id,
          name: 'ghost',
          email: ghost.email,
          source: 'portal',
        },
      });
      const find = async () =>
        (await call(m.talentApi, 'ownerA', { query: A({ q: 'ghost' }) })).json
          .data.candidates.length;

      expect(await find()).toBe(0); // no application, no consent
      await prisma.candidateConsent.create({
        data: {
          userId: ghost.id,
          teamId: teamA.id,
          purpose: 'TALENT_POOL',
          granted: true,
          policyVersion: 'v1',
          grantedAt: new Date(Date.now() - 5000),
        },
      });
      expect(await find()).toBe(1); // consent given
      await prisma.candidateConsent.create({
        data: {
          userId: ghost.id,
          teamId: teamA.id,
          purpose: 'TALENT_POOL',
          granted: false,
          policyVersion: 'v1',
        },
      });
      expect(await find()).toBe(0); // latest decision wins
      await prisma.candidateConsent.updateMany({
        where: { teamId: teamA.id, userId: ghost.id, granted: true },
        data: { revokedAt: new Date() },
      });
      await prisma.candidateConsent.create({
        data: {
          userId: ghost.id,
          teamId: teamA.id,
          purpose: 'TALENT_POOL',
          granted: true,
          policyVersion: 'v2',
        },
      });
      expect(await find()).toBe(1);
      // consent to portal A does not expose the candidate to portal B
      expect(
        (await call(m.talentApi, 'ownerB', { query: q(slugB, { q: 'ghost' }) }))
          .json.data.candidates
      ).toHaveLength(0);
      void tc;
    });

    it('notes: add (candidates.update), author shown, scope enforced', async () => {
      expect(
        (
          await call(m.notesApi, 'viewerA', {
            method: 'POST',
            query: A({ candidateId: a1.candidateId }),
            body: { body: 'x' },
          })
        ).status
      ).toBe(403);
      expect(
        (
          await call(m.notesApi, 'recA', {
            method: 'POST',
            query: A({ candidateId: a3.candidateId }),
            body: { body: 'x' },
          })
        ).status
      ).toBe(404);
      expect(
        (
          await call(m.notesApi, 'recA', {
            method: 'POST',
            query: A({ candidateId: a1.candidateId }),
            body: { body: '' },
          })
        ).status
      ).toBe(422);
      const n = await call(m.notesApi, 'recA', {
        method: 'POST',
        query: A({ candidateId: a1.candidateId }),
        body: { body: 'Strong on systems design' },
      });
      expect(n.status).toBe(201);
      const d = await call(m.talentOneApi, 'hrA', {
        query: A({ candidateId: a1.candidateId }),
      });
      expect(d.json.data.notes[0]).toMatchObject({
        body: 'Strong on systems design',
        author: 'recA',
      });
      expect(d.json.data.applications).toHaveLength(1);
    });

    it('tags and pools: replace tags, filter by tag / pool / search, delete pool', async () => {
      const t = await call(m.tagsApi, 'hrA', {
        method: 'PUT',
        query: A({ candidateId: a1.candidateId }),
        body: { tags: ['golang', 'senior', 'golang'] },
      });
      expect(t.status).toBe(200);
      expect(
        t.json.data.tags.map((x: { name: string }) => x.name).sort()
      ).toEqual(['golang', 'senior']);
      await call(m.tagsApi, 'hrA', {
        method: 'PUT',
        query: A({ candidateId: a1.candidateId }),
        body: { tags: ['golang'] },
      });
      const tagList = await call(m.tagListApi, 'hrA', { query: A() });
      const golang = tagList.json.data.find(
        (x: { name: string }) => x.name === 'golang'
      );
      const byTag = await call(m.talentApi, 'hrA', {
        query: A({ tagId: golang.id }),
      });
      expect(
        byTag.json.data.candidates.map((c: { name: string }) => c.name)
      ).toEqual(['tal1']);

      const pool = await call(m.poolsApi, 'hrA', {
        method: 'POST',
        query: A(),
        body: { name: 'Backend bench' },
      });
      expect(pool.status).toBe(201);
      expect(
        (
          await call(m.poolsApi, 'hrA', {
            method: 'POST',
            query: A(),
            body: { name: 'Backend bench' },
          })
        ).status
      ).toBe(409);
      expect(
        (
          await call(m.poolsApi, 'viewerA', {
            method: 'POST',
            query: A(),
            body: { name: 'Nope pool' },
          })
        ).status
      ).toBe(403);
      const pid = pool.json.data.id;
      const add = await call(m.poolMembersApi, 'hrA', {
        method: 'PUT',
        query: A({ poolId: pid }),
        body: { candidateId: a2.candidateId, member: true },
      });
      expect(add.status).toBe(200);
      await call(m.poolMembersApi, 'hrA', {
        method: 'PUT',
        query: A({ poolId: pid }),
        body: { candidateId: a2.candidateId, member: true },
      }); // idempotent
      const byPool = await call(m.talentApi, 'hrA', {
        query: A({ poolId: pid }),
      });
      expect(
        byPool.json.data.candidates.map((c: { name: string }) => c.name)
      ).toEqual(['tal2']);
      const search = await call(m.talentApi, 'hrA', {
        query: A({ q: 'TAL1' }),
      });
      expect(search.json.data.candidates).toHaveLength(1);
      // a pool of portal A is unusable from portal B
      expect(
        (
          await call(m.poolMembersApi, 'ownerB', {
            method: 'PUT',
            query: q(slugB, { poolId: pid }),
            body: { candidateId: a1.candidateId, member: true },
          })
        ).status
      ).toBe(404);
      expect(
        (
          await call(m.poolApi, 'ownerB', {
            method: 'DELETE',
            query: q(slugB, { poolId: pid }),
          })
        ).status
      ).toBe(404);
      expect(
        (
          await call(m.poolApi, 'hrA', {
            method: 'DELETE',
            query: A({ poolId: pid }),
          })
        ).status
      ).toBe(200);
      expect(
        (
          await call(m.talentOneApi, 'hrA', {
            query: A({ candidateId: a2.candidateId }),
          })
        ).json.data.pools
      ).toHaveLength(0);
    });

    it('imports CSV: creates, skips duplicates, reports bad rows, tags and pool', async () => {
      const pool = (
        await call(m.poolsApi, 'hrA', {
          method: 'POST',
          query: A(),
          body: { name: 'Imported' },
        })
      ).json.data;
      const csv = [
        'Name,Email,Phone,Tags',
        'Ann Import,ann@import.test,+91 90000 00001,"go;remote"',
        'Bob Import,BOB@import.test,,',
        'Ann Again,ann@import.test,,',
        'No Email,,,',
        'Bad Email,not-an-email,,',
        '"Quote, Name",quote@import.test,,"a|b"',
      ].join('\n');
      const r = await call(m.importApi, 'hrA', {
        method: 'POST',
        query: A(),
        body: { csv, poolId: pool.id },
      });
      expect(r.status).toBe(200);
      expect(r.json.data.created).toBe(3);
      expect(r.json.data.skipped).toBe(1);
      expect(r.json.data.errors.map((e: { row: number }) => e.row)).toEqual([
        5, 6,
      ]);

      const list = await call(m.talentApi, 'hrA', {
        query: A({ source: 'import', limit: '100' }),
      });
      expect(
        list.json.data.candidates.map((c: { name: string }) => c.name).sort()
      ).toEqual(['Ann Import', 'Bob Import', 'Quote, Name']);
      const ann = list.json.data.candidates.find(
        (c: { name: string }) => c.name === 'Ann Import'
      );
      expect(ann.tags.map((t: { name: string }) => t.name).sort()).toEqual([
        'go',
        'remote',
      ]);
      expect(ann.pools[0].name).toBe('Imported');
      expect(
        (
          await call(m.importApi, 'hrA', {
            method: 'POST',
            query: A(),
            body: { csv, poolId: pool.id },
          })
        ).json.data.created
      ).toBe(0);
      // imported candidates are the portal's own records; recruiters (scoped) do not see them
      expect(
        (await call(m.talentApi, 'recA', { query: A({ source: 'import' }) }))
          .json.data.candidates
      ).toHaveLength(0);
    });

    it('rejects bad CSV and enforces candidates.import', async () => {
      expect(
        (
          await call(m.importApi, 'hrA', {
            method: 'POST',
            query: A(),
            body: { csv: 'a,b\n1,2' },
          })
        ).status
      ).toBe(422);
      expect(
        (
          await call(m.importApi, 'hrA', {
            method: 'POST',
            query: A(),
            body: { csv: 'name,email' },
          })
        ).status
      ).toBe(422);
      const big = [
        'name,email',
        ...Array.from({ length: 1001 }, (_, i) => `n${i},n${i}@big.test`),
      ].join('\n');
      expect(
        (
          await call(m.importApi, 'hrA', {
            method: 'POST',
            query: A(),
            body: { csv: big },
          })
        ).status
      ).toBe(422);
      expect(
        (
          await call(m.importApi, 'recA', {
            method: 'POST',
            query: A(),
            body: { csv: 'name,email\nx,x@y.test' },
          })
        ).status
      ).toBe(403);
      expect(
        (
          await call(m.importApi, 'ownerB', {
            method: 'POST',
            query: A(),
            body: { csv: 'name,email\nx,x@y.test' },
          })
        ).status
      ).toBe(403);
      expect(
        (
          await call(m.importApi, 'hrA', {
            method: 'POST',
            query: A(),
            body: { csv: 'name,email\nx,x@y.test', poolId: 'nope' },
          })
        ).status
      ).toBe(404);
    });

    it('exports CSV safely (formula injection), audited and permission-gated', async () => {
      await call(m.importApi, 'hrA', {
        method: 'POST',
        query: A(),
        body: {
          csv: 'name,email\n"=HYPERLINK(""http://evil"")",evil@import.test\n@SUM(1),at@import.test',
        },
      });
      m.retraced.sendAudit.mockClear();
      const r = await call(m.exportApi, 'hrA', { query: A() });
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('text/csv');
      expect(String(r.headers['content-disposition'])).toContain('attachment');
      expect(r.headers['cache-control']).toBe('no-store');
      const rows = m.csv.parseCsv(r.text);
      expect(rows[0]).toEqual([
        'name',
        'email',
        'phone',
        'source',
        'tags',
        'applications',
        'created_at',
      ]);
      expect(rows.some((row) => row[1] === 'tal1-' + run + '@cand3.com')).toBe(
        true
      );
      const evil = rows.find((row) => row[1] === 'evil@import.test')!;
      expect(evil[0].startsWith("'=")).toBe(true);
      expect(
        rows.find((row) => row[1] === 'at@import.test')![0].startsWith("'@")
      ).toBe(true);
      expect(m.retraced.sendAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'candidates.export' })
      );
      for (const who of ['recA', 'viewerA', 'hmA']) {
        expect((await call(m.exportApi, who, { query: A() })).status).toBe(403);
      }
      expect((await call(m.exportApi, 'ownerB', { query: A() })).status).toBe(
        403
      );
    });

    it('csv helper: parses quotes / CRLF / BOM and escapes on write', () => {
      expect(m.csv.parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n')).toEqual([
        ['a', 'b'],
        ['x, y', 'he said "hi"'],
      ]);
      expect(m.csv.toCsv(['h'], [['a,b'], ['-1+1'], ['plain']])).toBe(
        'h\r\n"a,b"\r\n\'-1+1\r\nplain\r\n'
      );
    });

    it('finds duplicates and merges them without losing history', async () => {
      const dupA = await makeApp('dupa', {
        email: `dup-a-${run}@d.test`,
        linkUser: false,
      });
      const dupB = await makeApp('dupb', {
        email: `dup-b-${run}@d.test`,
        linkUser: false,
        job: otherJob,
      });
      const dupC = await makeApp('dupc', {
        email: `dup-c-${run}@d.test`,
        linkUser: false,
      });
      await prisma.tenantCandidate.update({
        where: { id: dupA.candidateId, teamId: teamA.id },
        data: { phone: '+91 98765-43210', name: 'Dee Plicate' },
      });
      await prisma.tenantCandidate.update({
        where: { id: dupB.candidateId, teamId: teamA.id },
        data: { phone: '098765 43210' },
      });
      await prisma.tenantCandidate.update({
        where: { id: dupC.candidateId, teamId: teamA.id },
        data: { name: 'dee plicate' },
      });

      const dups = await call(m.dupApi, 'hrA', { query: A() });
      expect(dups.status).toBe(200);
      const groups = dups.json.data as {
        reason: string;
        candidates: { id: string }[];
      }[];
      const phoneGroup = groups.find(
        (g) =>
          g.reason === 'phone' &&
          g.candidates.some((c) => c.id === dupA.candidateId)
      );
      expect(phoneGroup!.candidates.map((c) => c.id).sort()).toEqual(
        [dupA.candidateId, dupB.candidateId].sort()
      );
      expect(
        groups
          .find((g) => g.reason === 'name')!
          .candidates.map((c) => c.id)
          .sort()
      ).toEqual([dupA.candidateId, dupC.candidateId].sort());

      // notes/tags to move
      await call(m.notesApi, 'hrA', {
        method: 'POST',
        query: A({ candidateId: dupB.candidateId }),
        body: { body: 'from B' },
      });
      await call(m.tagsApi, 'hrA', {
        method: 'PUT',
        query: A({ candidateId: dupB.candidateId }),
        body: { tags: ['merge-tag'] },
      });
      await call(m.tagsApi, 'hrA', {
        method: 'PUT',
        query: A({ candidateId: dupA.candidateId }),
        body: { tags: ['merge-tag'] },
      });

      expect(
        (
          await call(m.mergeApi, 'hrA', {
            method: 'POST',
            query: A(),
            body: { sourceId: dupA.candidateId, targetId: dupA.candidateId },
          })
        ).status
      ).toBe(400);
      expect(
        (
          await call(m.mergeApi, 'viewerA', {
            method: 'POST',
            query: A(),
            body: { sourceId: dupB.candidateId, targetId: dupA.candidateId },
          })
        ).status
      ).toBe(403);
      // a scoped recruiter cannot even see candidates of jobs they are not on
      expect(
        (
          await call(m.mergeApi, 'recA', {
            method: 'POST',
            query: A(),
            body: { sourceId: dupB.candidateId, targetId: dupA.candidateId },
          })
        ).status
      ).toBe(404);
      expect(
        (
          await call(m.mergeApi, 'ownerB', {
            method: 'POST',
            query: q(slugB),
            body: { sourceId: dupB.candidateId, targetId: dupA.candidateId },
          })
        ).status
      ).toBe(404);

      m.retraced.sendAudit.mockClear();
      const merged = await call(m.mergeApi, 'hrA', {
        method: 'POST',
        query: A(),
        body: { sourceId: dupB.candidateId, targetId: dupA.candidateId },
      });
      expect(merged.status).toBe(200);
      expect(merged.json.data.movedApplications).toBe(1);
      expect(m.retraced.sendAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'candidate.merge' })
      );

      const target = await call(m.talentOneApi, 'hrA', {
        query: A({ candidateId: dupA.candidateId }),
      });
      expect(target.json.data.applications).toHaveLength(2);
      expect(
        target.json.data.notes.map((n: { body: string }) => n.body)
      ).toContain('from B');
      expect(target.json.data.tags).toHaveLength(1); // merge-tag not duplicated
      expect(
        (
          await call(m.talentOneApi, 'hrA', {
            query: A({ candidateId: dupB.candidateId }),
          })
        ).status
      ).toBe(404); // hidden
      expect(
        (
          await call(m.mergeApi, 'hrA', {
            method: 'POST',
            query: A(),
            body: { sourceId: dupB.candidateId, targetId: dupC.candidateId },
          })
        ).status
      ).toBe(404); // already merged
    });

    it('merge keeps a conflicting application on the hidden source record', async () => {
      const x = await makeApp('mx', {
        email: `mx-${run}@d.test`,
        linkUser: false,
      });
      const y = await makeApp('my', {
        email: `my-${run}@d.test`,
        linkUser: false,
      }); // same job as x
      const r = await call(m.mergeApi, 'hrA', {
        method: 'POST',
        query: A(),
        body: { sourceId: y.candidateId, targetId: x.candidateId },
      });
      expect(r.status).toBe(200);
      expect(r.json.data.movedApplications).toBe(0);
      expect(
        await prisma.jobApplication.count({
          where: { teamId: teamA.id, id: y.appId },
        })
      ).toBe(1); // nothing deleted
    });
  });

  // =========================================================================
  describe('interviews and scorecards', () => {
    let app: Awaited<ReturnType<typeof makeApp>>;
    let interviewId = '';

    const schedule = (
      as: string,
      body: Record<string, unknown> = {},
      appId = app.appId
    ) =>
      call(m.appInterviewsApi, as, {
        method: 'POST',
        query: A({ applicationId: appId }),
        body: {
          startsAt: future(48 * 3600_000),
          durationMin: 60,
          meetingUrl: 'https://meet.example.com/x',
          participantIds: [users.ivA.id, users.hmA.id],
          ...body,
        },
      });

    beforeAll(async () => {
      app = await makeApp('intv1');
    });

    it('is permission-checked and validates participants and time', async () => {
      expect((await schedule('viewerA')).status).toBe(403);
      expect((await schedule('ivA')).status).toBe(403);
      expect((await schedule('ownerB')).status).toBe(403);
      expect(
        (await schedule('recA', { startsAt: future(-3600_000) })).status
      ).toBe(422);
      expect((await schedule('recA', { startsAt: 'tomorrow' })).status).toBe(
        422
      );
      expect((await schedule('recA', { participantIds: [] })).status).toBe(422);
      expect(
        (await schedule('recA', { participantIds: [users.viewerA.id] })).status
      ).toBe(422); // cannot submit feedback
      expect(
        (await schedule('recA', { participantIds: [users.ownerB.id] })).status
      ).toBe(422); // not a member
      expect(
        (await schedule('recA', { meetingUrl: 'javascript:alert(1)' })).status
      ).toBe(422);
      expect((await schedule('rec2A')).status).toBe(404); // not assigned to the job
      expect(
        await prisma.interview.count({ where: { teamId: teamA.id } })
      ).toBe(0);
    });

    it('schedules: participants, activity, invite DRAFT for the candidate, notifications, event', async () => {
      m.svix.sendEvent.mockClear();
      m.mail.sendEmail.mockClear();
      const r = await schedule('recA');
      expect(r.status).toBe(201);
      interviewId = r.json.data.id;
      expect(r.json.data.round).toBe(1);
      expect(
        r.json.data.participants.map((p: { name: string }) => p.name).sort()
      ).toEqual(['hmA', 'ivA']);

      const draft = await prisma.messageDraft.findFirstOrThrow({
        where: { teamId: teamA.id, id: r.json.data.inviteDraftId },
      });
      expect(draft).toMatchObject({
        kind: 'INTERVIEW_INVITE',
        status: 'DRAFT',
        recipientEmail: app.email,
      });
      expect(draft.body).toContain('meet.example.com');
      expect(m.mail.sendEmail).not.toHaveBeenCalledWith(
        expect.objectContaining({ to: app.email })
      ); // never auto-sent

      const acts = await prisma.applicationActivity.findMany({
        where: {
          teamId: teamA.id,
          applicationId: app.appId,
          type: 'INTERVIEW',
        },
      });
      expect(acts).toHaveLength(1);
      expect((await notificationsOf('ivA', 'interview.scheduled')).length).toBe(
        1
      );
      expect((await notificationsOf('hmA', 'interview.scheduled')).length).toBe(
        1
      );
      expect(
        (await notificationsOf('intv1', 'interview.scheduled')).length
      ).toBe(1); // candidate, in-app
      expect(m.mail.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: users.ivA.email })
      ); // email default on
      expect(m.svix.sendEvent).toHaveBeenCalledWith(
        teamA.id,
        'interview.scheduled',
        expect.objectContaining({ interviewId })
      );

      const second = await schedule('recA');
      expect(second.json.data.round).toBe(2);
    });

    it('cannot schedule for inactive applications', async () => {
      const w = await makeApp('intvw', { stage: 'Withdrawn' });
      expect((await schedule('recA', {}, w.appId)).status).toBe(409);
      const rej = await makeApp('intvr', { stage: 'Rejected' });
      expect((await schedule('recA', {}, rej.appId)).status).toBe(409);
    });

    it('interviewers see only their own interviews; managers see all', async () => {
      const mine = await call(m.interviewsApi, 'ivA', { query: A() });
      expect(mine.status).toBe(200);
      expect(mine.json.data.length).toBe(2);
      expect(
        (await call(m.interviewsApi, 'ivB', { query: A() })).json.data
      ).toHaveLength(0);
      expect(
        (await call(m.interviewApi, 'ivB', { query: A({ interviewId }) }))
          .status
      ).toBe(404);
      expect(
        (await call(m.interviewApi, 'ivA', { query: A({ interviewId }) }))
          .status
      ).toBe(200);
      expect(
        (await call(m.interviewsApi, 'recA', { query: A() })).json.data.length
      ).toBe(2);
      expect(
        (await call(m.interviewsApi, 'rec2A', { query: A() })).json.data
      ).toHaveLength(0); // scope
      expect(
        (await call(m.interviewsApi, 'viewerA', { query: A() })).status
      ).toBe(403);
      expect(
        (await call(m.interviewsApi, 'ownerB', { query: A() })).status
      ).toBe(403);
      expect(
        (
          await call(m.interviewApi, 'ownerB', {
            query: q(slugB, { interviewId }),
          })
        ).status
      ).toBe(404);
    });

    it('feedback: only after the interview, only participants, validated, private to the author', async () => {
      const fb = (as: string, body: unknown, id = interviewId) =>
        call(m.feedbackApi, as, {
          method: 'PUT',
          query: A({ interviewId: id }),
          body,
        });
      const good = {
        scores: { 'Technical skills': 4, Communication: 3 },
        recommendation: 'HIRE',
        notes: 'Solid',
      };

      expect((await fb('ivA', good)).status).toBe(409); // not yet taken place
      await prisma.interview.update({
        where: { id: interviewId, teamId: teamA.id },
        data: { startsAt: new Date(Date.now() - 3600_000) },
      });

      expect((await fb('ivB', good)).status).toBe(404); // not a participant (cannot even see it)
      expect((await fb('recA', good)).status).toBe(403); // lacks feedback.submit
      expect((await fb('ivA', { ...good, scores: { x: 5 } })).status).toBe(422);
      expect((await fb('ivA', { ...good, scores: { x: 0 } })).status).toBe(422);
      expect((await fb('ivA', { ...good, scores: {} })).status).toBe(422);
      expect(
        (await fb('ivA', { ...good, recommendation: 'MAYBE' })).status
      ).toBe(422);

      const r = await fb('ivA', good);
      expect(r.status).toBe(200);
      expect(r.json.data.status).toBe('SCHEDULED'); // hmA has not submitted yet
      expect(
        r.json.data.participants.find((p: { name: string }) => p.name === 'ivA')
          .submitted
      ).toBe(true);

      // hmA cannot see ivA's feedback; the manager can
      const hmView = await call(m.interviewApi, 'hmA', {
        query: A({ interviewId }),
      });
      expect(hmView.json.data.feedback).toHaveLength(0);
      const mgr = await call(m.interviewApi, 'recA', {
        query: A({ interviewId }),
      });
      expect(mgr.json.data.feedback).toHaveLength(1);

      // editing own feedback updates instead of duplicating
      await fb('ivA', { ...good, recommendation: 'STRONG_HIRE' });
      expect(
        await prisma.interviewFeedback.count({
          where: { teamId: teamA.id, interviewId },
        })
      ).toBe(1);

      const done = await fb('hmA', {
        scores: { Communication: 2 },
        recommendation: 'NO_HIRE',
      });
      expect(done.json.data.status).toBe('COMPLETED'); // all participants submitted
      expect(
        (await call(m.interviewApi, 'hmA', { query: A({ interviewId }) })).json
          .data.feedback
      ).toHaveLength(1);
      expect(
        (await call(m.interviewApi, 'recA', { query: A({ interviewId }) })).json
          .data.feedback
      ).toHaveLength(2);
    });

    it('reschedule resets reminders and notifies; cancel notifies and blocks feedback', async () => {
      const second = (
        await prisma.interview.findMany({
          where: { teamId: teamA.id, applicationId: app.appId },
          orderBy: { round: 'asc' },
        })
      )[1];
      await prisma.interviewReminder.create({
        data: { teamId: teamA.id, interviewId: second.id, kind: '24h' },
      });
      const before = (await notificationsOf('ivA', 'interview.scheduled'))
        .length;

      const newTime = future(72 * 3600_000);
      const r = await call(m.interviewApi, 'recA', {
        method: 'PUT',
        query: A({ interviewId: second.id }),
        body: { startsAt: newTime },
      });
      expect(r.status).toBe(200);
      expect(
        await prisma.interviewReminder.count({
          where: { teamId: teamA.id, interviewId: second.id },
        })
      ).toBe(0);
      expect((await notificationsOf('ivA', 'interview.scheduled')).length).toBe(
        before + 1
      );
      expect(
        (
          await call(m.interviewApi, 'recA', {
            method: 'PUT',
            query: A({ interviewId: second.id }),
            body: { startsAt: future(-1000) },
          })
        ).status
      ).toBe(422);
      expect(
        (
          await call(m.interviewApi, 'ivA', {
            method: 'PUT',
            query: A({ interviewId: second.id }),
            body: { durationMin: 20 },
          })
        ).status
      ).toBe(403);

      const c = await call(m.interviewApi, 'recA', {
        method: 'PUT',
        query: A({ interviewId: second.id }),
        body: { status: 'CANCELLED' },
      });
      expect(c.json.data.status).toBe('CANCELLED');
      expect((await notificationsOf('ivA', 'interview.cancelled')).length).toBe(
        1
      );
      expect(
        (
          await call(m.interviewApi, 'recA', {
            method: 'PUT',
            query: A({ interviewId: second.id }),
            body: { durationMin: 20 },
          })
        ).status
      ).toBe(409);
      await prisma.interview.update({
        where: { id: second.id, teamId: teamA.id },
        data: { startsAt: new Date(Date.now() - 1000) },
      });
      expect(
        (
          await call(m.feedbackApi, 'ivA', {
            method: 'PUT',
            query: A({ interviewId: second.id }),
            body: { scores: { a: 1 }, recommendation: 'HIRE' },
          })
        ).status
      ).toBe(409);
    });

    it('candidates see only their own upcoming interviews', async () => {
      const mineNow = await call(m.myInterviewsApi, 'intv1');
      expect(mineNow.status).toBe(200);
      expect(Array.isArray(mineNow.json.data)).toBe(true);
      expect(JSON.stringify(mineNow.json)).not.toMatch(
        /participants|feedback|userId/
      );
      const other = await call(m.myInterviewsApi, 'tal1');
      expect(other.json.data).toHaveLength(0);
      expect((await call(m.myInterviewsApi, null)).status).toBe(401);
    });
  });

  // =========================================================================
  describe('message drafts: human approval before anything is sent', () => {
    let app: Awaited<ReturnType<typeof makeApp>>;
    let msgId = '';

    beforeAll(async () => {
      app = await makeApp('msg1');
    });

    const act = (as: string, id: string, action: string) =>
      call(m.messageActionApi, as, {
        method: 'POST',
        query: A({ messageId: id }),
        body: { action },
      });

    it('creates drafts for permitted users within scope', async () => {
      const body = {
        applicationId: app.appId,
        kind: 'CUSTOM',
        subject: 'Hello',
        body: 'Hi there',
      };
      expect(
        (
          await call(m.messagesApi, 'viewerA', {
            method: 'POST',
            query: A(),
            body,
          })
        ).status
      ).toBe(403);
      expect(
        (
          await call(m.messagesApi, 'rec2A', {
            method: 'POST',
            query: A(),
            body,
          })
        ).status
      ).toBe(404);
      expect(
        (
          await call(m.messagesApi, 'ownerB', {
            method: 'POST',
            query: A(),
            body,
          })
        ).status
      ).toBe(403);
      expect(
        (
          await call(m.messagesApi, 'recA', {
            method: 'POST',
            query: A(),
            body: { ...body, subject: '' },
          })
        ).status
      ).toBe(422);
      const r = await call(m.messagesApi, 'recA', {
        method: 'POST',
        query: A(),
        body,
      });
      expect(r.status).toBe(201);
      expect(r.json.data).toMatchObject({
        status: 'DRAFT',
        recipientEmail: app.email,
        createdByAi: false,
      });
      msgId = r.json.data.id;
    });

    it('cannot send an unapproved message', async () => {
      m.mail.sendEmail.mockClear();
      const r = await act('recA', msgId, 'send');
      expect(r.status).toBe(409);
      expect(m.mail.sendEmail).not.toHaveBeenCalled();
    });

    it('edits only while DRAFT; approval locks the text', async () => {
      const edit = await call(m.messageApi, 'recA', {
        method: 'PUT',
        query: A({ messageId: msgId }),
        body: { body: 'Hi there, updated' },
      });
      expect(edit.status).toBe(200);
      const a = await act('recA', msgId, 'approve');
      expect(a.json.data).toMatchObject({
        status: 'APPROVED',
        approvedById: users.recA.id,
      });
      expect(
        (
          await call(m.messageApi, 'recA', {
            method: 'PUT',
            query: A({ messageId: msgId }),
            body: { body: 'sneaky change' },
          })
        ).status
      ).toBe(409);
      expect((await act('recA', msgId, 'approve')).status).toBe(409);
    });

    it('sends exactly the approved text once, records it on the application', async () => {
      m.mail.sendEmail.mockClear();
      const r = await act('recA', msgId, 'send');
      expect(r.status).toBe(200);
      expect(r.json.data.status).toBe('SENT');
      expect(m.mail.sendEmail).toHaveBeenCalledTimes(1);
      expect(m.mail.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: app.email,
          subject: 'Hello',
          text: 'Hi there, updated',
        })
      );
      expect((await act('recA', msgId, 'send')).status).toBe(409); // no double send
      expect(m.mail.sendEmail).toHaveBeenCalledTimes(1);
      expect(
        await prisma.applicationActivity.count({
          where: { teamId: teamA.id, applicationId: app.appId, type: 'EMAIL' },
        })
      ).toBe(1);
      expect((await act('recA', msgId, 'discard')).status).toBe(409);
    });

    it('concurrent sends deliver once', async () => {
      const d = await call(m.messagesApi, 'recA', {
        method: 'POST',
        query: A(),
        body: {
          applicationId: app.appId,
          kind: 'CUSTOM',
          subject: 'Race',
          body: 'x',
        },
      });
      await act('recA', d.json.data.id, 'approve');
      m.mail.sendEmail.mockClear();
      const results = await Promise.all([
        act('recA', d.json.data.id, 'send'),
        act('recA', d.json.data.id, 'send'),
        act('recA', d.json.data.id, 'send'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect(m.mail.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('a delivery failure leaves the message approved with the error; discard works', async () => {
      const d = await call(m.messagesApi, 'recA', {
        method: 'POST',
        query: A(),
        body: {
          applicationId: app.appId,
          kind: 'REJECTION',
          subject: 'Fail',
          body: 'x',
        },
      });
      await act('recA', d.json.data.id, 'approve');
      m.mail.sendEmail.mockRejectedValueOnce(new Error('SMTP down'));
      const r = await act('recA', d.json.data.id, 'send');
      expect(r.status).toBe(502);
      const row = await prisma.messageDraft.findFirstOrThrow({
        where: { teamId: teamA.id, id: d.json.data.id },
      });
      expect(row.status).toBe('APPROVED');
      expect(row.error).toContain('SMTP down');
      expect((await act('recA', d.json.data.id, 'send')).status).toBe(200); // retry succeeds
      const d2 = await call(m.messagesApi, 'recA', {
        method: 'POST',
        query: A(),
        body: {
          applicationId: app.appId,
          kind: 'CUSTOM',
          subject: 'Drop',
          body: 'x',
        },
      });
      expect(
        (await act('recA', d2.json.data.id, 'discard')).json.data.status
      ).toBe('DISCARDED');
      expect((await act('recA', d2.json.data.id, 'approve')).status).toBe(409);
    });

    it('lists with filters, honours job scope and tenant isolation', async () => {
      const mine = await call(m.messagesApi, 'recA', {
        query: A({ status: 'SENT' }),
      });
      expect(mine.json.data.length).toBeGreaterThanOrEqual(1);
      expect(
        (await call(m.messagesApi, 'rec2A', { query: A() })).json.data
      ).toHaveLength(0);
      expect(
        (
          await call(m.messagesApi, 'hrA', {
            query: A({ applicationId: app.appId }),
          })
        ).json.data.length
      ).toBeGreaterThan(1);
      expect(
        (
          await call(m.messageActionApi, 'ownerB', {
            method: 'POST',
            query: q(slugB, { messageId: msgId }),
            body: { action: 'discard' },
          })
        ).status
      ).toBe(404);
      expect(
        (
          await call(m.messageActionApi, 'rec2A', {
            method: 'POST',
            query: A({ messageId: msgId }),
            body: { action: 'discard' },
          })
        ).status
      ).toBe(404);
    });
  });

  // =========================================================================
  describe('offers and the approval chain', () => {
    let app: Awaited<ReturnType<typeof makeApp>>;
    let offerId = '';

    const offerAct = (as: string, id: string, body: unknown) =>
      call(m.offerActionApi, as, {
        method: 'POST',
        query: A({ offerId: id }),
        body,
      });

    beforeAll(async () => {
      app = await makeApp('off1');
    });

    it('is created by offers.manage only, one open offer per application', async () => {
      const body = {
        applicationId: app.appId,
        fixed: 2400000,
        variable: 200000,
        currency: 'inr',
        expiresAt: future(7 * 86400_000),
        startDate: future(30 * 86400_000),
      };
      expect(
        (await call(m.offersApi, 'recA', { method: 'POST', query: A(), body }))
          .status
      ).toBe(403);
      expect(
        (await call(m.offersApi, 'hmA', { method: 'POST', query: A(), body }))
          .status
      ).toBe(403);
      expect(
        (
          await call(m.offersApi, 'viewerA', {
            method: 'POST',
            query: A(),
            body,
          })
        ).status
      ).toBe(403);
      expect(
        (
          await call(m.offersApi, 'ownerB', {
            method: 'POST',
            query: A(),
            body,
          })
        ).status
      ).toBe(403);
      expect(
        (
          await call(m.offersApi, 'hrA', {
            method: 'POST',
            query: A(),
            body: { ...body, fixed: -1 },
          })
        ).status
      ).toBe(422);
      const r = await call(m.offersApi, 'hrA', {
        method: 'POST',
        query: A(),
        body,
      });
      expect(r.status).toBe(201);
      expect(r.json.data).toMatchObject({
        status: 'DRAFT',
        fixed: 2400000,
        currency: 'INR',
        round: 0,
      });
      offerId = r.json.data.id;
      expect(
        (await call(m.offersApi, 'hrA', { method: 'POST', query: A(), body }))
          .status
      ).toBe(409);
      const closed = await makeApp('off0', { stage: 'Rejected' });
      expect(
        (
          await call(m.offersApi, 'hrA', {
            method: 'POST',
            query: A(),
            body: { ...body, applicationId: closed.appId },
          })
        ).status
      ).toBe(409);
    });

    it('compensation is visible only to managers and the offer approvers', async () => {
      expect(
        (await call(m.offerApi, 'hmA', { query: A({ offerId }) })).status
      ).toBe(404); // not (yet) an approver
      expect(
        (await call(m.offerApi, 'viewerA', { query: A({ offerId }) })).status
      ).toBe(403);
      expect((await call(m.offersApi, 'viewerA', { query: A() })).status).toBe(
        403
      );
      expect(
        (await call(m.offerApi, 'ownerB', { query: q(slugB, { offerId }) }))
          .status
      ).toBe(404);
      expect(
        (await call(m.offerApi, 'hrA', { query: A({ offerId }) })).json.data
          .fixed
      ).toBe(2400000);
    });

    it('drafts can be edited; submitting validates the approvers', async () => {
      const upd = await call(m.offerApi, 'hrA', {
        method: 'PUT',
        query: A({ offerId }),
        body: { fixed: 2500000 },
      });
      expect(upd.json.data.fixed).toBe(2500000);
      expect((await offerAct('hrA', offerId, { action: 'send' })).status).toBe(
        409
      ); // not approved
      expect(
        (await offerAct('hrA', offerId, { action: 'submit', approverIds: [] }))
          .status
      ).toBe(422);
      expect(
        (
          await offerAct('hrA', offerId, {
            action: 'submit',
            approverIds: [users.hmA.id, users.hmA.id],
          })
        ).status
      ).toBe(422);
      expect(
        (
          await offerAct('hrA', offerId, {
            action: 'submit',
            approverIds: [users.hrA.id],
          })
        ).status
      ).toBe(422); // self
      expect(
        (
          await offerAct('hrA', offerId, {
            action: 'submit',
            approverIds: [users.ivA.id],
          })
        ).status
      ).toBe(422); // no offers.approve
      expect(
        (
          await offerAct('hrA', offerId, {
            action: 'submit',
            approverIds: [users.ownerB.id],
          })
        ).status
      ).toBe(422); // other portal
      expect(
        (
          await offerAct('recA', offerId, {
            action: 'submit',
            approverIds: [users.hmA.id],
          })
        ).status
      ).toBe(403);
    });

    it('runs a sequential chain; out-of-order and non-approvers are refused', async () => {
      const sub = await offerAct('hrA', offerId, {
        action: 'submit',
        approverIds: [users.hmA.id, users.adminA.id],
      });
      expect(sub.status).toBe(200);
      expect(sub.json.data).toMatchObject({
        status: 'PENDING_APPROVAL',
        round: 1,
      });
      expect(
        (await notificationsOf('hmA', 'offer.approval_requested')).length
      ).toBe(1);
      expect(
        (await notificationsOf('adminA', 'offer.approval_requested')).length
      ).toBe(0); // not their turn yet
      expect(
        (
          await call(m.offerApi, 'hmA', {
            method: 'PUT',
            query: A({ offerId }),
            body: { fixed: 1 },
          })
        ).status
      ).toBe(403);
      expect(
        (
          await call(m.offerApi, 'hrA', {
            method: 'PUT',
            query: A({ offerId }),
            body: { fixed: 1 },
          })
        ).status
      ).toBe(409); // locked

      expect(
        (await offerAct('adminA', offerId, { action: 'approve' })).status
      ).toBe(409); // hm first
      expect(
        (await offerAct('ownerA', offerId, { action: 'approve' })).status
      ).toBe(403); // not an approver
      expect(
        (await offerAct('hrA', offerId, { action: 'approve' })).status
      ).toBe(403); // creator lacks offers.approve
      expect((await offerAct('hrA', offerId, { action: 'send' })).status).toBe(
        409
      );

      // hm (hiring manager, no applications.manage) can see + decide because they are an approver
      expect(
        (await call(m.offerApi, 'hmA', { query: A({ offerId }) })).status
      ).toBe(200);
      const a1 = await offerAct('hmA', offerId, {
        action: 'approve',
        comment: 'ok',
      });
      expect(a1.json.data.status).toBe('PENDING_APPROVAL');
      expect(
        (await offerAct('hmA', offerId, { action: 'approve' })).status
      ).toBe(403); // already decided
      expect(
        (await notificationsOf('adminA', 'offer.approval_requested')).length
      ).toBe(1);
      const a2 = await offerAct('adminA', offerId, { action: 'approve' });
      expect(a2.json.data.status).toBe('APPROVED');
      expect(
        a2.json.data.approvals.map((a: { status: string }) => a.status)
      ).toEqual(['APPROVED', 'APPROVED']);
    });

    it('a rejection sends the offer back to draft and the next submission is a new round', async () => {
      const app2 = await makeApp('off2');
      const o = (
        await call(m.offersApi, 'hrA', {
          method: 'POST',
          query: A(),
          body: { applicationId: app2.appId, fixed: 1000000 },
        })
      ).json.data;
      await offerAct('hrA', o.id, {
        action: 'submit',
        approverIds: [users.hmA.id],
      });
      const r = await offerAct('hmA', o.id, {
        action: 'reject',
        comment: 'too high',
      });
      expect(r.json.data.status).toBe('DRAFT');
      expect(r.json.data.approvals[0]).toMatchObject({
        status: 'REJECTED',
        comment: 'too high',
      });
      expect(
        (await notificationsOf('hrA', 'offer.approval_requested')).some((n) =>
          /rejected/i.test(n.title)
        )
      ).toBe(true);
      await call(m.offerApi, 'hrA', {
        method: 'PUT',
        query: A({ offerId: o.id }),
        body: { fixed: 900000 },
      });
      const again = await offerAct('hrA', o.id, {
        action: 'submit',
        approverIds: [users.hmA.id],
      });
      expect(again.json.data.round).toBe(2);
      expect(again.json.data.approvals).toHaveLength(2); // history kept
      await offerAct('hmA', o.id, { action: 'approve' });
      expect(
        (await call(m.offerApi, 'hrA', { query: A({ offerId: o.id }) })).json
          .data.status
      ).toBe('APPROVED');
      await prisma.offer.update({
        where: { id: o.id, teamId: teamA.id },
        data: { status: 'DECLINED' },
      }); // free the application
    });

    it('serialises concurrent decisions by the same approver', async () => {
      const app3 = await makeApp('off3');
      const o = (
        await call(m.offersApi, 'hrA', {
          method: 'POST',
          query: A(),
          body: { applicationId: app3.appId, fixed: 1 },
        })
      ).json.data;
      await offerAct('hrA', o.id, {
        action: 'submit',
        approverIds: [users.hmA.id, users.adminA.id],
      });
      const rs = await Promise.all([
        offerAct('hmA', o.id, { action: 'approve' }),
        offerAct('hmA', o.id, { action: 'approve' }),
        offerAct('adminA', o.id, { action: 'approve' }),
      ]);
      const st = rs.map((r) => r.status);
      expect(st.filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
      const rows = await prisma.offerApproval.findMany({
        where: { teamId: teamA.id, offerId: o.id },
      });
      expect(
        rows.filter(
          (r) => r.approverUserId === users.hmA.id && r.status === 'APPROVED'
        )
      ).toHaveLength(1);
      // admin can only have decided after hm: if admin is APPROVED then hm must be too
      if (
        rows.find((r) => r.approverUserId === users.adminA.id)!.status ===
        'APPROVED'
      ) {
        expect(
          rows.find((r) => r.approverUserId === users.hmA.id)!.status
        ).toBe('APPROVED');
      }
      await prisma.offer.update({
        where: { id: o.id, teamId: teamA.id },
        data: { status: 'DECLINED' },
      });
    });

    it('sends only approved offers: SENT, an approved message is delivered, candidate is told', async () => {
      m.mail.sendEmail.mockClear();
      m.svix.sendEvent.mockClear();
      expect((await offerAct('recA', offerId, { action: 'send' })).status).toBe(
        403
      );
      const sent = await offerAct('hrA', offerId, { action: 'send' });
      expect(sent.status).toBe(200);
      expect(sent.json.data.status).toBe('SENT');
      const draft = await prisma.messageDraft.findFirstOrThrow({
        where: { teamId: teamA.id, applicationId: app.appId, kind: 'OFFER' },
      });
      expect(draft).toMatchObject({
        status: 'SENT',
        approvedById: users.adminA.id,
      });
      expect(m.mail.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: app.email })
      );
      expect((await notificationsOf('off1', 'offer.sent')).length).toBe(1);
      expect(m.svix.sendEvent).toHaveBeenCalledWith(
        teamA.id,
        'offer.sent',
        expect.anything()
      );
      expect((await offerAct('hrA', offerId, { action: 'send' })).status).toBe(
        409
      );
    });

    it('the candidate sees only their own sent offers', async () => {
      const mine = await call(m.myOffersApi, 'off1');
      expect(mine.json.data).toHaveLength(1);
      expect(mine.json.data[0]).toMatchObject({
        status: 'SENT',
        fixed: 2500000,
      });
      expect((await call(m.myOffersApi, 'tal1')).json.data).toHaveLength(0);
      expect((await call(m.myOffersApi, null)).status).toBe(401);
      // draft / pending offers are never exposed
      const hidden = await makeApp('off4');
      await call(m.offersApi, 'hrA', {
        method: 'POST',
        query: A(),
        body: { applicationId: hidden.appId, fixed: 5 },
      });
      expect((await call(m.myOffersApi, 'off4')).json.data).toHaveLength(0);
    });

    it('accepting hires the candidate, moves the stage, notifies and emits events', async () => {
      m.svix.sendEvent.mockClear();
      expect(
        (
          await call(m.respondApi, 'tal1', {
            method: 'POST',
            query: { id: offerId },
            body: { accept: true },
          })
        ).status
      ).toBe(404); // not theirs
      const r = await call(m.respondApi, 'off1', {
        method: 'POST',
        query: { id: offerId },
        body: { accept: true },
      });
      expect(r.status).toBe(200);
      const row = await prisma.jobApplication.findFirstOrThrow({
        where: { teamId: teamA.id, id: app.appId },
        include: { stage: true },
      });
      expect(row.stage.kind).toBe('HIRED');
      const acts = await prisma.applicationActivity.findMany({
        where: { teamId: teamA.id, applicationId: app.appId },
        orderBy: { createdAt: 'asc' },
      });
      expect(acts.map((a) => a.type)).toEqual(
        expect.arrayContaining(['OFFER', 'STAGE_CHANGED'])
      );
      expect((await notificationsOf('hrA', 'offer.accepted')).length).toBe(1);
      expect(m.svix.sendEvent).toHaveBeenCalledWith(
        teamA.id,
        'offer.accepted',
        expect.anything()
      );
      expect(m.svix.sendEvent).toHaveBeenCalledWith(
        teamA.id,
        'candidate.hired',
        expect.anything()
      );
      expect(
        (
          await call(m.respondApi, 'off1', {
            method: 'POST',
            query: { id: offerId },
            body: { accept: false },
          })
        ).status
      ).toBe(409); // answered once
      expect(
        (await call(m.offerApi, 'hrA', { query: A({ offerId }) })).json.data
          .status
      ).toBe('ACCEPTED');
    });

    it('declining keeps the application open; expired offers cannot be answered; double accept is safe', async () => {
      const mk = async (key: string, extra: Record<string, unknown> = {}) => {
        const a = await makeApp(key);
        const o = (
          await call(m.offersApi, 'hrA', {
            method: 'POST',
            query: A(),
            body: { applicationId: a.appId, fixed: 9, ...extra },
          })
        ).json.data;
        await offerAct('hrA', o.id, {
          action: 'submit',
          approverIds: [users.hmA.id],
        });
        await offerAct('hmA', o.id, { action: 'approve' });
        await offerAct('hrA', o.id, { action: 'send' });
        return { a, o };
      };

      const d = await mk('off5');
      expect(
        (
          await call(m.respondApi, 'off5', {
            method: 'POST',
            query: { id: d.o.id },
            body: { accept: false },
          })
        ).status
      ).toBe(200);
      const st = await prisma.jobApplication.findFirstOrThrow({
        where: { teamId: teamA.id, id: d.a.appId },
        include: { stage: true },
      });
      expect(st.stage.kind).toBe('ACTIVE');
      expect(
        (await notificationsOf('hrA', 'offer.declined')).length
      ).toBeGreaterThanOrEqual(1);

      const ex = await mk('off6', { expiresAt: future(3600_000) });
      await prisma.offer.update({
        where: { id: ex.o.id, teamId: teamA.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await call(m.myOffersApi, 'off6')).json.data[0].status).toBe(
        'EXPIRED'
      );
      expect(
        (
          await call(m.respondApi, 'off6', {
            method: 'POST',
            query: { id: ex.o.id },
            body: { accept: true },
          })
        ).status
      ).toBe(409);
      expect(
        (
          await prisma.offer.findFirstOrThrow({
            where: { teamId: teamA.id, id: ex.o.id },
          })
        ).status
      ).toBe('EXPIRED');

      const race = await mk('off7');
      const rs = await Promise.all([
        call(m.respondApi, 'off7', {
          method: 'POST',
          query: { id: race.o.id },
          body: { accept: true },
        }),
        call(m.respondApi, 'off7', {
          method: 'POST',
          query: { id: race.o.id },
          body: { accept: true },
        }),
      ]);
      expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        await prisma.applicationActivity.count({
          where: {
            teamId: teamA.id,
            applicationId: race.a.appId,
            type: 'OFFER',
            payload: { path: ['action'], equals: 'accepted' },
          },
        })
      ).toBe(1);
    });

    it('cannot send an offer whose expiry has passed', async () => {
      const a = await makeApp('off8');
      const o = (
        await call(m.offersApi, 'hrA', {
          method: 'POST',
          query: A(),
          body: {
            applicationId: a.appId,
            fixed: 9,
            expiresAt: future(3600_000),
          },
        })
      ).json.data;
      await offerAct('hrA', o.id, {
        action: 'submit',
        approverIds: [users.hmA.id],
      });
      await offerAct('hmA', o.id, { action: 'approve' });
      await prisma.offer.update({
        where: { id: o.id, teamId: teamA.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await offerAct('hrA', o.id, { action: 'send' })).status).toBe(
        422
      );
    });
  });

  // =========================================================================
  describe('notifications API', () => {
    it("lists, counts, marks read and only touches the caller's own rows", async () => {
      await m.notifications.notify({
        userIds: [users.viewerA.id],
        type: 'job.published',
        title: 'n1',
      });
      await m.notifications.notify({
        userIds: [users.ownerB.id],
        type: 'job.published',
        title: 'other',
      });
      const l = await call(m.notificationsApi, 'viewerA');
      expect(l.status).toBe(200);
      expect(l.json.data.unread).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(l.json)).not.toContain('other');
      const otherId = (await notificationsOf('ownerB'))[0].id;
      const r = await call(m.notificationsApi, 'viewerA', {
        method: 'POST',
        body: { ids: [otherId] },
      });
      expect(r.json.data.updated).toBe(0); // cannot mark someone else's
      expect((await notificationsOf('ownerB'))[0].readAt).toBeNull();
      const all = await call(m.notificationsApi, 'viewerA', {
        method: 'POST',
        body: { all: true },
      });
      expect(all.json.data.updated).toBeGreaterThanOrEqual(1);
      expect(
        (await call(m.notificationsApi, 'viewerA', { query: { unread: '1' } }))
          .json.data.notifications
      ).toHaveLength(0);
      expect((await call(m.notificationsApi, null)).status).toBe(401);
      expect(
        (
          await call(m.notificationsApi, 'viewerA', {
            method: 'POST',
            body: {},
          })
        ).status
      ).toBe(422);
    });

    it('stores per-type preferences and validates the type', async () => {
      const get = await call(m.prefsApi, 'viewerA');
      expect(get.json.data.length).toBe(
        Object.keys(m.notifications.NOTIFICATION_TYPES).length
      );
      expect(
        (
          await call(m.prefsApi, 'viewerA', {
            method: 'PUT',
            body: { preferences: [{ type: 'nope', inApp: true, email: true }] },
          })
        ).status
      ).toBe(422);
      const put = await call(m.prefsApi, 'viewerA', {
        method: 'PUT',
        body: {
          preferences: [{ type: 'job.published', inApp: false, email: false }],
        },
      });
      expect(
        put.json.data.find((p: { type: string }) => p.type === 'job.published')
      ).toMatchObject({ inApp: false, email: false });
      const before = (await notificationsOf('viewerA')).length;
      await m.notifications.notify({
        userIds: [users.viewerA.id],
        type: 'job.published',
        title: 'muted',
      });
      expect((await notificationsOf('viewerA')).length).toBe(before);
    });

    it('does not email candidates about stage changes (in-app only)', async () => {
      const a = await makeApp('notif1');
      m.mail.sendEmail.mockClear();
      const screening = await stageId(teamA.id, 'Screening');
      const r = await call(m.stageApi, 'recA', {
        method: 'POST',
        query: A(),
        body: { applicationId: a.appId, stageId: screening },
      });
      expect(r.status).toBe(200);
      const n = await notificationsOf('notif1', 'application.stage_changed');
      expect(n).toHaveLength(1);
      expect(n[0].title).toContain('Screening');
      expect(m.mail.sendEmail).not.toHaveBeenCalledWith(
        expect.objectContaining({ to: a.email })
      );
    });

    it('tells job staff about new applications and shortlists', async () => {
      const before = (await notificationsOf('recA', 'application.created'))
        .length;
      const hooks = require('models/hooks');
      const a = await makeApp('notif2');
      await hooks.onApplicationCreated({
        teamId: teamA.id,
        applicationId: a.appId,
        jobId,
        jobTitle: 'Platform Engineer',
        teamSlug: slugA,
        candidateName: 'notif2',
      });
      expect(
        (await notificationsOf('recA', 'application.created')).length
      ).toBe(before + 1);
      expect(
        (await notificationsOf('hmA', 'application.created')).length
      ).toBeGreaterThanOrEqual(1);
      expect((await notificationsOf('ivA', 'application.created')).length).toBe(
        0
      ); // interviewers are not told
      const sl = await stageId(teamA.id, 'AI Shortlisted');
      await call(m.stageApi, 'hrA', {
        method: 'POST',
        query: A(),
        body: { applicationId: a.appId, stageId: sl },
      });
      expect(
        (await notificationsOf('recA', 'application.shortlisted')).length
      ).toBe(1);
    });

    it('notifies people assigned to a job', async () => {
      const r = await call(m.assignApi, 'ownerA', {
        method: 'PUT',
        query: A({ jobId }),
        body: {
          assignments: [
            { userId: users.recA.id, kind: 'RECRUITER' },
            { userId: users.hmA.id, kind: 'HIRING_MANAGER' },
            { userId: users.ivA.id, kind: 'INTERVIEWER' },
            { userId: users.rec2A.id, kind: 'RECRUITER' },
          ],
        },
      });
      expect(r.status).toBe(200);
      expect(
        (await notificationsOf('rec2A', 'recruiter.assigned')).length
      ).toBe(1);
      // recA was already assigned: no new notification (only the initial one)
      expect((await notificationsOf('recA', 'recruiter.assigned')).length).toBe(
        1
      );
      await call(m.assignApi, 'ownerA', {
        method: 'PUT',
        query: A({ jobId }),
        body: {
          assignments: [
            { userId: users.recA.id, kind: 'RECRUITER' },
            { userId: users.hmA.id, kind: 'HIRING_MANAGER' },
            { userId: users.ivA.id, kind: 'INTERVIEWER' },
          ],
        },
      });
    });
  });

  // =========================================================================
  describe('pipeline settings (custom stages)', () => {
    it('is limited to automation.manage within the portal', async () => {
      expect((await call(m.stagesApi, 'recA', { query: A() })).status).toBe(
        403
      );
      expect((await call(m.stagesApi, 'viewerA', { query: A() })).status).toBe(
        403
      );
      expect((await call(m.stagesApi, 'ownerB', { query: A() })).status).toBe(
        403
      );
      const r = await call(m.stagesApi, 'hrA', { query: A() });
      expect(r.status).toBe(200);
      expect(r.json.data.stages).toHaveLength(13);
      expect(r.json.data.custom).toBe(false);
    });

    it('creates, renames and reorders stages; terminal stages stay last', async () => {
      const list = (await call(m.stagesApi, 'hrA', { query: A() })).json.data
        .stages as { id: string; name: string; kind: string }[];
      const screening = list.find((s) => s.name === 'Screening')!;
      const c = await call(m.stagesApi, 'hrA', {
        method: 'POST',
        query: A(),
        body: { name: 'Culture chat', afterStageId: screening.id },
      });
      expect(c.status).toBe(201);
      expect(
        (
          await call(m.stagesApi, 'hrA', {
            method: 'POST',
            query: A(),
            body: { name: 'culture CHAT' },
          })
        ).status
      ).toBe(409);
      expect(
        (
          await call(m.stagesApi, 'hrA', {
            method: 'POST',
            query: A(),
            body: { name: 'x' },
          })
        ).status
      ).toBe(422);

      let after = (await call(m.stagesApi, 'hrA', { query: A() })).json.data
        .stages as { id: string; name: string; kind: string }[];
      expect(after).toHaveLength(14);
      expect(after.map((s) => s.name).indexOf('Culture chat')).toBe(
        after.map((s) => s.name).indexOf('Screening') + 1
      );
      expect(after.slice(-3).map((s) => s.kind)).toEqual([
        'HIRED',
        'REJECTED',
        'WITHDRAWN',
      ]);

      const ren = await call(m.stageOneApi, 'hrA', {
        method: 'PUT',
        query: A({ stageId: c.json.data.id }),
        body: { name: 'Values chat' },
      });
      expect(ren.json.data.name).toBe('Values chat');
      expect(
        (
          await call(m.stageOneApi, 'hrA', {
            method: 'PUT',
            query: A({ stageId: c.json.data.id }),
            body: { name: 'applied' },
          })
        ).status
      ).toBe(409);

      const active = after
        .filter((s) => s.kind === 'ACTIVE')
        .map((s) => s.id)
        .reverse();
      expect(
        (
          await call(m.reorderApi, 'hrA', {
            method: 'PUT',
            query: A(),
            body: { orderedIds: active.slice(1) },
          })
        ).status
      ).toBe(422); // missing one
      expect(
        (
          await call(m.reorderApi, 'hrA', {
            method: 'PUT',
            query: A(),
            body: { orderedIds: [...active.slice(1), active[1]] },
          })
        ).status
      ).toBe(422);
      const re = await call(m.reorderApi, 'hrA', {
        method: 'PUT',
        query: A(),
        body: { orderedIds: active },
      });
      expect(re.status).toBe(200);
      after = (await call(m.stagesApi, 'hrA', { query: A() })).json.data.stages;
      expect(after.slice(-3).map((s) => s.kind)).toEqual([
        'HIRED',
        'REJECTED',
        'WITHDRAWN',
      ]);
      expect(after[0].name).toBe('Offer');
      // restore the order for later tests
      await call(m.reorderApi, 'hrA', {
        method: 'PUT',
        query: A(),
        body: { orderedIds: [...active].reverse() },
      });
      // another portal's stage ids are rejected
      const foreign = (await call(m.stagesApi, 'ownerB', { query: q(slugB) }))
        .json.data.stages[0].id;
      expect(
        (
          await call(m.stageOneApi, 'ownerB', {
            method: 'PUT',
            query: A({ stageId: c.json.data.id }),
            body: { name: 'hacked' },
          })
        ).status
      ).toBe(403);
      expect(
        (
          await call(m.stageOneApi, 'hrA', {
            method: 'PUT',
            query: A({ stageId: foreign }),
            body: { name: 'hacked' },
          })
        ).status
      ).toBe(404);
      expect(
        (
          await call(m.stageOneApi, 'hrA', {
            method: 'DELETE',
            query: A({ stageId: foreign }),
          })
        ).status
      ).toBe(404);
    });

    it('protects stages that are in use, terminal or referenced by rules', async () => {
      const list = (await call(m.stagesApi, 'hrA', { query: A() })).json.data
        .stages as { id: string; name: string; kind: string }[];
      const hired = list.find((s) => s.kind === 'HIRED')!;
      expect(
        (
          await call(m.stageOneApi, 'hrA', {
            method: 'DELETE',
            query: A({ stageId: hired.id }),
          })
        ).status
      ).toBe(409);
      const applied = list.find((s) => s.name === 'Applied')!;
      expect(
        (
          await call(m.stageOneApi, 'hrA', {
            method: 'DELETE',
            query: A({ stageId: applied.id }),
          })
        ).status
      ).toBe(409); // has applications

      const extra = (
        await call(m.stagesApi, 'hrA', {
          method: 'POST',
          query: A(),
          body: { name: 'Temp stage' },
        })
      ).json.data;
      const rule = await call(m.automationApi, 'hrA', {
        method: 'POST',
        query: A(),
        body: {
          name: 'On temp',
          trigger: { type: 'STAGE_ENTERED', stageId: extra.id },
          action: { type: 'ADD_TAG', tag: 'temp' },
        },
      });
      expect(rule.status).toBe(201);
      expect(
        (
          await call(m.stageOneApi, 'hrA', {
            method: 'DELETE',
            query: A({ stageId: extra.id }),
          })
        ).status
      ).toBe(409); // used by a rule
      await call(m.ruleApi, 'hrA', {
        method: 'DELETE',
        query: A({ ruleId: rule.json.data.id }),
      });
      expect(
        (
          await call(m.stageOneApi, 'hrA', {
            method: 'DELETE',
            query: A({ stageId: extra.id }),
          })
        ).status
      ).toBe(200);
      expect(
        (await call(m.stagesApi, 'hrA', { query: A() })).json.data.stages
      ).toHaveLength(14); // Values chat remains
    });

    it('lets a job without applications have its own pipeline, which applications then use', async () => {
      const job = await newJob('ownerA', slugA, {
        title: 'Custom Pipeline Role',
      });
      await publish('ownerA', slugA, job.id);
      const cfg = () =>
        call(m.jobPipelineCfgApi, 'hrA', {
          method: 'POST',
          query: A({ jobId: job.id }),
        });
      expect(
        (
          await call(m.jobPipelineCfgApi, 'recA', {
            method: 'POST',
            query: A({ jobId: job.id }),
          })
        ).status
      ).toBe(403);
      const c = await cfg();
      expect(c.status).toBe(201);
      expect(c.json.data).toHaveLength(14);
      expect((await cfg()).status).toBe(409);
      const own = (
        await call(m.stagesApi, 'hrA', { query: A({ jobId: job.id }) })
      ).json.data;
      expect(own.custom).toBe(true);
      await call(m.stagesApi, 'hrA', {
        method: 'POST',
        query: A(),
        body: { name: 'Take-home task', jobId: job.id },
      });
      expect(
        (
          await call(m.stagesApi, 'hrA', { query: A({ jobId: job.id }) })
        ).json.data.stages.map((s: { name: string }) => s.name)
      ).toContain('Take-home task');
      // portal pipeline untouched
      expect(
        (await call(m.stagesApi, 'hrA', { query: A() })).json.data.stages.map(
          (s: { name: string }) => s.name
        )
      ).not.toContain('Take-home task');

      // the board and moves use the job's own stages
      const board = await call(m.pipelineApi, 'hrA', {
        query: A({ jobId: job.id }),
      });
      const ownStage = board.json.data.stages.find(
        (s: { name: string }) => s.name === 'Take-home task'
      );
      expect(ownStage).toBeTruthy();
      const own1 = await prisma.pipelineStage.findFirstOrThrow({
        where: { teamId: teamA.id, jobId: job.id, name: 'Applied' },
      });
      const tc = await prisma.tenantCandidate.create({
        data: {
          teamId: teamA.id,
          name: 'cp',
          email: `cp-${run}@x.test`,
          source: 'portal',
        },
      });
      const ap = await prisma.jobApplication.create({
        data: {
          teamId: teamA.id,
          jobId: job.id,
          tenantCandidateId: tc.id,
          stageId: own1.id,
          answers: [],
        },
      });
      expect(
        (
          await call(m.stageApi, 'hrA', {
            method: 'POST',
            query: A(),
            body: { applicationId: ap.id, stageId: ownStage.id },
          })
        ).status
      ).toBe(200);
      const portalStage = await stageId(teamA.id, 'Offer');
      expect(
        (
          await call(m.stageApi, 'hrA', {
            method: 'POST',
            query: A(),
            body: { applicationId: ap.id, stageId: portalStage },
          })
        ).status
      ).toBe(404); // not this job's pipeline

      expect(
        (
          await call(m.jobPipelineCfgApi, 'hrA', {
            method: 'DELETE',
            query: A({ jobId: job.id }),
          })
        ).status
      ).toBe(409); // now has applications
      const empty = await newJob('ownerA', slugA, {
        title: 'Reset Pipeline Role',
      });
      await call(m.jobPipelineCfgApi, 'hrA', {
        method: 'POST',
        query: A({ jobId: empty.id }),
      });
      expect(
        (
          await call(m.jobPipelineCfgApi, 'hrA', {
            method: 'DELETE',
            query: A({ jobId: empty.id }),
          })
        ).status
      ).toBe(200);
      expect(
        (await call(m.stagesApi, 'hrA', { query: A({ jobId: empty.id }) })).json
          .data.custom
      ).toBe(false);
      expect(
        (
          await call(m.jobPipelineCfgApi, 'ownerB', {
            method: 'POST',
            query: q(slugB, { jobId: job.id }),
          })
        ).status
      ).toBe(404);
    });
  });

  // =========================================================================
  describe('automation rules', () => {
    const rule = (
      as: string,
      body: unknown,
      method = 'POST',
      ruleId?: string
    ) =>
      call(ruleId ? m.ruleApi : m.automationApi, as, {
        method,
        query: A(ruleId ? { ruleId } : {}),
        body,
      });

    it('validates rules and refuses unsafe ones', async () => {
      const ok = {
        name: 'Welcome',
        trigger: { type: 'APPLICATION_CREATED' },
        action: {
          type: 'CREATE_MESSAGE_DRAFT',
          kind: 'STATUS_UPDATE',
          subject: 'Thanks',
          body: 'Hi {{candidate_name}}',
        },
      };
      expect((await rule('recA', ok)).status).toBe(403);
      expect((await rule('viewerA', ok)).status).toBe(403);
      expect((await rule('ownerB', ok)).status).toBe(403);
      expect(
        (await rule('hrA', { ...ok, requiresApproval: false })).status
      ).toBe(422); // candidate messages always need approval
      // there is no action that moves or rejects candidates
      expect(
        (
          await rule('hrA', {
            ...ok,
            action: { type: 'MOVE_STAGE', stageId: 'x' },
          })
        ).status
      ).toBe(422);
      expect(
        (await rule('hrA', { ...ok, action: { type: 'REJECT' } })).status
      ).toBe(422);
      expect(
        (
          await rule('hrA', {
            ...ok,
            action: { type: 'SEND_EMAIL', to: 'a@b.c' },
          })
        ).status
      ).toBe(422);
      expect(
        (
          await rule('hrA', {
            ...ok,
            trigger: { type: 'STAGE_ENTERED', stageId: 'nope' },
          })
        ).status
      ).toBe(422);
      const foreign = (await call(m.stagesApi, 'ownerB', { query: q(slugB) }))
        .json.data.stages[0].id;
      expect(
        (
          await rule('hrA', {
            ...ok,
            trigger: { type: 'STAGE_ENTERED', stageId: foreign },
          })
        ).status
      ).toBe(422);
      expect(
        (
          await rule('hrA', {
            ...ok,
            trigger: { type: 'APPLICATION_CREATED', jobId: 'nope' },
          })
        ).status
      ).toBe(422);
      expect(
        (
          await rule('hrA', {
            ...ok,
            action: {
              type: 'NOTIFY_USERS',
              userIds: [users.ownerB.id],
              title: 'x',
            },
          })
        ).status
      ).toBe(422);
      expect((await rule('hrA', { ...ok, name: 'x' })).status).toBe(422);
    });

    it('APPLICATION_CREATED creates an approval-pending draft with variables filled in', async () => {
      const created = await rule('hrA', {
        name: 'Acknowledge applications',
        trigger: { type: 'APPLICATION_CREATED', jobId },
        action: {
          type: 'CREATE_MESSAGE_DRAFT',
          kind: 'STATUS_UPDATE',
          subject: 'Thanks for applying to {{job_title}}',
          body: 'Hi {{candidate_name}}, {{company}} received your application.',
        },
      });
      expect(created.status).toBe(201);
      expect(created.json.data.requiresApproval).toBe(true);
      const a = await makeApp('auto1');
      m.mail.sendEmail.mockClear();
      const hooks = require('models/hooks');
      await hooks.onApplicationCreated({
        teamId: teamA.id,
        applicationId: a.appId,
        jobId,
        jobTitle: 'Platform Engineer',
        teamSlug: slugA,
        candidateName: 'auto1',
      });
      const d = await prisma.messageDraft.findMany({
        where: {
          teamId: teamA.id,
          applicationId: a.appId,
          automationRuleId: created.json.data.id,
        },
      });
      expect(d).toHaveLength(1);
      expect(d[0]).toMatchObject({
        status: 'DRAFT',
        kind: 'STATUS_UPDATE',
        subject: 'Thanks for applying to Platform Engineer',
      });
      expect(d[0].body).toContain('Hi auto1, Acme P3 received');
      expect(m.mail.sendEmail).not.toHaveBeenCalledWith(
        expect.objectContaining({ to: a.email })
      ); // not auto-sent
      const note = await prisma.applicationActivity.findMany({
        where: { teamId: teamA.id, applicationId: a.appId, type: 'NOTE' },
      });
      expect(note[0].actorUserId).toBeNull();
      expect(note[0].payload).toMatchObject({
        automation: 'Acknowledge applications',
      });
      // rule scoped to a job does not fire for another job
      const other = await newJob('ownerA', slugA, { title: 'Other Job Auto' });
      const b = await makeApp('auto2', { job: other.id });
      await hooks.onApplicationCreated({
        teamId: teamA.id,
        applicationId: b.appId,
        jobId: other.id,
        jobTitle: 'x',
        teamSlug: slugA,
        candidateName: 'auto2',
      });
      expect(
        await prisma.messageDraft.count({
          where: { teamId: teamA.id, applicationId: b.appId },
        })
      ).toBe(0);
    });

    it('STAGE_ENTERED rules: tag, notify and draft; disabled rules do nothing; failures do not break the move', async () => {
      const tech = await stageId(teamA.id, 'Technical Interview');
      const r1 = await rule('hrA', {
        name: 'Tag tech',
        trigger: { type: 'STAGE_ENTERED', stageId: tech },
        action: { type: 'ADD_TAG', tag: 'in-tech' },
      });
      const r2 = await rule('hrA', {
        name: 'Ping HM',
        trigger: { type: 'STAGE_ENTERED', stageId: tech },
        action: {
          type: 'NOTIFY_USERS',
          userIds: [users.hmA.id],
          title: '{{candidate_name}} reached {{stage}}',
        },
      });
      const r3 = await rule('hrA', {
        name: 'Off rule',
        enabled: false,
        trigger: { type: 'STAGE_ENTERED', stageId: tech },
        action: {
          type: 'CREATE_MESSAGE_DRAFT',
          kind: 'CUSTOM',
          subject: 's',
          body: 'b',
        },
      });
      expect([r1.status, r2.status, r3.status]).toEqual([201, 201, 201]);

      const a = await makeApp('auto3');
      const hmBefore = (await notificationsOf('hmA', 'message.draft_ready'))
        .length;
      const mv = await call(m.stageApi, 'recA', {
        method: 'POST',
        query: A(),
        body: { applicationId: a.appId, stageId: tech },
      });
      expect(mv.status).toBe(200);
      const links = await prisma.candidateTagLink.findMany({
        where: { teamId: teamA.id, tenantCandidateId: a.candidateId },
        include: { tag: true },
      });
      expect(links.map((l) => l.tag.name)).toEqual(['in-tech']);
      const pings = await notificationsOf('hmA', 'message.draft_ready');
      expect(pings.length).toBe(hmBefore + 1);
      expect(pings[pings.length - 1].title || pings[0].title).toContain(
        'reached Technical Interview'
      );
      expect(
        await prisma.messageDraft.count({
          where: { teamId: teamA.id, applicationId: a.appId },
        })
      ).toBe(0); // disabled

      // a broken rule is isolated: the stage change still succeeds
      await prisma.automationRule.create({
        data: {
          teamId: teamA.id,
          name: 'Broken',
          trigger: { type: 'STAGE_ENTERED', stageId: tech },
          action: { type: 'EXPLODE' },
        },
      });
      const b = await makeApp('auto4');
      expect(
        (
          await call(m.stageApi, 'recA', {
            method: 'POST',
            query: A(),
            body: { applicationId: b.appId, stageId: tech },
          })
        ).status
      ).toBe(200);
      // automation never changes stages: the application is exactly where the human put it
      expect(
        (
          await prisma.jobApplication.findFirstOrThrow({
            where: { teamId: teamA.id, id: b.appId },
          })
        ).stageId
      ).toBe(tech);
    });

    it('lists, updates and deletes rules; rules of other portals are untouchable', async () => {
      const list = await call(m.automationApi, 'hrA', { query: A() });
      expect(list.json.data.length).toBeGreaterThanOrEqual(4);
      const target = list.json.data.find(
        (r: { name: string }) => r.name === 'Off rule'
      );
      const upd = await rule(
        'hrA',
        {
          name: 'Off rule',
          trigger: target.trigger,
          action: target.action,
          enabled: true,
        },
        'PUT',
        target.id
      );
      expect(upd.json.data.enabled).toBe(true);
      expect(
        (
          await call(m.ruleApi, 'ownerB', {
            method: 'PUT',
            query: q(slugB, { ruleId: target.id }),
            body: {
              name: 'hacked',
              trigger: target.trigger,
              action: target.action,
            },
          })
        ).status
      ).toBe(422); // trigger refers to A's stage
      expect(
        (
          await call(m.ruleApi, 'ownerB', {
            method: 'DELETE',
            query: q(slugB, { ruleId: target.id }),
          })
        ).status
      ).toBe(404);
      expect(
        (
          await call(m.ruleApi, 'recA', {
            method: 'DELETE',
            query: A({ ruleId: target.id }),
          })
        ).status
      ).toBe(403);
      expect(
        (
          await call(m.ruleApi, 'hrA', {
            method: 'DELETE',
            query: A({ ruleId: target.id }),
          })
        ).status
      ).toBe(200);
      expect(
        (
          await call(m.ruleApi, 'hrA', {
            method: 'DELETE',
            query: A({ ruleId: target.id }),
          })
        ).status
      ).toBe(404);
    });
  });

  // =========================================================================
  describe('analytics', () => {
    let ajob = '';
    const range = () => ({
      from: new Date(Date.now() - 30 * 86400_000).toISOString(),
      to: new Date(Date.now() + 3600_000).toISOString(),
    });

    beforeAll(async () => {
      const j = await newJob('ownerA', slugA, { title: 'Analytics Role' });
      ajob = j.id;
      await publish('ownerA', slugA, ajob);
      // 5 applications: 1 hired, 1 rejected, 1 withdrawn, 2 active (one reached Screening)
      const mk = async (key: string, final?: string) => {
        const a = await makeApp(key, {
          job: ajob,
          createdAt: new Date(Date.now() - 5 * 86400_000),
        });
        if (final) {
          const target = await stageId(teamA.id, final);
          const prev = await prisma.jobApplication.findFirstOrThrow({
            where: { teamId: teamA.id, id: a.appId },
          });
          await prisma.jobApplication.update({
            where: { id: a.appId, teamId: teamA.id },
            data: { stageId: target },
          });
          await prisma.applicationActivity.create({
            data: {
              teamId: teamA.id,
              applicationId: a.appId,
              type: 'STAGE_CHANGED',
              fromStageId: prev.stageId,
              toStageId: target,
              payload: { toName: final },
            },
          });
        }
        return a;
      };
      await mk('an1', 'Hired');
      await mk('an2', 'Rejected');
      await mk('an3', 'Withdrawn');
      await mk('an4', 'Screening');
      await mk('an5');
      // an old application outside the range
      await makeApp('an6', {
        job: ajob,
        createdAt: new Date(Date.now() - 90 * 86400_000),
      });
    });

    it('reports KPIs, funnel, sources and top jobs for a range and a job', async () => {
      const r = await call(m.analyticsApi, 'hrA', {
        query: A({ ...range(), jobId: ajob }),
      });
      expect(r.status).toBe(200);
      const k = r.json.data.kpis;
      expect(k).toMatchObject({
        applications: 5,
        hires: 1,
        rejected: 1,
        withdrawn: 1,
        inProgress: 2,
        openJobs: 1,
      });
      expect(k.avgTimeToHireDays).toBeGreaterThan(4.9); // applied 5 days ago, hired now
      expect(k.avgTimeToHireDays).toBeLessThan(5.1);
      const funnel = Object.fromEntries(
        r.json.data.funnel.map((f: { stage: string; count: number }) => [
          f.stage,
          f.count,
        ])
      );
      expect(funnel.Applied).toBe(5);
      expect(funnel.Screening).toBe(1);
      expect(funnel.Hired).toBe(1);
      expect(r.json.data.sources).toEqual([{ source: 'portal', count: 5 }]);
      expect(r.json.data.topJobs[0]).toMatchObject({
        id: ajob,
        applications: 5,
      });
      // wider range includes the old application
      const wide = await call(m.analyticsApi, 'hrA', {
        query: A({
          from: new Date(Date.now() - 120 * 86400_000).toISOString(),
          to: range().to,
          jobId: ajob,
        }),
      });
      expect(wide.json.data.kpis.applications).toBe(6);
    });

    it('is permission-gated and tenant-scoped', async () => {
      for (const who of ['recA', 'hmA', 'ivA']) {
        expect(
          (await call(m.analyticsApi, who, { query: A(range()) })).status
        ).toBe(403);
      }
      expect(
        (await call(m.analyticsApi, 'viewerA', { query: A(range()) })).status
      ).toBe(200);
      expect(
        (await call(m.analyticsApi, 'ownerB', { query: A(range()) })).status
      ).toBe(403);
      const b = await call(m.analyticsApi, 'ownerB', {
        query: q(slugB, { ...range(), jobId: ajob }),
      });
      expect(b.json.data.kpis.applications).toBe(0); // A's job id yields nothing for B
      expect(
        (await call(m.analyticsApi, 'hrA', { query: A({ from: 'yesterday' }) }))
          .status
      ).toBe(422);
    });

    it('exports the applications report only with candidates.export, safely and audited', async () => {
      m.retraced.sendAudit.mockClear();
      const r = await call(m.analyticsExportApi, 'hrA', {
        query: A({ ...range(), jobId: ajob }),
      });
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('text/csv');
      const rows = m.csv.parseCsv(r.text);
      expect(rows[0]).toEqual([
        'job',
        'candidate',
        'email',
        'stage',
        'outcome',
        'source',
        'applied_at',
      ]);
      expect(rows).toHaveLength(6);
      expect(rows.find((x) => x[1] === 'an1')![4]).toBe('HIRED');
      expect(m.retraced.sendAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'applications.export' })
      );
      expect(
        (await call(m.analyticsExportApi, 'viewerA', { query: A(range()) }))
          .status
      ).toBe(403); // analytics.read but no export
      expect(
        (await call(m.analyticsExportApi, 'recA', { query: A(range()) })).status
      ).toBe(403);
      expect(
        (await call(m.analyticsExportApi, 'ownerB', { query: A(range()) }))
          .status
      ).toBe(403);
    });
  });

  // =========================================================================
  describe('background tasks (ticker) and the worker endpoint', () => {
    it('publishes due scheduled jobs and closes expired ones exactly once', async () => {
      const sched = await newJob('recA', slugA, { title: 'Ticker Scheduled' });
      await call(m.actionsApi, 'recA', {
        method: 'POST',
        query: A({ jobId: sched.id }),
        body: { action: 'schedule', publishAt: future(3600_000) },
      });
      await prisma.job.update({
        where: { id: sched.id, teamId: teamA.id },
        data: { publishAt: new Date(Date.now() - 1000) },
      });
      const exp = await newJob('recA', slugA, { title: 'Ticker Expiring' });
      await publish('recA', slugA, exp.id);
      await prisma.job.update({
        where: { id: exp.id, teamId: teamA.id },
        data: { closesAt: new Date(Date.now() - 1000) },
      });

      m.svix.sendEvent.mockClear();
      const r1 = await m.ticker.runDueTasks();
      expect(r1.jobsPublished).toBeGreaterThanOrEqual(1);
      expect(r1.jobsClosed).toBeGreaterThanOrEqual(1);
      expect(
        (
          await prisma.job.findFirstOrThrow({
            where: { teamId: teamA.id, id: sched.id },
          })
        ).status
      ).toBe('PUBLISHED');
      expect(
        (
          await prisma.job.findFirstOrThrow({
            where: { teamId: teamA.id, id: exp.id },
          })
        ).status
      ).toBe('CLOSED');
      expect(
        (await notificationsOf('recA', 'job.published')).some((n) =>
          n.title.includes('Ticker Scheduled')
        )
      ).toBe(true);
      expect(
        (await notificationsOf('recA', 'job.expired')).some((n) =>
          n.title.includes('Ticker Expiring')
        )
      ).toBe(true);
      expect(m.svix.sendEvent).toHaveBeenCalledWith(
        teamA.id,
        'job.published',
        expect.objectContaining({ id: sched.id })
      );
      const r2 = await m.ticker.runDueTasks();
      expect(r2.jobsPublished).toBe(0); // idempotent
      expect(r2.jobsClosed).toBe(0);
    });

    it('sends 24h and 1h interview reminders once, skipping windows that never applied', async () => {
      const a = await makeApp('rem1');
      const mkInterview = (startsInMs: number, createdAgoMs: number) =>
        prisma.interview.create({
          data: {
            teamId: teamA.id,
            applicationId: a.appId,
            startsAt: new Date(Date.now() + startsInMs),
            createdAt: new Date(Date.now() - createdAgoMs),
            participants: {
              create: [{ teamId: teamA.id, userId: users.ivA.id }],
            },
          },
        });
      const i24 = await mkInterview(23 * 3600_000, 3 * 3600_000); // booked earlier, 24h window is open
      const i1 = await mkInterview(50 * 60_000, 2 * 3600_000); // within the last hour: only the 1h reminder
      const fresh = await mkInterview(30 * 60_000, 1000); // booked 1s ago: no reminders at all
      const future2 = await mkInterview(30 * 3600_000, 1000); // window not open yet

      const before = (await notificationsOf('ivA', 'interview.reminder'))
        .length;
      const candBefore = (await notificationsOf('rem1', 'interview.reminder'))
        .length;
      const r = await m.ticker.runDueTasks();
      expect(r.remindersSent).toBeGreaterThanOrEqual(2);
      const kinds = async (id: string) =>
        (
          await prisma.interviewReminder.findMany({
            where: { teamId: teamA.id, interviewId: id },
          })
        )
          .map((x) => x.kind)
          .sort();
      expect(await kinds(i24.id)).toEqual(['24h']);
      expect(await kinds(i1.id)).toEqual(['1h']);
      expect(await kinds(fresh.id)).toEqual([]);
      expect(await kinds(future2.id)).toEqual([]);
      expect((await notificationsOf('ivA', 'interview.reminder')).length).toBe(
        before + 2
      );
      expect((await notificationsOf('rem1', 'interview.reminder')).length).toBe(
        candBefore + 2
      ); // candidate too

      const again = await m.ticker.runDueTasks();
      expect(again.remindersSent).toBe(0);
      // the 1h reminder for the 24h interview fires once its window opens
      await prisma.interview.update({
        where: { id: i24.id, teamId: teamA.id },
        data: { startsAt: new Date(Date.now() + 40 * 60_000) },
      });
      expect((await m.ticker.runDueTasks()).remindersSent).toBe(1);
      expect(await kinds(i24.id)).toEqual(['1h', '24h']);
      // cancelled interviews get nothing
      await prisma.interview.update({
        where: { id: fresh.id, teamId: teamA.id },
        data: {
          status: 'CANCELLED',
          createdAt: new Date(Date.now() - 3 * 3600_000),
        },
      });
      expect((await m.ticker.runDueTasks()).remindersSent).toBe(0);
    });

    it('survives concurrent ticks without duplicate reminders', async () => {
      const a = await makeApp('rem2');
      const i = await prisma.interview.create({
        data: {
          teamId: teamA.id,
          applicationId: a.appId,
          startsAt: new Date(Date.now() + 20 * 3600_000),
          createdAt: new Date(Date.now() - 6 * 3600_000),
          participants: {
            create: [{ teamId: teamA.id, userId: users.hmA.id }],
          },
        },
      });
      const before = (await notificationsOf('hmA', 'interview.reminder'))
        .length;
      await Promise.all([
        m.ticker.runDueTasks(),
        m.ticker.runDueTasks(),
        m.ticker.runDueTasks(),
      ]);
      expect(
        await prisma.interviewReminder.count({
          where: { teamId: teamA.id, interviewId: i.id },
        })
      ).toBe(1);
      expect((await notificationsOf('hmA', 'interview.reminder')).length).toBe(
        before + 1
      );
    });

    it('expires unanswered offers', async () => {
      const a = await makeApp('exp1');
      const o = await prisma.offer.create({
        data: {
          teamId: teamA.id,
          applicationId: a.appId,
          fixed: 1,
          status: 'SENT',
          sentAt: new Date(),
          expiresAt: new Date(Date.now() - 1000),
          createdById: users.hrA.id,
        },
      });
      const r = await m.ticker.runDueTasks();
      expect(r.offersExpired).toBeGreaterThanOrEqual(1);
      expect(
        (
          await prisma.offer.findFirstOrThrow({
            where: { teamId: teamA.id, id: o.id },
          })
        ).status
      ).toBe('EXPIRED');
      expect((await m.ticker.runDueTasks()).offersExpired).toBe(0);
    });

    it('the tick endpoint needs the shared secret', async () => {
      const post = (headers: Record<string, string>) =>
        call(m.tickApi, null, { method: 'POST', headers });
      expect((await post({})).status).toBe(401);
      expect((await post({ authorization: 'Bearer wrong' })).status).toBe(401);
      expect(
        (await post({ authorization: 'Bearer test-cron-secret-x' })).status
      ).toBe(401); // length differs
      const ok = await post({ authorization: 'Bearer test-cron-secret' });
      expect(ok.status).toBe(200);
      expect(Object.keys(ok.json.data).sort()).toEqual([
        'aiLogsDeleted',
        'jobsClosed',
        'jobsPublished',
        'offersExpired',
        'remindersSent',
      ]);
      expect((await call(m.tickApi, null, { method: 'GET' })).status).toBe(405);
    });
  });
});
