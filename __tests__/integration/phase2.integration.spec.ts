/**
 * @jest-environment node
 *
 * Phase 2 integration tests (jobs, public portal, candidates, apply, pipeline)
 * against a real PostgreSQL database.
 * Run with:  DATABASE_URL=postgresql://... npm run test:integration
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { createMocks, createResponse } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const enabled = process.env.INTEGRATION === '1' && !!process.env.DATABASE_URL;
const suite = enabled ? describe : describe.skip;

// Must be set before the app modules are loaded (env is read at import).
const storageDir = path.join(os.tmpdir(), `hirecraft-test-${Date.now()}`);
process.env.STORAGE_LOCAL_DIR = storageDir;
process.env.STORAGE_SIGNING_SECRET = 'test-signing-secret';
process.env.APP_URL = 'http://localhost:4002';
process.env.MAX_RESUME_BYTES = '4096';

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

/* eslint-disable @typescript-eslint/no-require-imports */
const load = () => ({
  unguarded: require('@/lib/prisma')
    .unguardedPrisma as typeof import('@/lib/prisma').unguardedPrisma,
  prisma: require('@/lib/prisma')
    .prisma as typeof import('@/lib/prisma').prisma,
  createPortal: require('models/portal').createPortal,
  jobsApi: require('pages/api/teams/[slug]/jobs/index').default,
  jobApi: require('pages/api/teams/[slug]/jobs/[jobId]/index').default,
  actionsApi: require('pages/api/teams/[slug]/jobs/[jobId]/actions').default,
  assignApi: require('pages/api/teams/[slug]/jobs/[jobId]/assignments').default,
  pipelineApi: require('pages/api/teams/[slug]/jobs/[jobId]/pipeline').default,
  appApi: require('pages/api/teams/[slug]/applications/[applicationId]/index')
    .default,
  stageApi: require('pages/api/teams/[slug]/applications/stage').default,
  resumeDlApi:
    require('pages/api/teams/[slug]/applications/[applicationId]/resume')
      .default,
  registerApi: require('pages/api/candidate/register').default,
  profileApi: require('pages/api/candidate/profile').default,
  resumesApi: require('pages/api/candidate/resumes/index').default,
  resumeApi: require('pages/api/candidate/resumes/[id]').default,
  myAppsApi: require('pages/api/candidate/applications/index').default,
  withdrawApi: require('pages/api/candidate/applications/[id]/withdraw')
    .default,
  savedApi: require('pages/api/candidate/saved-jobs').default,
  privacyApi: require('pages/api/candidate/privacy').default,
  applyApi: require('pages/api/public/portals/[portal]/jobs/[jobSlug]/apply')
    .default,
  storageApi: require('pages/api/storage/local').default,
  publicModel:
    require('models/publicPortal') as typeof import('models/publicPortal'),
  storage: require('@/lib/storage') as typeof import('@/lib/storage'),
  upload:
    require('@/lib/uploadValidation') as typeof import('@/lib/uploadValidation'),
  jobsLib: require('@/lib/jobs') as typeof import('@/lib/jobs'),
  rate: require('@/lib/rateLimit') as typeof import('@/lib/rateLimit'),
  sitemap: require('pages/p/[portal]/sitemap.xml'),
  robots: require('pages/p/[portal]/robots.txt'),
  publicPage: require('@/lib/publicPage') as typeof import('@/lib/publicPage'),
  svix: require('@/lib/svix') as { sendEvent: jest.Mock },
  retraced: require('@/lib/retraced') as { sendAudit: jest.Mock },
});

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 'a')]);
const DOCX = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.alloc(100, 'b'),
]);
const DESC =
  '<p>We are hiring an engineer to build and run our platform services.</p>';

suite('phase 2: jobs, candidates, applications (integration)', () => {
  const m = load();
  const { prisma } = m;
  const run = Date.now().toString(36);
  const users: Record<string, { id: string; email: string; name: string }> = {};
  let slugA = '';
  let slugB = '';
  let teamA: { id: string };
  let teamB: { id: string };

  const call = async (
    handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void>,
    as: string | null,
    opts: {
      method?: string;
      query?: Record<string, string>;
      body?: unknown;
      ip?: string;
    } = {}
  ) => {
    currentUser = as ? users[as] : null;
    const { req, res } = createMocks({
      method: (opts.method ?? 'GET') as never,
      query: opts.query ?? {},
      body: opts.body as never,
      headers: { 'x-forwarded-for': opts.ip ?? '10.0.0.1' },
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
      headers: res._getHeaders(),
    };
  };

  const callRaw = async (
    handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void>,
    as: string | null,
    file: Buffer,
    headers: Record<string, string>
  ) => {
    currentUser = as ? users[as] : null;
    const req = Object.assign(Readable.from([file]), {
      method: 'POST',
      query: {},
      headers: { 'content-length': String(file.length), ...headers },
    });
    const res = createResponse();
    await handler(req as never, res as never);
    const text = res._getData();
    return {
      status: res._getStatusCode(),
      json: text ? JSON.parse(text) : undefined,
    };
  };

  const q = (slug: string, extra: Record<string, string> = {}) => ({
    slug,
    ...extra,
  });

  const mkUser = async (key: string) => {
    const u = await prisma.user.create({
      data: {
        name: key,
        email: `${key}-${run}@p2-test.com`,
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

  const newJob = async (
    as: string,
    slug: string,
    extra: Record<string, unknown> = {}
  ) => {
    const r = await call(m.jobsApi, as, {
      method: 'POST',
      query: q(slug),
      body: {
        title: 'Backend Engineer',
        descriptionHtml: DESC,
        workMode: 'REMOTE',
        skills: [{ skill: 'Node.js', required: true }],
        ...extra,
      },
    });
    expect(r.status).toBe(201);
    return r.json.data as { id: string; slug: string; status: string };
  };

  const publish = async (as: string, slug: string, id: string) => {
    const r = await call(m.actionsApi, as, {
      method: 'POST',
      query: q(slug, { jobId: id }),
      body: { action: 'publish' },
    });
    expect(r.status).toBe(200);
    return r.json.data;
  };

  const stageId = async (teamId: string, name: string) =>
    (
      await prisma.pipelineStage.findFirstOrThrow({
        where: { teamId, jobId: null, name },
      })
    ).id;

  const register = async (key: string) => {
    const email = `${key}-${run}@cand-test.com`;
    const r = await call(m.registerApi, null, {
      method: 'POST',
      body: { name: key, email, password: 'S3cure-pass!' },
      ip: `10.1.${key.length}.${Math.floor(Math.random() * 250)}`,
    });
    expect(r.status).toBe(201);
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    users[key] = { id: u.id, email: u.email, name: u.name };
  };

  const uploadResume = async (
    as: string,
    file = PDF,
    mime = 'application/pdf',
    name = 'cv.pdf'
  ) =>
    callRaw(m.resumesApi, as, file, {
      'content-type': mime,
      'x-file-name': encodeURIComponent(name),
    });

  beforeAll(async () => {
    for (const k of [
      'ownerA',
      'ownerB',
      'adminA',
      'hrA',
      'recA',
      'rec2A',
      'viewerA',
      'outsider',
    ]) {
      await mkUser(k);
    }
    slugA = `p2a-${run}`;
    slugB = `p2b-${run}`;
    teamA = await m.createPortal({
      userId: users.ownerA.id,
      name: 'Acme P2',
      slug: slugA,
    });
    teamB = await m.createPortal({
      userId: users.ownerB.id,
      name: 'Beta P2',
      slug: slugB,
    });
    await addMember(slugA, 'adminA', 'admin');
    await addMember(slugA, 'hrA', 'hr_manager');
    await addMember(slugA, 'recA', 'recruiter');
    await addMember(slugA, 'rec2A', 'recruiter');
    await addMember(slugA, 'viewerA', 'viewer');
    await register('cand1');
    await register('cand2');
  });

  afterAll(async () => {
    const emails = Object.values(users).map((u) => u.email);
    await prisma.team.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
    await fs.rm(storageDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  describe('tenant guard on the new models', () => {
    it('refuses un-scoped queries and any mutation of append-only activity', async () => {
      await expect(prisma.job.findMany()).rejects.toThrow(/teamId/);
      await expect(
        prisma.jobApplication.findFirst({ where: { id: 'x' } })
      ).rejects.toThrow(/teamId/);
      await expect(prisma.pipelineStage.count()).rejects.toThrow(/teamId/);
      await expect(
        prisma.applicationActivity.updateMany({
          where: { teamId: teamA.id },
          data: { type: 'NOTE' },
        })
      ).rejects.toThrow(/append-only/);
      await expect(
        prisma.applicationActivity.deleteMany({ where: { teamId: teamA.id } })
      ).rejects.toThrow(/append-only/);
    });

    it('seeds the 13 default stages for a new portal', async () => {
      const stages = await prisma.pipelineStage.findMany({
        where: { teamId: teamA.id, jobId: null },
        orderBy: { order: 'asc' },
      });
      expect(stages).toHaveLength(13);
      expect(stages[0].name).toBe('Applied');
      expect(
        stages
          .map((s) => s.kind)
          .filter((k) => k !== 'ACTIVE')
          .sort()
      ).toEqual(['HIRED', 'REJECTED', 'WITHDRAWN']);
    });
  });

  // -------------------------------------------------------------------------
  describe('job lifecycle', () => {
    it('creates a draft with slug, nested data and the creator assigned', async () => {
      const r = await call(m.jobsApi, 'recA', {
        method: 'POST',
        query: q(slugA),
        body: {
          title: 'Senior Node Developer',
          descriptionHtml: DESC,
          locations: [{ city: 'Pune', country: 'India' }],
          skills: [
            { skill: 'Node.js', required: true },
            { skill: 'node.js', required: false },
            { skill: 'AWS', required: false },
          ],
          questions: [
            { type: 'BOOLEAN', prompt: 'Can you relocate?', required: true },
            {
              type: 'SINGLE',
              prompt: 'Notice period?',
              options: ['15', '30', '60'],
              required: false,
            },
          ],
        },
      });
      expect(r.status).toBe(201);
      const job = r.json.data;
      expect(job.status).toBe('DRAFT');
      expect(job.slug).toBe('senior-node-developer');
      expect(job.skills).toHaveLength(2); // case-insensitive de-dupe
      expect(job.questions).toHaveLength(2);
      expect(job.assignments).toEqual([
        expect.objectContaining({ userId: users.recA.id, kind: 'RECRUITER' }),
      ]);
    });

    it('generates unique slugs per portal and allows the same slug in another portal', async () => {
      const a = await newJob('ownerA', slugA, { title: 'Same Title' });
      const b = await newJob('ownerA', slugA, { title: 'Same Title' });
      const c = await newJob('ownerB', slugB, { title: 'Same Title' });
      expect(a.slug).toBe('same-title');
      expect(b.slug).toBe('same-title-2');
      expect(c.slug).toBe('same-title');
    });

    it('validates input', async () => {
      const bad = async (body: unknown) =>
        (
          await call(m.jobsApi, 'ownerA', {
            method: 'POST',
            query: q(slugA),
            body,
          })
        ).status;
      expect(await bad({ title: 'ab' })).toBe(422);
      expect(
        await bad({ title: 'Valid title', salaryMin: 10, salaryMax: 5 })
      ).toBe(422);
      expect(
        await bad({ title: 'Valid title', experienceMin: 9, experienceMax: 2 })
      ).toBe(422);
      expect(
        await bad({
          title: 'Valid title',
          questions: [
            { type: 'SINGLE', prompt: 'Pick one', options: ['only'] },
          ],
        })
      ).toBe(422);
      expect(
        await bad({ title: 'Valid title', salaryCurrency: 'RUPEES' })
      ).toBe(422);
    });

    it('sanitises the description', async () => {
      const job = await newJob('ownerA', slugA, {
        descriptionHtml: `${DESC}<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a>`,
      });
      const g = await call(m.jobApi, 'ownerA', {
        query: q(slugA, { jobId: job.id }),
      });
      expect(g.json.data.descriptionHtml).not.toMatch(
        /script|onerror|javascript:|<img/i
      );
      expect(g.json.data.descriptionHtml).toContain('We are hiring');
    });

    it('cannot publish an incomplete job; publishes a complete one and emits events', async () => {
      const empty = await newJob('ownerA', slugA, {
        title: 'Empty Job',
        descriptionHtml: '',
        workMode: 'ONSITE',
      });
      const fail = await call(m.actionsApi, 'ownerA', {
        method: 'POST',
        query: q(slugA, { jobId: empty.id }),
        body: { action: 'publish' },
      });
      expect(fail.status).toBe(422);

      const noLoc = await newJob('ownerA', slugA, {
        title: 'Onsite No Location',
        workMode: 'ONSITE',
      });
      const fail2 = await call(m.actionsApi, 'ownerA', {
        method: 'POST',
        query: q(slugA, { jobId: noLoc.id }),
        body: { action: 'publish' },
      });
      expect(fail2.status).toBe(422);
      expect(fail2.json.error.message).toMatch(/location/i);

      m.svix.sendEvent.mockClear();
      m.retraced.sendAudit.mockClear();
      const ok = await newJob('ownerA', slugA, { title: 'Publishable Job' });
      const pub = await publish('ownerA', slugA, ok.id);
      expect(pub.status).toBe('PUBLISHED');
      expect(pub.publishedAt).toBeTruthy();
      expect(m.svix.sendEvent).toHaveBeenCalledWith(
        teamA.id,
        'job.published',
        expect.objectContaining({ id: ok.id })
      );
      expect(m.retraced.sendAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'job.publish' })
      );
    });

    it('enforces state transitions', async () => {
      const job = await newJob('ownerA', slugA, { title: 'Transitions Job' });
      const act = (action: string, extra = {}) =>
        call(m.actionsApi, 'ownerA', {
          method: 'POST',
          query: q(slugA, { jobId: job.id }),
          body: { action, ...extra },
        });

      expect((await act('close')).status).toBe(409); // draft can't be closed
      expect((await act('reopen')).status).toBe(409);
      expect(
        (
          await act('schedule', {
            publishAt: new Date(Date.now() - 1000).toISOString(),
          })
        ).status
      ).toBe(422);
      expect((await act('publish')).status).toBe(200);
      expect((await act('publish')).status).toBe(409); // already published
      expect((await act('close')).json.data.status).toBe('CLOSED');
      expect((await act('reopen')).json.data.status).toBe('PUBLISHED');
      expect((await act('archive')).json.data.status).toBe('ARCHIVED');
      expect((await act('archive')).status).toBe(409);
      const edit = await call(m.jobApi, 'ownerA', {
        method: 'PUT',
        query: q(slugA, { jobId: job.id }),
        body: { title: 'Cannot edit archived' },
      });
      expect(edit.status).toBe(409);
    });

    it('scheduled jobs go live when their time comes (lazily evaluated)', async () => {
      const job = await newJob('ownerA', slugA, {
        title: 'Scheduled Role Zeta',
      });
      const future = new Date(Date.now() + 3600_000).toISOString();
      const s = await call(m.actionsApi, 'ownerA', {
        method: 'POST',
        query: q(slugA, { jobId: job.id }),
        body: { action: 'schedule', publishAt: future },
      });
      expect(s.json.data.status).toBe('SCHEDULED');

      const before = await m.publicModel.listPublicJobs(teamA.id, {
        q: 'Zeta',
      });
      expect(before.total).toBe(0);

      await prisma.job.update({
        where: { id: job.id, teamId: teamA.id },
        data: { publishAt: new Date(Date.now() - 1000) },
      });
      const after = await m.publicModel.listPublicJobs(teamA.id, { q: 'Zeta' });
      expect(after.total).toBe(1);
      expect(
        m.jobsLib.effectiveJobStatus({
          status: 'SCHEDULED',
          publishAt: new Date(Date.now() - 1),
          closesAt: null,
        })
      ).toBe('PUBLISHED');
    });

    it('closing date in the past hides the job', async () => {
      const job = await newJob('ownerA', slugA, {
        title: 'Expiring Role Omega',
      });
      await publish('ownerA', slugA, job.id);
      expect(
        (await m.publicModel.listPublicJobs(teamA.id, { q: 'Omega' })).total
      ).toBe(1);
      await prisma.job.update({
        where: { id: job.id, teamId: teamA.id },
        data: { closesAt: new Date(Date.now() - 1000) },
      });
      expect(
        (await m.publicModel.listPublicJobs(teamA.id, { q: 'Omega' })).total
      ).toBe(0);
      expect(await m.publicModel.getPublicJob(teamA.id, job.slug)).toBeNull();
    });

    it('duplicates a job as a draft copy', async () => {
      const src = await call(m.jobsApi, 'ownerA', {
        method: 'POST',
        query: q(slugA),
        body: {
          title: 'Original Role',
          descriptionHtml: DESC,
          workMode: 'REMOTE',
          skills: [{ skill: 'Go', required: true }],
          questions: [{ type: 'TEXT', prompt: 'Why us?', required: true }],
        },
      });
      const d = await call(m.actionsApi, 'recA', {
        method: 'POST',
        query: q(slugA, { jobId: src.json.data.id }),
        body: { action: 'duplicate' },
      });
      // recA is not assigned to ownerA's job -> not visible -> 404
      expect(d.status).toBe(404);
      const d2 = await call(m.actionsApi, 'ownerA', {
        method: 'POST',
        query: q(slugA, { jobId: src.json.data.id }),
        body: { action: 'duplicate' },
      });
      expect(d2.status).toBe(200);
      expect(d2.json.data.title).toBe('Original Role (Copy)');
      expect(d2.json.data.status).toBe('DRAFT');
      expect(d2.json.data.skills).toEqual([{ skill: 'Go', required: true }]);
      expect(d2.json.data.questions[0].prompt).toBe('Why us?');
    });

    it('soft-deletes (and archives) a job', async () => {
      const job = await newJob('ownerA', slugA, { title: 'Delete Me Role' });
      const del = await call(m.jobApi, 'ownerA', {
        method: 'DELETE',
        query: q(slugA, { jobId: job.id }),
      });
      expect(del.status).toBe(200);
      expect(
        (await call(m.jobApi, 'ownerA', { query: q(slugA, { jobId: job.id }) }))
          .status
      ).toBe(404);
      const row = await prisma.job.findFirstOrThrow({
        where: { id: job.id, teamId: teamA.id },
      });
      expect(row.deletedAt).not.toBeNull();
    });

    it('lists with status filter, search and cursor pagination', async () => {
      const all = await call(m.jobsApi, 'ownerA', {
        query: q(slugA, { limit: '2' }),
      });
      expect(all.json.data.jobs).toHaveLength(2);
      expect(all.json.data.nextCursor).toBeTruthy();
      const next = await call(m.jobsApi, 'ownerA', {
        query: q(slugA, { limit: '2', cursor: all.json.data.nextCursor }),
      });
      expect(next.json.data.jobs[0].id).not.toBe(all.json.data.jobs[0].id);

      const drafts = await call(m.jobsApi, 'ownerA', {
        query: q(slugA, { status: 'DRAFT', limit: '100' }),
      });
      expect(
        drafts.json.data.jobs.every(
          (j: { status: string }) => j.status === 'DRAFT'
        )
      ).toBe(true);
      const search = await call(m.jobsApi, 'ownerA', {
        query: q(slugA, { q: 'transitions' }),
      });
      expect(search.json.data.jobs).toHaveLength(1);
      expect(
        (
          await call(m.jobsApi, 'ownerA', {
            query: q(slugA, { status: 'NOPE' }),
          })
        ).status
      ).toBe(422);
    });
  });

  // -------------------------------------------------------------------------
  describe('permissions and assignment scope', () => {
    let jobId = '';

    beforeAll(async () => {
      jobId = (await newJob('ownerA', slugA, { title: 'Scoped Role' })).id;
    });

    it('viewer can read jobs but not create / update / publish / delete', async () => {
      expect(
        (await call(m.jobsApi, 'viewerA', { query: q(slugA) })).status
      ).toBe(200);
      expect(
        (
          await call(m.jobsApi, 'viewerA', {
            method: 'POST',
            query: q(slugA),
            body: { title: 'Nope nope' },
          })
        ).status
      ).toBe(403);
      expect(
        (
          await call(m.jobApi, 'viewerA', {
            method: 'PUT',
            query: q(slugA, { jobId }),
            body: { title: 'Nope nope' },
          })
        ).status
      ).toBe(403);
      expect(
        (
          await call(m.actionsApi, 'viewerA', {
            method: 'POST',
            query: q(slugA, { jobId }),
            body: { action: 'publish' },
          })
        ).status
      ).toBe(403);
      expect(
        (
          await call(m.jobApi, 'viewerA', {
            method: 'DELETE',
            query: q(slugA, { jobId }),
          })
        ).status
      ).toBe(403);
    });

    it('recruiter can publish their own job but cannot archive or delete', async () => {
      const mine = await newJob('recA', slugA, { title: 'Recruiter Own Role' });
      await publish('recA', slugA, mine.id);
      const arch = await call(m.actionsApi, 'recA', {
        method: 'POST',
        query: q(slugA, { jobId: mine.id }),
        body: { action: 'archive' },
      });
      expect(arch.status).toBe(403);
      expect(
        (
          await call(m.jobApi, 'recA', {
            method: 'DELETE',
            query: q(slugA, { jobId: mine.id }),
          })
        ).status
      ).toBe(403);
      const archAdmin = await call(m.actionsApi, 'adminA', {
        method: 'POST',
        query: q(slugA, { jobId: mine.id }),
        body: { action: 'archive' },
      });
      expect(archAdmin.status).toBe(200);
    });

    it('assignment-scoped roles only see assigned jobs (list, get, pipeline, update)', async () => {
      const list = await call(m.jobsApi, 'rec2A', {
        query: q(slugA, { limit: '100' }),
      });
      expect(list.json.data.jobs).toHaveLength(0);
      expect(
        (await call(m.jobApi, 'rec2A', { query: q(slugA, { jobId }) })).status
      ).toBe(404);
      expect(
        (await call(m.pipelineApi, 'rec2A', { query: q(slugA, { jobId }) }))
          .status
      ).toBe(404);
      expect(
        (
          await call(m.jobApi, 'rec2A', {
            method: 'PUT',
            query: q(slugA, { jobId }),
            body: { title: 'Hijacked job' },
          })
        ).status
      ).toBe(404);

      const asg = await call(m.assignApi, 'ownerA', {
        method: 'PUT',
        query: q(slugA, { jobId }),
        body: { assignments: [{ userId: users.rec2A.id, kind: 'RECRUITER' }] },
      });
      expect(asg.status).toBe(200);

      expect(
        (await call(m.jobApi, 'rec2A', { query: q(slugA, { jobId }) })).status
      ).toBe(200);
      expect(
        (await call(m.pipelineApi, 'rec2A', { query: q(slugA, { jobId }) }))
          .status
      ).toBe(200);
      const list2 = await call(m.jobsApi, 'rec2A', {
        query: q(slugA, { limit: '100' }),
      });
      expect(list2.json.data.jobs.map((j: { id: string }) => j.id)).toEqual([
        jobId,
      ]);
    });

    it('portal-wide roles (HR manager, viewer) see every job', async () => {
      const hr = await call(m.jobsApi, 'hrA', {
        query: q(slugA, { limit: '100' }),
      });
      const owner = await call(m.jobsApi, 'ownerA', {
        query: q(slugA, { limit: '100' }),
      });
      expect(hr.json.data.jobs.length).toBe(owner.json.data.jobs.length);
    });

    it('only members of THIS portal can be assigned', async () => {
      const r = await call(m.assignApi, 'ownerA', {
        method: 'PUT',
        query: q(slugA, { jobId }),
        body: { assignments: [{ userId: users.ownerB.id, kind: 'RECRUITER' }] },
      });
      expect(r.status).toBe(422);
      const list = await call(m.assignApi, 'ownerA', {
        query: q(slugA, { jobId }),
      });
      expect(list.status).toBe(200);
      expect(
        list.json.data.map((x: { userId: string }) => x.userId)
      ).not.toContain(users.ownerB.id);
    });

    it("another portal's owner cannot touch these jobs, and ids do not cross tenants", async () => {
      for (const [fn, opts] of [
        [m.jobsApi, { query: q(slugA) }],
        [m.jobApi, { query: q(slugA, { jobId }) }],
        [m.pipelineApi, { query: q(slugA, { jobId }) }],
        [
          m.jobsApi,
          { method: 'POST', query: q(slugA), body: { title: 'Cross tenant' } },
        ],
      ] as const) {
        expect((await call(fn, 'ownerB', opts)).status).toBe(403);
      }
      // A's job id through B's own slug -> 404, nothing leaks
      for (const method of ['GET', 'PUT', 'DELETE']) {
        const r = await call(m.jobApi, 'ownerB', {
          method,
          query: q(slugB, { jobId }),
          body: { title: 'Cross tenant' },
        });
        expect(r.status).toBe(404);
      }
      const act = await call(m.actionsApi, 'ownerB', {
        method: 'POST',
        query: q(slugB, { jobId }),
        body: { action: 'publish' },
      });
      expect(act.status).toBe(404);
      expect(
        (await call(m.pipelineApi, 'ownerB', { query: q(slugB, { jobId }) }))
          .status
      ).toBe(404);
      const row = await prisma.job.findFirstOrThrow({
        where: { id: jobId, teamId: teamA.id },
      });
      expect(row.title).toBe('Scoped Role');
    });
  });

  // -------------------------------------------------------------------------
  describe('public portal', () => {
    let remoteId = '';
    let punePrivateId = '';

    beforeAll(async () => {
      const slug = `pub-${run}`;
      void slug;
      const remote = await newJob('ownerB', slugB, {
        title: 'Platform Reliability Engineer',
        descriptionHtml:
          '<p>Keep Kubernetes clusters healthy and fast for every product team.</p>',
        workMode: 'REMOTE',
        employmentType: 'CONTRACT',
      });
      remoteId = remote.id;
      await publish('ownerB', slugB, remote.id);
      const pune = await newJob('ownerB', slugB, {
        title: 'Data Analyst',
        descriptionHtml:
          '<p>Analyse hiring funnel metrics and prepare weekly dashboards for leadership.</p>',
        workMode: 'ONSITE',
        locations: [{ city: 'Pune', region: 'Maharashtra', country: 'India' }],
        salaryMin: 600000,
        salaryMax: 900000,
        salaryVisible: true,
        closesAt: new Date(Date.now() + 86400_000 * 30).toISOString(),
      });
      await publish('ownerB', slugB, pune.id);
      const unlisted = await newJob('ownerB', slugB, {
        title: 'Unlisted Secret Role',
        visibility: 'UNLISTED',
      });
      await publish('ownerB', slugB, unlisted.id);
      const internal = await newJob('ownerB', slugB, {
        title: 'Internal Only Role',
        visibility: 'INTERNAL',
      });
      await publish('ownerB', slugB, internal.id);
      punePrivateId = (
        await newJob('ownerB', slugB, { title: 'Draft Not Public' })
      ).id;
      // the "Same Title" job created earlier in portal B
      const same = await prisma.job.findFirstOrThrow({
        where: { teamId: teamB.id, slug: 'same-title' },
      });
      await publish('ownerB', slugB, same.id);
    });

    it('lists only open PUBLIC jobs', async () => {
      const r = await m.publicModel.listPublicJobs(teamB.id, {});
      const titles = r.jobs.map((j) => j.title).sort();
      expect(titles).toEqual(
        ['Data Analyst', 'Platform Reliability Engineer', 'Same Title'].sort()
      );
    });

    it('searches (full text), filters by location / work mode / type', async () => {
      const fts = await m.publicModel.listPublicJobs(teamB.id, {
        q: 'kubernetes',
      });
      expect(fts.jobs.map((j) => j.title)).toEqual([
        'Platform Reliability Engineer',
      ]);
      const title = await m.publicModel.listPublicJobs(teamB.id, {
        q: 'analyst',
      });
      expect(title.total).toBe(1);
      expect(
        (
          await m.publicModel.listPublicJobs(teamB.id, {
            q: 'x\'; DROP TABLE "Job";--',
          })
        ).total
      ).toBe(0);
      expect(
        (await m.publicModel.listPublicJobs(teamB.id, { location: 'pune' }))
          .total
      ).toBe(1);
      expect(
        (await m.publicModel.listPublicJobs(teamB.id, { workMode: 'REMOTE' }))
          .total
      ).toBe(2); // Platform Reliability Engineer + Same Title
      expect(
        (
          await m.publicModel.listPublicJobs(teamB.id, {
            employmentType: 'CONTRACT',
          })
        ).total
      ).toBe(1);
      expect(
        (
          await m.publicModel.listPublicJobs(teamB.id, {
            employmentType: 'CONTRACT',
            workMode: 'ONSITE',
          })
        ).total
      ).toBe(0);
    });

    it('paginates', async () => {
      const p1 = await m.publicModel.listPublicJobs(teamB.id, {
        pageSize: 2,
        page: 1,
      });
      const p2 = await m.publicModel.listPublicJobs(teamB.id, {
        pageSize: 2,
        page: 2,
      });
      expect(p1.pages).toBe(2);
      expect(p1.jobs).toHaveLength(2);
      expect(p2.jobs).toHaveLength(1);
      expect(p1.jobs.map((j) => j.id)).not.toContain(p2.jobs[0].id);
    });

    it('is tenant-isolated: portal A never lists portal B jobs and vice versa', async () => {
      const a = await m.publicModel.listPublicJobs(teamA.id, { pageSize: 50 });
      expect(a.jobs.find((j) => j.title === 'Data Analyst')).toBeUndefined();
      expect(
        await m.publicModel.getPublicJob(teamA.id, 'data-analyst')
      ).toBeNull();
      expect(
        await m.publicModel.getPublicJob(teamB.id, 'data-analyst')
      ).not.toBeNull();
    });

    it('UNLISTED jobs are reachable by slug only; INTERNAL and drafts are never public', async () => {
      expect(
        await m.publicModel.getPublicJob(teamB.id, 'unlisted-secret-role')
      ).not.toBeNull();
      expect(
        await m.publicModel.getPublicJob(teamB.id, 'internal-only-role')
      ).toBeNull();
      expect(
        await m.publicModel.getPublicJob(teamB.id, 'draft-not-public')
      ).toBeNull();
      expect(punePrivateId).toBeTruthy();
    });

    it('never exposes recruiter-only data in public job objects', async () => {
      const job = await m.publicModel.getPublicJob(teamB.id, 'data-analyst');
      const json = JSON.stringify(job);
      expect(json).not.toMatch(/createdById|deletedAt|teamId|assignments/);
      const portal = await m.publicModel.getPublicPortal(slugB);
      expect(JSON.stringify(portal)).not.toMatch(
        /billingId|suspendedReason|domain/
      );
    });

    it('builds schema.org JobPosting JSON-LD and escapes script-closing sequences', async () => {
      const job = await m.publicModel.getPublicJob(teamB.id, 'data-analyst');
      const ld: any = m.jobsLib.jobPostingJsonLd({
        job: job as never,
        company: { name: 'Beta P2', website: 'https://beta.example' },
        url: 'https://x/p/b/jobs/data-analyst',
      });
      expect(ld['@type']).toBe('JobPosting');
      expect(ld.title).toBe('Data Analyst');
      expect(ld.employmentType).toBe('FULL_TIME');
      expect(ld.hiringOrganization.name).toBe('Beta P2');
      expect(ld.jobLocation[0].address.addressLocality).toBe('Pune');
      expect(ld.baseSalary.value.minValue).toBe(600000);
      expect(ld.validThrough).toBeTruthy();
      const remote = await m.publicModel.getPublicJob(
        teamB.id,
        'platform-reliability-engineer'
      );
      const ld2: any = m.jobsLib.jobPostingJsonLd({
        job: remote as never,
        company: { name: 'B' },
        url: 'u',
      });
      expect(ld2.jobLocationType).toBe('TELECOMMUTE');
      expect(ld2.baseSalary).toBeUndefined();
      expect(
        m.jobsLib.safeJsonForScript({ a: '</script><script>alert(1)</script>' })
      ).not.toContain('</script>');
      void remoteId;
    });

    it('sitemap lists open public jobs only; robots points at the sitemap', async () => {
      const res = createResponse();
      await m.sitemap.getServerSideProps({
        params: { portal: slugB },
        res,
      } as never);
      const xml = res._getData();
      expect(xml).toContain(`/p/${slugB}/jobs/data-analyst`);
      expect(xml).toContain(`/p/${slugB}/jobs/platform-reliability-engineer`);
      expect(xml).not.toContain('draft-not-public');
      expect(xml).not.toContain('internal-only-role');
      expect(xml).not.toContain('unlisted-secret-role');

      const rr = createResponse();
      await m.robots.getServerSideProps({
        params: { portal: slugB },
        res: rr,
      } as never);
      expect(rr._getData()).toContain(`Sitemap:`);
      expect(rr._getData()).toContain(`/p/${slugB}/sitemap.xml`);

      const nf = await m.sitemap.getServerSideProps({
        params: { portal: 'nope-' + run },
        res: createResponse(),
      } as never);
      expect(nf).toEqual({ notFound: true });
    });

    it('suspended portals: notice with 403, no sitemap, robots disallow, no applications', async () => {
      await prisma.team.update({
        where: { id: teamB.id },
        data: { status: 'SUSPENDED' },
      });
      try {
        const res = createResponse();
        const out: any = await m.publicPage.getPortalProps(
          { params: { portal: slugB }, res } as never,
          async () => ({ jobs: [1] })
        );
        expect(res.statusCode).toBe(403);
        expect(out.props.portal.suspended).toBe(true);
        expect(out.props.jobs).toBeUndefined(); // loader is not run
        expect(out.props.portal.profile).toBeNull();

        const sm = await m.sitemap.getServerSideProps({
          params: { portal: slugB },
          res: createResponse(),
        } as never);
        expect(sm).toEqual({ notFound: true });
        const rr = createResponse();
        await m.robots.getServerSideProps({
          params: { portal: slugB },
          res: rr,
        } as never);
        expect(rr._getData()).toContain('Disallow: /');

        const apply = await call(m.applyApi, 'cand1', {
          method: 'POST',
          query: { portal: slugB, jobSlug: 'data-analyst' },
          body: { resumeId: 'x', consent: { application: true } },
        });
        expect(apply.status).toBe(403);
      } finally {
        await prisma.team.update({
          where: { id: teamB.id },
          data: { status: 'ACTIVE' },
        });
      }
    });

    it('unknown portal -> 404', async () => {
      const out = await m.publicPage.getPortalProps({
        params: { portal: 'nope-' + run },
        res: createResponse(),
      } as never);
      expect(out).toEqual({ notFound: true });
    });
  });

  // -------------------------------------------------------------------------
  describe('candidates', () => {
    it('registers a job seeker without a team; rejects duplicates and weak passwords', async () => {
      const u = await prisma.user.findUniqueOrThrow({
        where: { id: users.cand1.id },
        include: { teamMembers: true, candidateProfile: true },
      });
      expect(u.teamMembers).toHaveLength(0);
      expect(u.candidateProfile).not.toBeNull();

      const dup = await call(m.registerApi, null, {
        method: 'POST',
        body: { name: 'x', email: users.cand1.email, password: 'S3cure-pass!' },
        ip: '10.9.9.1',
      });
      expect(dup.status).toBe(400);
      const weak = await call(m.registerApi, null, {
        method: 'POST',
        body: {
          name: 'x',
          email: `weak-${run}@cand-test.com`,
          password: '123',
        },
        ip: '10.9.9.2',
      });
      expect(weak.status).toBe(422);
      const bad = await call(m.registerApi, null, {
        method: 'POST',
        body: { name: 'x', email: 'not-an-email', password: 'S3cure-pass!' },
        ip: '10.9.9.3',
      });
      expect(bad.status).toBe(422);
    });

    it('rate-limits registration per IP', async () => {
      m.rate.resetRateLimits();
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        const r = await call(m.registerApi, null, {
          method: 'POST',
          body: { name: 'x', email: 'bad', password: '1' },
          ip: '10.7.7.7',
        });
        statuses.push(r.status);
      }
      expect(statuses.slice(0, 10).every((s) => s === 422)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
    });

    it('profile is null until used; PUT stores it and computes completeness', async () => {
      expect((await call(m.profileApi, 'ownerA')).json.data).toBeNull(); // recruiter never used it
      expect((await call(m.profileApi, null)).status).toBe(401);

      const empty = await call(m.profileApi, 'cand1');
      expect(empty.json.data.completeness).toBe(0);

      const put = await call(m.profileApi, 'cand1', {
        method: 'PUT',
        body: {
          headline: 'Backend engineer',
          summary: 'Ten years of services.',
          phone: '+91 99999 99999',
          location: 'Pune',
          expectedSalary: 1800000,
          skills: ['Node.js', 'PostgreSQL', 'AWS', 'node.js'],
          experiences: [
            {
              company: 'Acme',
              title: 'Engineer',
              startDate: '2018-01-01',
              current: true,
            },
          ],
          educations: [{ institution: 'IIT', degree: 'B.Tech' }],
        },
      });
      expect(put.status).toBe(200);
      expect(
        put.json.data.skills.map((s: { skill: string }) => s.skill).sort()
      ).toEqual(['AWS', 'Node.js', 'PostgreSQL', 'node.js']);
      // headline, summary, phone, location, skills>=3, experience, education = 7/8 (no resume yet)
      expect(put.json.data.completeness).toBe(88);
      expect(
        (
          await call(m.profileApi, 'cand1', {
            method: 'PUT',
            body: { expectedSalary: -5 },
          })
        ).status
      ).toBe(422);
      expect(
        (
          await call(m.profileApi, 'cand1', {
            method: 'PUT',
            body: {
              experiences: [
                { company: 'x', title: 'y', startDate: 'not-a-date' },
              ],
            },
          })
        ).status
      ).toBe(422);
    });

    it("one candidate cannot read or change another candidate's profile", async () => {
      const mine = await call(m.profileApi, 'cand2');
      expect(mine.json.data.headline).toBeNull();
      expect(mine.json.data.userId).toBe(users.cand2.id);
    });
  });

  // -------------------------------------------------------------------------
  describe('resume upload and secure download', () => {
    it('accepts PDF and DOCX, stores them privately under candidates/{userId}/', async () => {
      const pdf = await uploadResume('cand1');
      expect(pdf.status).toBe(201);
      expect(pdf.json.data.parseStatus).toBe('PENDING');
      expect(pdf.json.data.isDefault).toBe(true);
      const row = await prisma.candidateResume.findUniqueOrThrow({
        where: { id: pdf.json.data.id },
      });
      expect(row.storageKey).toMatch(
        new RegExp(`^candidates/${users.cand1.id}/resumes/[0-9a-f-]+\\.pdf$`)
      );
      expect(
        (await fs.readFile(path.join(storageDir, row.storageKey))).equals(PDF)
      ).toBe(true);

      const docx = await uploadResume(
        'cand1',
        DOCX,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'cv.docx'
      );
      expect(docx.status).toBe(201);
      expect(docx.json.data.isDefault).toBe(false);
      expect(docx.json.data.version).toBe(2);
    });

    it('rejects wrong types, mismatching content, empty and oversized files, anonymous uploads', async () => {
      expect(
        (await uploadResume('cand1', PDF, 'image/png', 'x.png')).status
      ).toBe(415);
      expect(
        (
          await uploadResume(
            'cand1',
            Buffer.from('MZ\x90\x00 not a pdf'),
            'application/pdf',
            'evil.pdf'
          )
        ).status
      ).toBe(415);
      expect(
        (await uploadResume('cand1', Buffer.alloc(0), 'application/pdf')).status
      ).toBe(400);
      const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5000)]);
      expect((await uploadResume('cand1', big)).status).toBe(413);
      // body larger than the cap without a content-length header is also cut off
      const noLen = await callRaw(m.resumesApi, 'cand1', big, {
        'content-type': 'application/pdf',
        'content-length': '10',
      });
      expect(noLen.status).toBe(413);
      expect((await uploadResume(null as never)).status).toBe(401);
    });

    it('sanitises the original file name', async () => {
      const r = await uploadResume(
        'cand2',
        PDF,
        'application/pdf',
        '../../etc/passwd<script>.pdf'
      );
      expect(r.status).toBe(201);
      expect(r.json.data.fileName).not.toMatch(/[/<>]/);
      const row = await prisma.candidateResume.findUniqueOrThrow({
        where: { id: r.json.data.id },
      });
      expect(row.storageKey.startsWith(`candidates/${users.cand2.id}/`)).toBe(
        true
      );
      expect(row.storageKey).not.toContain('..');
    });

    it('runs the virus-scan hook', async () => {
      m.upload.setUploadScanner(async () => ({
        clean: false,
        reason: 'EICAR',
      }));
      try {
        expect((await uploadResume('cand2')).status).toBe(422);
      } finally {
        m.upload.setUploadScanner(async () => ({ clean: true }));
      }
    });

    it('rate-limits uploads', async () => {
      m.rate.resetRateLimits();
      const first = await uploadResume('viewerA');
      expect(first.status).toBe(201);
      let last = 0;
      for (let i = 0; i < 21; i++) {
        last = (await uploadResume('viewerA')).status;
        if (last === 429) {
          break;
        }
      }
      expect([400, 429]).toContain(last); // either the per-hour cap or the 10-resume cap
      await prisma.candidateResume.deleteMany({
        where: { profile: { userId: users.viewerA.id } },
      });
      m.rate.resetRateLimits();
    });

    it('issues a short-lived signed URL only to the owner', async () => {
      const list = await call(m.resumesApi, 'cand1');
      const id = list.json.data[0].id;
      const own = await call(m.resumeApi, 'cand1', { query: { id } });
      expect(own.status).toBe(200);
      expect(own.headers['cache-control']).toBe('no-store');
      const url = new URL(own.json.data.url);
      expect(url.pathname).toBe('/api/storage/local');
      const exp = Number(url.searchParams.get('expires'));
      expect(exp - Date.now() / 1000).toBeLessThanOrEqual(61);

      expect((await call(m.resumeApi, 'cand2', { query: { id } })).status).toBe(
        404
      );
      expect(
        (await call(m.resumeApi, 'ownerA', { query: { id } })).status
      ).toBe(404);
      expect((await call(m.resumeApi, null, { query: { id } })).status).toBe(
        401
      );
    });

    it('signed URLs serve the file, and expire / reject tampering', async () => {
      const list = await call(m.resumesApi, 'cand1');
      const resume = await prisma.candidateResume.findUniqueOrThrow({
        where: {
          id: list.json.data.find(
            (r: { mime: string }) => r.mime === 'application/pdf'
          ).id,
        },
      });
      const asQuery = (u: string) =>
        Object.fromEntries(new URL(u).searchParams.entries());

      const good = await m.storage.getSignedUrl(resume.storageKey, {
        fileName: 'cv.pdf',
      });
      const ok = await call(m.storageApi, null, { query: asQuery(good) });
      expect(ok.status).toBe(200);
      expect(ok.headers['content-type']).toBe('application/pdf');
      expect(String(ok.headers['content-disposition'])).toContain('attachment');
      expect(ok.headers['x-content-type-options']).toBe('nosniff');

      const expired = await m.storage.getSignedUrl(resume.storageKey, {
        ttlSeconds: -5,
      });
      expect(
        (await call(m.storageApi, null, { query: asQuery(expired) })).status
      ).toBe(403);

      const tampered = {
        ...asQuery(good),
        key: resume.storageKey.replace(users.cand1.id, users.cand2.id),
      };
      expect((await call(m.storageApi, null, { query: tampered })).status).toBe(
        403
      );
      expect(
        (
          await call(m.storageApi, null, {
            query: { ...asQuery(good), sig: 'deadbeef' },
          })
        ).status
      ).toBe(403);
      expect(
        (
          await call(m.storageApi, null, {
            query: {
              ...asQuery(good),
              expires: String(Math.floor(Date.now() / 1000) + 99999),
            },
          })
        ).status
      ).toBe(403);
      expect((await call(m.storageApi, null, { query: {} })).status).toBe(403);
    });

    it('rejects path traversal and foreign key shapes', async () => {
      expect(() => m.storage.assertValidKey('../etc/passwd')).toThrow();
      expect(() =>
        m.storage.assertValidKey('candidates/x/../../etc/passwd')
      ).toThrow();
      expect(() => m.storage.assertValidKey('other/abc/file.pdf')).toThrow();
      expect(() =>
        m.storage.assertValidKey(`tenants/${teamA.id}/docs/a.pdf`)
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  describe('apply flow', () => {
    let jobSlug = '';
    let jobId = '';
    let resumeId = '';
    let questions: { id: string; prompt: string }[] = [];

    const apply = (
      as: string | null,
      body: unknown,
      slug = slugA,
      job = jobSlug
    ) =>
      call(m.applyApi, as, {
        method: 'POST',
        query: { portal: slug, jobSlug: job },
        body,
      });

    beforeAll(async () => {
      const job = await call(m.jobsApi, 'ownerA', {
        method: 'POST',
        query: q(slugA),
        body: {
          title: 'Apply Flow Engineer',
          descriptionHtml: DESC,
          workMode: 'REMOTE',
          questions: [
            { type: 'BOOLEAN', prompt: 'Can you relocate?', required: true },
            {
              type: 'SINGLE',
              prompt: 'Notice period (days)?',
              options: ['15', '30', '60'],
              required: false,
            },
            {
              type: 'MULTI',
              prompt: 'Which clouds?',
              options: ['AWS', 'GCP', 'Azure'],
              required: false,
            },
            { type: 'NUMBER', prompt: 'Years of Node?', required: false },
            { type: 'TEXT', prompt: 'Why us?', required: false },
          ],
        },
      });
      jobId = job.json.data.id;
      jobSlug = job.json.data.slug;
      questions = job.json.data.questions;
      await publish('ownerA', slugA, jobId);
      resumeId = (await call(m.resumesApi, 'cand1')).json.data[0].id;
    });

    it('requires sign-in, consent, a valid own resume and answers to required questions', async () => {
      const ok = {
        resumeId,
        answers: { [questions[0].id]: true },
        consent: { application: true },
      };
      expect((await apply(null, ok)).status).toBe(401);
      expect(
        (await apply('cand1', { ...ok, consent: { application: false } }))
          .status
      ).toBe(422);
      expect((await apply('cand1', { ...ok, consent: {} })).status).toBe(422);
      expect((await apply('cand1', { ...ok, resumeId: 'nope' })).status).toBe(
        422
      );

      // someone else's resume
      const other = (await uploadResume('cand2')).json.data.id;
      expect((await apply('cand1', { ...ok, resumeId: other })).status).toBe(
        422
      );

      expect((await apply('cand1', { ...ok, answers: {} })).status).toBe(422); // required missing
      expect(
        (await apply('cand1', { ...ok, answers: { [questions[0].id]: 'yes' } }))
          .status
      ).toBe(422); // wrong type
      expect(
        (
          await apply('cand1', {
            ...ok,
            answers: { [questions[0].id]: true, [questions[1].id]: '90' },
          })
        ).status
      ).toBe(422); // not an option
      expect(
        (
          await apply('cand1', {
            ...ok,
            answers: {
              [questions[0].id]: true,
              [questions[2].id]: ['AWS', 'Oracle'],
            },
          })
        ).status
      ).toBe(422);
      expect(
        (
          await apply('cand1', {
            ...ok,
            answers: { [questions[0].id]: true, [questions[3].id]: 'abc' },
          })
        ).status
      ).toBe(422);
      expect(
        await prisma.jobApplication.count({
          where: { teamId: teamA.id, jobId },
        })
      ).toBe(0);
    });

    it('creates tenant candidate, application, activity and consent in one go', async () => {
      m.svix.sendEvent.mockClear();
      const r = await apply('cand1', {
        resumeId,
        answers: {
          [questions[0].id]: true,
          [questions[1].id]: '30',
          [questions[2].id]: ['AWS', 'GCP'],
          [questions[3].id]: '7',
          [questions[4].id]: 'Great product',
          'unknown-question': 'ignored',
        },
        consent: { application: true, talentPool: true },
      });
      expect(r.status).toBe(201);
      expect(r.json.data.stage).toBe('Applied');

      const app = await prisma.jobApplication.findFirstOrThrow({
        where: { id: r.json.data.applicationId, teamId: teamA.id },
        include: { tenantCandidate: true, stage: true, activities: true },
      });
      expect(app.stage.name).toBe('Applied');
      expect(app.resumeId).toBe(resumeId);
      expect(app.tenantCandidate).toMatchObject({
        teamId: teamA.id,
        userId: users.cand1.id,
        email: users.cand1.email.toLowerCase(),
        source: 'portal',
      });
      expect(app.activities).toHaveLength(1);
      expect(app.activities[0]).toMatchObject({
        type: 'APPLIED',
        actorUserId: users.cand1.id,
        teamId: teamA.id,
      });

      const answers = app.answers as {
        questionId: string;
        prompt: string;
        value: unknown;
      }[];
      expect(answers).toHaveLength(5); // unknown question dropped
      expect(answers.find((a) => a.questionId === questions[3].id)?.value).toBe(
        7
      ); // coerced
      expect(answers[0].prompt).toBeTruthy(); // prompt snapshot

      const consents = await prisma.candidateConsent.findMany({
        where: { teamId: teamA.id, userId: users.cand1.id },
      });
      expect(consents.map((c) => `${c.purpose}:${c.granted}`).sort()).toEqual([
        'APPLICATION:true',
        'TALENT_POOL:true',
      ]);
      expect(consents[0].policyVersion).toBeTruthy();
      expect(m.svix.sendEvent).toHaveBeenCalledWith(
        teamA.id,
        'application.created',
        expect.objectContaining({ jobId })
      );
    });

    it('rejects a second application to the same job (409) without duplicating data', async () => {
      const again = await apply('cand1', {
        resumeId,
        answers: { [questions[0].id]: true },
        consent: { application: true },
      });
      expect(again.status).toBe(409);
      expect(
        await prisma.jobApplication.count({
          where: { teamId: teamA.id, jobId },
        })
      ).toBe(1);
      expect(
        await prisma.tenantCandidate.count({
          where: { teamId: teamA.id, email: users.cand1.email.toLowerCase() },
        })
      ).toBe(1);
    });

    it('survives a concurrent double submit', async () => {
      const resume2 = (await call(m.resumesApi, 'cand2')).json.data[0].id;
      const body = {
        resumeId: resume2,
        answers: { [questions[0].id]: false },
        consent: { application: true },
      };
      const results = await Promise.all([
        apply('cand2', body),
        apply('cand2', body),
        apply('cand2', body),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(2);
      expect(
        await prisma.jobApplication.count({
          where: { teamId: teamA.id, jobId },
        })
      ).toBe(2);
    });

    it('cannot apply to closed, draft, internal jobs or unknown portals', async () => {
      const closed = await newJob('ownerA', slugA, {
        title: 'Closed Role Apply',
      });
      await publish('ownerA', slugA, closed.id);
      await call(m.actionsApi, 'ownerA', {
        method: 'POST',
        query: q(slugA, { jobId: closed.id }),
        body: { action: 'close' },
      });
      const body = { resumeId, answers: {}, consent: { application: true } };
      expect((await apply('cand1', body, slugA, closed.slug)).status).toBe(404);
      const draft = await newJob('ownerA', slugA, {
        title: 'Draft Role Apply',
      });
      expect((await apply('cand1', body, slugA, draft.slug)).status).toBe(404);
      const internal = await newJob('ownerA', slugA, {
        title: 'Internal Role Apply',
        visibility: 'INTERNAL',
      });
      await publish('ownerA', slugA, internal.id);
      expect((await apply('cand1', body, slugA, internal.slug)).status).toBe(
        404
      );
      expect((await apply('cand1', body, 'nope-' + run, jobSlug)).status).toBe(
        404
      );
      // a job of portal B cannot be applied to through portal A's slug
      expect((await apply('cand1', body, slugA, 'data-analyst')).status).toBe(
        404
      );
    });

    it('rate-limits applications per user', async () => {
      m.rate.resetRateLimits();
      let last = 0;
      for (let i = 0; i < 32; i++) {
        last = (
          await apply('cand2', {
            resumeId: 'x',
            consent: { application: true },
          })
        ).status;
      }
      expect(last).toBe(429);
      m.rate.resetRateLimits();
    });
  });

  // -------------------------------------------------------------------------
  describe('pipeline and candidate dashboard', () => {
    let jobId = '';
    let jobSlug = '';
    let appId = '';
    let app2Id = '';
    let app3Id = '';

    const move = (
      as: string,
      applicationId: string,
      stage: string,
      extra = {},
      slug = slugA
    ) =>
      call(m.stageApi, as, {
        method: 'POST',
        query: q(slug),
        body: { applicationId, stageId: stage, ...extra },
      });

    beforeAll(async () => {
      const job = await newJob('ownerA', slugA, { title: 'Pipeline Role' });
      jobId = job.id;
      jobSlug = job.slug;
      await publish('ownerA', slugA, jobId);
      await call(m.assignApi, 'ownerA', {
        method: 'PUT',
        query: q(slugA, { jobId }),
        body: { assignments: [{ userId: users.recA.id, kind: 'RECRUITER' }] },
      });
      const resume1 = (await call(m.resumesApi, 'cand1')).json.data[0].id;
      const resume2 = (await call(m.resumesApi, 'cand2')).json.data[0].id;
      await register('cand3');
      const resume3 = (await uploadResume('cand3')).json.data.id;
      const go = async (as: string, resumeId: string) =>
        (
          await call(m.applyApi, as, {
            method: 'POST',
            query: { portal: slugA, jobSlug },
            body: { resumeId, consent: { application: true } },
            ip: '10.3.3.3',
          })
        ).json.data.applicationId as string;
      appId = await go('cand1', resume1);
      app2Id = await go('cand2', resume2);
      app3Id = await go('cand3', resume3);
    });

    it('shows the board with 13 stages and the applications in "Applied"', async () => {
      const r = await call(m.pipelineApi, 'recA', {
        query: q(slugA, { jobId }),
      });
      expect(r.status).toBe(200);
      expect(r.json.data.stages).toHaveLength(13);
      expect(r.json.data.applications).toHaveLength(3);
      const applied = r.json.data.stages.find(
        (s: { name: string }) => s.name === 'Applied'
      );
      expect(
        r.json.data.applications.every(
          (a: { stageId: string }) => a.stageId === applied.id
        )
      ).toBe(true);
    });

    it('moves a candidate with an audited, append-only transition', async () => {
      m.svix.sendEvent.mockClear();
      m.retraced.sendAudit.mockClear();
      const screening = await stageId(teamA.id, 'Screening');
      const r = await move('recA', appId, screening);
      expect(r.status).toBe(200);
      expect(r.json.data.from.name).toBe('Applied');
      expect(r.json.data.to.name).toBe('Screening');

      const acts = await prisma.applicationActivity.findMany({
        where: { teamId: teamA.id, applicationId: appId },
        orderBy: { createdAt: 'asc' },
      });
      expect(acts.map((a) => a.type)).toEqual(['APPLIED', 'STAGE_CHANGED']);
      expect(acts[1]).toMatchObject({
        actorUserId: users.recA.id,
        toStageId: screening,
      });
      expect(acts[1].payload).toMatchObject({
        fromName: 'Applied',
        toName: 'Screening',
      });
      expect(m.retraced.sendAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'application.stage_change' })
      );
      expect(m.svix.sendEvent).toHaveBeenCalledWith(
        teamA.id,
        'application.stage_changed',
        expect.objectContaining({ applicationId: appId })
      );

      const detail = await call(m.appApi, 'recA', {
        query: q(slugA, { applicationId: appId }),
      });
      expect(detail.json.data.stage.name).toBe('Screening');
      expect(detail.json.data.activities).toHaveLength(2);
    });

    it('rejects invalid moves', async () => {
      const screening = await stageId(teamA.id, 'Screening');
      expect((await move('recA', appId, screening)).status).toBe(400); // same stage
      expect((await move('recA', appId, 'nope')).status).toBe(404);
      expect(
        (await move('recA', appId, await stageId(teamA.id, 'Withdrawn'))).status
      ).toBe(400); // candidate only
      expect((await move('recA', 'nope', screening)).status).toBe(404);
      // a stage of another portal
      const foreign = await stageId(teamB.id, 'Offer');
      expect((await move('recA', appId, foreign)).status).toBe(404);
      const detail = await prisma.jobApplication.findFirstOrThrow({
        where: { id: appId, teamId: teamA.id },
      });
      expect(detail.stageId).toBe(screening);
    });

    it('rejection stores the reason; hiring emits candidate.hired; reopening clears the reason', async () => {
      const rejected = await stageId(teamA.id, 'Rejected');
      const r = await move('ownerA', app2Id, rejected, {
        rejectionReason: 'Not enough experience',
      });
      expect(r.status).toBe(200);
      expect(
        (
          await prisma.jobApplication.findFirstOrThrow({
            where: { id: app2Id, teamId: teamA.id },
          })
        ).rejectionReason
      ).toBe('Not enough experience');

      m.svix.sendEvent.mockClear();
      await move('ownerA', app2Id, await stageId(teamA.id, 'Hired'));
      expect(
        (
          await prisma.jobApplication.findFirstOrThrow({
            where: { id: app2Id, teamId: teamA.id },
          })
        ).rejectionReason
      ).toBeNull();
      expect(m.svix.sendEvent).toHaveBeenCalledWith(
        teamA.id,
        'candidate.hired',
        expect.anything()
      );
    });

    it('bulk move reports each application and applies the valid ones', async () => {
      const review = await stageId(teamA.id, 'Recruiter Review');
      const r = await call(m.stageApi, 'recA', {
        method: 'POST',
        query: q(slugA),
        body: { applicationIds: [app3Id, 'nope', appId], stageId: review },
      });
      expect(r.status).toBe(200);
      const results = r.json.data.results as {
        applicationId: string;
        ok: boolean;
      }[];
      expect(results.find((x) => x.applicationId === app3Id)?.ok).toBe(true);
      expect(results.find((x) => x.applicationId === 'nope')?.ok).toBe(false);
      expect(results.find((x) => x.applicationId === appId)?.ok).toBe(true);
      expect(
        (
          await call(m.stageApi, 'recA', {
            method: 'POST',
            query: q(slugA),
            body: { applicationIds: [], stageId: review },
          })
        ).status
      ).toBe(422);
      const tooMany = Array.from({ length: 101 }, (_, i) => `id-${i}`);
      expect(
        (
          await call(m.stageApi, 'recA', {
            method: 'POST',
            query: q(slugA),
            body: { applicationIds: tooMany, stageId: review },
          })
        ).status
      ).toBe(422);
    });

    it('moves are permission- and scope-checked', async () => {
      const offer = await stageId(teamA.id, 'Offer');
      expect((await move('viewerA', appId, offer)).status).toBe(403); // read-only
      expect((await move('rec2A', appId, offer)).status).toBe(404); // not assigned
      expect((await move('ownerB', appId, offer)).status).toBe(403); // other tenant
      expect(
        (
          await call(m.stageApi, 'ownerB', {
            method: 'POST',
            query: q(slugB),
            body: {
              applicationId: appId,
              stageId: await stageId(teamB.id, 'Offer'),
            },
          })
        ).status
      ).toBe(404);
      expect(
        (await call(m.pipelineApi, 'viewerA', { query: q(slugA, { jobId }) }))
          .status
      ).toBe(200);
      expect(
        (
          await call(m.appApi, 'rec2A', {
            query: q(slugA, { applicationId: appId }),
          })
        ).status
      ).toBe(404);
      expect(
        (
          await call(m.appApi, 'ownerB', {
            query: q(slugB, { applicationId: appId }),
          })
        ).status
      ).toBe(404);
    });

    it('activity history can no longer be altered through the app client', async () => {
      await expect(
        prisma.applicationActivity.deleteMany({
          where: { teamId: teamA.id, applicationId: appId },
        })
      ).rejects.toThrow(/append-only/);
      expect(
        await prisma.applicationActivity.count({
          where: { teamId: teamA.id, applicationId: appId },
        })
      ).toBeGreaterThanOrEqual(3);
    });

    it('recruiters download resumes via signed URLs after permission and scope checks', async () => {
      const r = await call(m.resumeDlApi, 'recA', {
        query: q(slugA, { applicationId: appId }),
      });
      expect(r.status).toBe(200);
      expect(r.headers['cache-control']).toBe('no-store');
      const u = new URL(r.json.data.url);
      const file = await call(m.storageApi, null, {
        query: Object.fromEntries(u.searchParams.entries()),
      });
      expect(file.status).toBe(200);

      expect(
        (
          await call(m.resumeDlApi, 'viewerA', {
            query: q(slugA, { applicationId: appId }),
          })
        ).status
      ).toBe(200); // applications.read
      expect(
        (
          await call(m.resumeDlApi, 'rec2A', {
            query: q(slugA, { applicationId: appId }),
          })
        ).status
      ).toBe(404); // not assigned
      expect(
        (
          await call(m.resumeDlApi, 'ownerB', {
            query: q(slugA, { applicationId: appId }),
          })
        ).status
      ).toBe(403);
      expect(
        (
          await call(m.resumeDlApi, 'ownerB', {
            query: q(slugB, { applicationId: appId }),
          })
        ).status
      ).toBe(404);
      expect(
        (
          await call(m.resumeDlApi, null, {
            query: q(slugA, { applicationId: appId }),
          })
        ).status
      ).toBe(401);
    });

    it('candidates track their applications across portals without internal data', async () => {
      const r = await call(m.myAppsApi, 'cand2');
      expect(r.status).toBe(200);
      const mine = r.json.data.find(
        (a: { job: { slug: string } }) => a.job.slug === jobSlug
      );
      expect(mine.stage.name).toBe('Hired');
      expect(mine.stages).toHaveLength(13);
      expect(mine.history.map((h: { stage: string }) => h.stage)).toEqual(
        expect.arrayContaining(['Applied', 'Rejected', 'Hired'])
      );
      const json = JSON.stringify(r.json);
      expect(json).not.toMatch(
        /Not enough experience|rejectionReason|actorUserId|answers/
      );
      // only their own applications
      expect(r.json.data.every((a: { id: string }) => a.id !== appId)).toBe(
        true
      );
      expect((await call(m.myAppsApi, null)).status).toBe(401);
    });

    it('candidates can withdraw only their own applications, once', async () => {
      expect(
        (
          await call(m.withdrawApi, 'cand2', {
            method: 'POST',
            query: { id: appId },
          })
        ).status
      ).toBe(404);
      expect(
        (
          await call(m.withdrawApi, 'ownerA', {
            method: 'POST',
            query: { id: appId },
          })
        ).status
      ).toBe(404);

      m.svix.sendEvent.mockClear();
      const w = await call(m.withdrawApi, 'cand1', {
        method: 'POST',
        query: { id: appId },
      });
      expect(w.status).toBe(200);
      const row = await prisma.jobApplication.findFirstOrThrow({
        where: { id: appId, teamId: teamA.id },
        include: { stage: true },
      });
      expect(row.stage.kind).toBe('WITHDRAWN');
      expect(row.withdrawnAt).not.toBeNull();
      const acts = await prisma.applicationActivity.findMany({
        where: { teamId: teamA.id, applicationId: appId },
        orderBy: { createdAt: 'asc' },
      });
      expect(acts[acts.length - 1].type).toBe('WITHDRAWN');
      expect(m.svix.sendEvent).toHaveBeenCalledWith(
        teamA.id,
        'application.withdrawn',
        expect.anything()
      );

      expect(
        (
          await call(m.withdrawApi, 'cand1', {
            method: 'POST',
            query: { id: appId },
          })
        ).status
      ).toBe(409);
      // recruiters can no longer move a withdrawn application
      expect(
        (await move('recA', appId, await stageId(teamA.id, 'Offer'))).status
      ).toBe(409);
    });
  });

  // -------------------------------------------------------------------------
  describe('saved jobs', () => {
    it('saves open jobs only, lists them and removes them', async () => {
      const job = await publicJob(slugA);
      expect(
        (
          await call(m.savedApi, 'cand1', {
            method: 'POST',
            body: { jobId: job.id },
          })
        ).status
      ).toBe(201);
      expect(
        (
          await call(m.savedApi, 'cand1', {
            method: 'POST',
            body: { jobId: job.id },
          })
        ).status
      ).toBe(201); // idempotent
      const draft = await newJob('ownerA', slugA, {
        title: 'Saved Draft Role',
      });
      expect(
        (
          await call(m.savedApi, 'cand1', {
            method: 'POST',
            body: { jobId: draft.id },
          })
        ).status
      ).toBe(404);
      const list = await call(m.savedApi, 'cand1');
      expect(list.json.data).toHaveLength(1);
      expect(list.json.data[0]).toMatchObject({ id: job.id, open: true });
      expect((await call(m.savedApi, 'cand2')).json.data).toHaveLength(0);
      expect(
        (
          await call(m.savedApi, 'cand1', {
            method: 'DELETE',
            query: { jobId: job.id },
          })
        ).status
      ).toBe(200);
      expect((await call(m.savedApi, 'cand1')).json.data).toHaveLength(0);
      expect((await call(m.savedApi, null)).status).toBe(401);
    });

    async function publicJob(slug: string) {
      const team = await prisma.team.findUniqueOrThrow({ where: { slug } });
      const r = await m.publicModel.listPublicJobs(team.id, { pageSize: 1 });
      return r.jobs[0];
    }
  });

  // -------------------------------------------------------------------------
  describe('privacy: export and erasure', () => {
    it("exports only the requesting candidate's data", async () => {
      const r = await call(m.privacyApi, 'cand1');
      expect(r.status).toBe(200);
      const data = r.json.data;
      expect(data.account.email).toBe(users.cand1.email);
      expect(data.profile.headline).toBe('Backend engineer');
      expect(data.applications.length).toBeGreaterThanOrEqual(1);
      expect(data.consents.length).toBeGreaterThanOrEqual(2);
      const text = JSON.stringify(data);
      expect(text).not.toContain(users.cand2.email);
      expect(text).not.toMatch(/"password"|storageKey|Not enough experience/);
      expect((await call(m.privacyApi, null)).status).toBe(401);
    });

    it('refuses to erase accounts that still belong to a portal', async () => {
      const r = await call(m.privacyApi, 'ownerA', { method: 'DELETE' });
      expect(r.status).toBe(400);
      expect(await prisma.user.count({ where: { id: users.ownerA.id } })).toBe(
        1
      );
    });

    it('erases the account, removes files and anonymises the employer-side record', async () => {
      const resumes = await prisma.candidateResume.findMany({
        where: { profile: { userId: users.cand2.id } },
      });
      expect(resumes.length).toBeGreaterThan(0);
      const files = resumes.map((r) => path.join(storageDir, r.storageKey));
      for (const f of files) {
        await expect(fs.stat(f)).resolves.toBeDefined();
      }
      const tcBefore = await prisma.tenantCandidate.findFirstOrThrow({
        where: { teamId: teamA.id, email: users.cand2.email.toLowerCase() },
      });

      const r = await call(m.privacyApi, 'cand2', { method: 'DELETE' });
      expect(r.status).toBe(200);

      expect(await prisma.user.count({ where: { id: users.cand2.id } })).toBe(
        0
      );
      expect(
        await prisma.candidateProfile.count({
          where: { userId: users.cand2.id },
        })
      ).toBe(0);
      expect(
        await prisma.candidateResume.count({
          where: { id: { in: resumes.map((x) => x.id) } },
        })
      ).toBe(0);
      for (const f of files) {
        await expect(fs.stat(f)).rejects.toThrow();
      }

      const tc = await prisma.tenantCandidate.findFirstOrThrow({
        where: { id: tcBefore.id, teamId: teamA.id },
      });
      expect(tc).toMatchObject({
        userId: null,
        name: 'Deleted candidate',
        phone: null,
      });
      expect(tc.email).toMatch(/^deleted\+.+@invalid\.local$/);
      expect(tc.email).not.toContain('cand2');
      const apps = await prisma.jobApplication.findMany({
        where: { teamId: teamA.id, tenantCandidateId: tc.id },
      });
      expect(apps.length).toBeGreaterThan(0); // employer keeps the (anonymous) record
      expect(apps.every((a) => a.resumeId === null)).toBe(true);
      const consents = await m.unguarded.candidateConsent.findMany({
        where: { userId: users.cand2.id },
      });
      expect(consents.every((c) => c.revokedAt !== null)).toBe(true);

      // the recruiter view shows no personal data any more
      const detail = await call(m.appApi, 'ownerA', {
        query: q(slugA, { applicationId: apps[0].id }),
      });
      expect(detail.json.data.candidate.name).toBe('Deleted candidate');
      expect(JSON.stringify(detail.json)).not.toContain(users.cand2.email);
      const dl = await call(m.resumeDlApi, 'ownerA', {
        query: q(slugA, { applicationId: apps[0].id }),
      });
      expect(dl.status).toBe(404);
    });
  });
});
