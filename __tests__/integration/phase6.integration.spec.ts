/**
 * @jest-environment node
 *
 * Phase 6 integration tests: entitlements and metering, custom domains,
 * platform admin, integrations (calendar OAuth + sync, partner webhooks).
 * Run with:  DATABASE_URL=postgresql://... npm run test:integration
 */
import { createHmac } from 'crypto';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const enabled = process.env.INTEGRATION === '1' && !!process.env.DATABASE_URL;
const suite = enabled ? describe : describe.skip;

process.env.APP_URL = 'http://localhost:4002';
process.env.NEXTAUTH_SECRET = 'phase6-secret';
process.env.ENTITLEMENTS_ENFORCEMENT = 'on';
process.env.AI_DEFAULT_PROVIDER = 'fake';
process.env.AI_KEYS_ENCRYPTION_SECRET = 'phase6-ai-secret';
process.env.PLATFORM_ADMIN_EMAILS =
  'root-admin@p6-test.com, other-root@p6-test.com';
process.env.PORTAL_CNAME_TARGET = 'portals.platform.test';
process.env.PUBLIC_PORTAL_BASE_DOMAIN = 'platform.test';
process.env.INTEGRATION_GOOGLE_CLIENT_ID = 'google-client';
process.env.INTEGRATION_GOOGLE_CLIENT_SECRET = 'google-secret';
process.env.INTEGRATION_MICROSOFT_CLIENT_ID = 'ms-client';
process.env.INTEGRATION_MICROSOFT_CLIENT_SECRET = 'ms-secret';
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

/* eslint-disable @typescript-eslint/no-require-imports */
const load = () => ({
  prisma: require('@/lib/prisma')
    .prisma as typeof import('@/lib/prisma').prisma,
  unguarded: require('@/lib/prisma')
    .unguardedPrisma as typeof import('@/lib/prisma').unguardedPrisma,
  createPortal: require('models/portal').createPortal,
  ent: require('@/lib/entitlements') as typeof import('@/lib/entitlements'),
  domains: require('@/lib/domains') as typeof import('@/lib/domains'),
  billing: require('models/billingPlan') as typeof import('models/billingPlan'),
  ticker: require('@/lib/ticker') as typeof import('@/lib/ticker'),
  ai: require('@/lib/ai/run') as typeof import('@/lib/ai/run'),
  fake: (
    require('@/lib/ai/providers/fake') as typeof import('@/lib/ai/providers/fake')
  ).fakeProvider,
  integ: require('models/integration') as typeof import('models/integration'),
  oauth:
    require('@/lib/integrations/oauth') as typeof import('@/lib/integrations/oauth'),
  partners:
    require('@/lib/integrations/partners') as typeof import('@/lib/integrations/partners'),
  tenantLib: require('@/lib/tenant') as typeof import('@/lib/tenant'),
  jobsApi: require('pages/api/teams/[slug]/jobs/index').default,
  actionsApi: require('pages/api/teams/[slug]/jobs/[jobId]/actions').default,
  invitesApi: require('pages/api/teams/[slug]/invitations').default,
  rolesApi: require('pages/api/teams/[slug]/roles/index').default,
  automationApi: require('pages/api/teams/[slug]/automation/index').default,
  portalApi: require('pages/api/teams/[slug]/portal').default,
  aiSettingsApi: require('pages/api/teams/[slug]/ai/settings').default,
  jdApi: require('pages/api/teams/[slug]/jobs/ai-description').default,
  copilotApi: require('pages/api/teams/[slug]/copilot').default,
  apiKeysApi: require('pages/api/teams/[slug]/api-keys/index').default,
  ssoApi: require('pages/api/teams/[slug]/sso').default,
  planApi: require('pages/api/teams/[slug]/plan').default,
  domainApi: require('pages/api/teams/[slug]/domain/index').default,
  domainVerifyApi: require('pages/api/teams/[slug]/domain/verify').default,
  resolveApi: require('pages/api/public/domains/resolve').default,
  integrationsApi: require('pages/api/teams/[slug]/integrations/index').default,
  integrationApi: require('pages/api/teams/[slug]/integrations/[provider]')
    .default,
  callbackApi: require('pages/api/integrations/callback/[provider]').default,
  partnerApi:
    require('pages/api/teams/[slug]/applications/[applicationId]/partner')
      .default,
  interviewsApi:
    require('pages/api/teams/[slug]/applications/[applicationId]/interviews')
      .default,
  interviewApi: require('pages/api/teams/[slug]/interviews/[interviewId]/index')
    .default,
  adminTenants: require('pages/api/admin/tenants/index').default,
  adminTenant: require('pages/api/admin/tenants/[id]').default,
  adminPlans: require('pages/api/admin/plans').default,
  adminAi: require('pages/api/admin/ai').default,
  adminAudit: require('pages/api/admin/audit').default,
});

const DESC =
  '<p>We are hiring an engineer to build and run our platform services.</p>';

suite(
  'phase 6: entitlements, domains, admin, integrations (integration)',
  () => {
    const m = load();
    const { prisma, unguarded } = m;
    const run = Date.now().toString(36);
    const users: Record<string, { id: string; email: string; name: string }> =
      {};
    let slugA = '';
    let teamA: { id: string };
    let teamB: { id: string };
    let slugB = '';

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

      const { req, res } = createMocks({
        method: (opts.method ?? 'GET') as never,
        query: opts.query ?? {},
        body: opts.body as never,
        headers: opts.headers ?? {},
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
        headers: res.getHeaders(),
        redirect: res._getRedirectUrl(),
      };
    };

    const mkUser = async (key: string, verified = true) => {
      const u = await prisma.user.create({
        data: {
          name: key,
          email: `${key}-${run}@p6-test.com`,
          emailVerified: verified ? new Date() : null,
        },
      });

      users[key] = { id: u.id, email: u.email, name: u.name };
    };

    const setPlan = (
      teamId: string,
      plan: string | null,
      extra: Record<string, unknown> = {}
    ) =>
      unguarded.team.update({
        where: { id: teamId },
        data: {
          planKey: 'free',
          planOverride: plan,
          paymentFailedAt: null,
          ...extra,
        },
      });

    const jobCreate = async (as: string, slug: string, title: string) => {
      const r = await call(m.jobsApi, as, {
        method: 'POST',
        query: { slug },
        body: { title, descriptionHtml: DESC, workMode: 'REMOTE' },
      });

      if (r.status !== 201)
        console.log('JOBCREATE', title, JSON.stringify(r.json));
      expect(r.status).toBe(201);

      return r.json.data.id as string;
    };

    const act = (
      as: string,
      slug: string,
      jobId: string,
      action: string,
      extra: Record<string, unknown> = {}
    ) =>
      call(m.actionsApi, as, {
        method: 'POST',
        query: { slug, jobId },
        body: { action, ...extra },
      });

    const closeAllJobs = async () => {
      await unguarded.job.updateMany({
        where: { teamId: teamA.id },
        data: { status: 'CLOSED' },
      });
    };

    beforeAll(async () => {
      for (const k of [
        'ownerA',
        'ownerB',
        'memberA',
        'admin1',
        'admin2',
        'plainAdmin',
        'unverifiedAdmin',
      ]) {
        await mkUser(k, k !== 'unverifiedAdmin');
      }

      // platform admin accounts are matched by e-mail
      for (const [k, email] of [
        ['admin1', 'root-admin@p6-test.com'],
        ['admin2', 'other-root@p6-test.com'],
        ['unverifiedAdmin', 'unverified@p6-test.com'],
      ] as const) {
        const e = k === 'unverifiedAdmin' ? 'root-admin@p6-test.com' : email;

        await prisma.user.update({
          where: { id: users[k].id },
          data: {
            email:
              k === 'unverifiedAdmin'
                ? `dup-${run}@p6-test.com`
                : `${run}-${e}`,
          },
        });
      }

      await prisma.aIProviderConfig.deleteMany({ where: { teamId: null } });
      await prisma.planEntitlement.deleteMany();
      slugA = `p6a-${run}`;
      slugB = `p6b-${run}`;
      teamA = await m.createPortal({
        userId: users.ownerA.id,
        name: 'Acme P6',
        slug: slugA,
      });
      teamB = await m.createPortal({
        userId: users.ownerB.id,
        name: 'Beta P6',
        slug: slugB,
      });

      const role = await prisma.portalRole.findFirstOrThrow({
        where: { teamId: teamA.id, key: 'recruiter' },
      });

      await prisma.teamMember.create({
        data: {
          teamId: teamA.id,
          userId: users.memberA.id,
          role: role.baseRole,
          portalRoleId: role.id,
        },
      });
    });

    afterAll(async () => {
      await prisma.team.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
      await prisma.user.deleteMany({
        where: { id: { in: Object.values(users).map((u) => u.id) } },
      });
      await prisma.planEntitlement.deleteMany();
      await prisma.platformAuditLog.deleteMany({
        where: { actorUserId: { in: Object.values(users).map((u) => u.id) } },
      });
      await prisma.$disconnect();
    });

    beforeEach(() => {
      m.fake.reset();
      m.ent.clearEntitlementCache();
      process.env.ENTITLEMENTS_ENFORCEMENT = 'on';
    });

    // =========================================================================
    describe('plan limits are enforced on the server', () => {
      beforeAll(async () => {
        await setPlan(teamA.id, null);
      });

      it('active jobs: the 3rd publish on Free is refused with an upgrade hint; closing frees a slot', async () => {
        await closeAllJobs();

        const [a, b, c] = [
          await jobCreate('ownerA', slugA, 'Job A'),
          await jobCreate('ownerA', slugA, 'Job B'),
          await jobCreate('ownerA', slugA, 'Job C'),
        ];

        expect((await act('ownerA', slugA, a, 'publish')).status).toBe(200);
        expect((await act('ownerA', slugA, b, 'publish')).status).toBe(200);

        const r = await act('ownerA', slugA, c, 'publish');

        expect(r.status).toBe(402);
        expect(r.json.error).toMatchObject({
          code: 'plan_limit',
          limit: 'activeJobs',
          allowed: 2,
          used: 2,
          plan: 'free',
          upgradeTo: 'starter',
        });
        expect(r.json.error.message).toContain('Upgrade to Starter');
        expect(
          (
            await prisma.job.findFirstOrThrow({
              where: { id: c, teamId: teamA.id },
            })
          ).status
        ).toBe('DRAFT');

        // scheduling reserves a slot too
        expect(
          (
            await act('ownerA', slugA, c, 'schedule', {
              publishAt: new Date(Date.now() + 86400_000).toISOString(),
            })
          ).status
        ).toBe(402);

        await act('ownerA', slugA, a, 'close');
        expect((await act('ownerA', slugA, c, 'publish')).status).toBe(200);

        // reopening a closed job needs a free slot as well
        expect((await act('ownerA', slugA, a, 'reopen')).status).toBe(402);
      });

      it('publishing a job that was already scheduled does not count it twice', async () => {
        await closeAllJobs();
        await setPlan(teamA.id, 'starter'); // 5 jobs

        const ids: string[] = [];

        for (let i = 0; i < 5; i++)
          ids.push(await jobCreate('ownerA', slugA, `Starter job ${i}`));

        for (let i = 0; i < 4; i++)
          expect((await act('ownerA', slugA, ids[i], 'publish')).status).toBe(
            200
          );

        expect(
          (
            await act('ownerA', slugA, ids[4], 'schedule', {
              publishAt: new Date(Date.now() + 86400_000).toISOString(),
            })
          ).status
        ).toBe(200);
        // 5 of 5 used, and publishing the scheduled one must still work
        expect((await act('ownerA', slugA, ids[4], 'publish')).status).toBe(
          200
        );
        expect(await m.ent.measure(teamA.id, 'activeJobs')).toBe(5);
        expect(
          (
            await act(
              'ownerA',
              slugA,
              await jobCreate('ownerA', slugA, 'Starter job five'),
              'publish'
            )
          ).status
        ).toBe(402);
        await setPlan(teamA.id, null);
        await closeAllJobs();
      });

      it('team seats: an email invitation reserves a seat; the limit is checked when inviting', async () => {
        await unguarded.invitation.deleteMany({ where: { teamId: teamA.id } });
        await setPlan(teamA.id, null); // Free: 2 seats (owner + memberA)

        const r = await call(m.invitesApi, 'ownerA', {
          method: 'POST',
          query: { slug: slugA },
          body: {
            email: `new1-${run}@p6-test.com`,
            role: 'MEMBER',
            sentViaEmail: true,
          },
        });

        expect(r.status).toBe(402);
        expect(r.json.error).toMatchObject({
          code: 'plan_limit',
          limit: 'seats',
          allowed: 2,
        });

        await setPlan(teamA.id, 'starter');
        expect(
          (
            await call(m.invitesApi, 'ownerA', {
              method: 'POST',
              query: { slug: slugA },
              body: {
                email: `new2-${run}@p6-test.com`,
                role: 'MEMBER',
                sentViaEmail: true,
              },
            })
          ).status
        ).toBe(204);
        expect(await m.ent.measure(teamA.id, 'seats')).toBe(3); // 2 members + 1 pending invitation
        await unguarded.invitation.deleteMany({ where: { teamId: teamA.id } });
        await setPlan(teamA.id, null);
      });

      it('feature gates follow the plan (branding, automation, custom roles, API keys, SSO, own AI key)', async () => {
        const gates = async () => ({
          branding: (
            await call(m.portalApi, 'ownerA', {
              method: 'PUT',
              query: { slug: slugA },
              body: { branding: { primaryColor: '#0F766E' } },
            })
          ).status,
          automation: (
            await call(m.automationApi, 'ownerA', {
              method: 'POST',
              query: { slug: slugA },
              body: {},
            })
          ).status,
          roles: (
            await call(m.rolesApi, 'ownerA', {
              method: 'POST',
              query: { slug: slugA },
              body: {
                name: `Custom ${Math.random().toString(36).slice(2, 6)}`,
                permissions: ['jobs.read'],
              },
            })
          ).status,
          apiKey: (
            await call(m.apiKeysApi, 'ownerA', {
              method: 'POST',
              query: { slug: slugA },
              body: { name: 'k' },
            })
          ).status,
          sso: (
            await call(m.ssoApi, 'ownerA', {
              method: 'POST',
              query: { slug: slugA },
              body: {},
            })
          ).status,
          byoKey: (
            await call(m.aiSettingsApi, 'ownerA', {
              method: 'PUT',
              query: { slug: slugA },
              body: { provider: 'OPENAI', apiKey: 'sk-test-key-123456' },
            })
          ).status,
        });

        await setPlan(teamA.id, 'free');

        const free = await gates();

        expect(Object.values(free).every((s) => s === 402)).toBe(true);

        const r = await call(m.rolesApi, 'ownerA', {
          method: 'POST',
          query: { slug: slugA },
          body: { name: 'Nope', permissions: ['jobs.read'] },
        });

        expect(r.json.error).toMatchObject({
          code: 'plan_feature',
          feature: 'customRoles',
          upgradeTo: 'enterprise',
        });

        await setPlan(teamA.id, 'professional');

        const pro = await gates();

        expect(pro.branding).toBe(200); // allowed
        expect(pro.automation).not.toBe(402); // allowed: fails later on validation (422)
        expect(
          [pro.roles, pro.apiKey, pro.sso, pro.byoKey].every((s) => s === 402)
        ).toBe(true); // enterprise only

        await setPlan(teamA.id, 'enterprise');

        const ent = await gates();

        expect(Object.values(ent).some((s) => s === 402)).toBe(false);
        await prisma.aIProviderConfig.deleteMany({
          where: { teamId: teamA.id },
        }); // the portal's own key from above
        await setPlan(teamA.id, null);
      });

      it('AI: matching and the copilot need Professional; credits come from the plan', async () => {
        await setPlan(teamA.id, 'free');
        const firstJd = await call(m.jdApi, 'ownerA', {
          method: 'POST',
          query: { slug: slugA },
          body: { title: 'Platform Engineer' },
        });

        if (firstJd.status !== 200)
          console.log(
            'JD0',
            firstJd.status,
            JSON.stringify(firstJd.json),
            m.fake.calls.length
          );
        expect(firstJd.status).toBe(200); // ai.assist is on Free

        const cop = await call(m.copilotApi, 'ownerA', {
          method: 'POST',
          query: { slug: slugA },
          body: { messages: [{ role: 'user', content: 'hi' }] },
        });

        expect(cop.status).toBe(402);
        expect(cop.json.error).toMatchObject({
          code: 'plan_feature',
          feature: 'ai.copilot',
          upgradeTo: 'professional',
        });

        // a tiny credit allowance from the platform admin
        await prisma.planEntitlement.upsert({
          where: { plan: 'free' },
          create: {
            plan: 'free',
            limits: {
              activeJobs: 2,
              seats: 2,
              aiCreditsPerMonth: 3,
              storageGb: 1,
            },
            features: ['ai.assist'],
          },
          update: {
            limits: {
              activeJobs: 2,
              seats: 2,
              aiCreditsPerMonth: 3,
              storageGb: 1,
            },
            features: ['ai.assist'],
          },
        });
        m.ent.clearEntitlementCache();
        await prisma.aIUsage.deleteMany({ where: { teamId: teamA.id } });

        const jd = () =>
          call(m.jdApi, 'ownerA', {
            method: 'POST',
            query: { slug: slugA },
            body: { title: 'Platform Engineer' },
          });

        const first = await jd();
        if (first.status !== 200)
          console.log('JD', first.status, JSON.stringify(first.json));
        expect(first.status).toBe(200); // 2 credits
        const over = await jd(); // would be 4 of 3

        expect(over.status).toBe(402);
        expect(over.json.error.message).toContain('credit limit');
        await prisma.planEntitlement.deleteMany();
        m.ent.clearEntitlementCache();
        await setPlan(teamA.id, null);
      });

      it('a failed payment: grace for 7 days, then read-only (reads and billing still work)', async () => {
        await setPlan(teamA.id, null, { planKey: 'professional' });

        const days = (n: number) => new Date(Date.now() - n * 86400_000);

        await unguarded.team.update({
          where: { id: teamA.id },
          data: { paymentFailedAt: days(3) },
        });
        expect(
          (await jobCreate('ownerA', slugA, 'Grace job'.concat(run))).length
        ).toBeGreaterThan(0); // still writable

        const plan = await call(m.planApi, 'ownerA', {
          query: { slug: slugA },
        });

        expect(plan.json.data.lifecycle).toMatchObject({
          inGrace: true,
          readOnly: false,
        });

        await unguarded.team.update({
          where: { id: teamA.id },
          data: { paymentFailedAt: days(8) },
        });

        const blocked = await call(m.jobsApi, 'ownerA', {
          method: 'POST',
          query: { slug: slugA },
          body: {
            title: 'Late job',
            descriptionHtml: DESC,
            workMode: 'REMOTE',
          },
        });

        expect(blocked.status).toBe(402);
        expect(blocked.json.error.code).toBe('read_only');
        expect(
          (await call(m.jobsApi, 'ownerA', { query: { slug: slugA } })).status
        ).toBe(200); // reading works
        expect(
          (await call(m.planApi, 'ownerA', { query: { slug: slugA } })).json
            .data.lifecycle.readOnly
        ).toBe(true);

        // paying clears it
        await m.billing.markPaymentOk(`cus_${run}`).catch(() => undefined);
        await unguarded.team.update({
          where: { id: teamA.id },
          data: { billingId: `cus_${run}` },
        });
        await m.billing.markPaymentOk(`cus_${run}`);
        expect(
          (await jobCreate('ownerA', slugA, 'After paying')).length
        ).toBeGreaterThan(0);
        await setPlan(teamA.id, null, { billingId: null });
      });

      it('with enforcement off nothing is limited', async () => {
        process.env.ENTITLEMENTS_ENFORCEMENT = 'off';
        await closeAllJobs();

        const ids: string[] = [];

        for (let i = 0; i < 4; i++)
          ids.push(await jobCreate('ownerA', slugA, `Free plan job ${i}`));

        for (const id of ids)
          expect((await act('ownerA', slugA, id, 'publish')).status).toBe(200);

        await closeAllJobs();
      });
    });

    // =========================================================================
    describe('billing lifecycle (Stripe webhook logic)', () => {
      const cus = () => `cus_life_${run}`;

      beforeAll(async () => {
        await unguarded.team.update({
          where: { id: teamB.id },
          data: { billingId: cus(), planKey: 'free', paymentFailedAt: null },
        });
        await prisma.price.deleteMany({
          where: { id: { startsWith: `price_${run}` } },
        });

        const svc = await prisma.service.create({
          data: {
            description: 'd',
            features: [],
            image: '',
            name: `svc-${run}`,
            created: new Date(),
          },
        });

        for (const p of ['starter', 'professional']) {
          await prisma.price.create({
            data: {
              id: `price_${run}_${p}`,
              billingScheme: 'per_unit',
              currency: 'inr',
              serviceId: svc.id,
              amount: 100,
              metadata: { plan: p },
              type: 'recurring',
              created: new Date(),
            },
          });
        }
      });

      const sub = (id: string, price: string, active = true) =>
        prisma.subscription.upsert({
          where: { id },
          create: {
            id,
            customerId: cus(),
            priceId: `price_${run}_${price}`,
            active,
            startDate: new Date(),
            endDate: new Date(Date.now() + 30 * 86400_000),
          },
          update: { active, priceId: `price_${run}_${price}` },
        });

      it('the plan follows the active subscription (highest wins) and falls back to Free when it ends', async () => {
        await sub(`sub_${run}_1`, 'starter');
        expect(await m.billing.syncTeamPlan(cus())).toEqual({
          teamId: teamB.id,
          plan: 'starter',
        });

        await sub(`sub_${run}_2`, 'professional');
        expect((await m.billing.syncTeamPlan(cus()))?.plan).toBe(
          'professional'
        );

        await sub(`sub_${run}_2`, 'professional', false);
        expect((await m.billing.syncTeamPlan(cus()))?.plan).toBe('starter');

        await prisma.subscription.deleteMany({ where: { customerId: cus() } });
        expect((await m.billing.syncTeamPlan(cus()))?.plan).toBe('free');
        expect(await m.billing.syncTeamPlan('cus_unknown')).toBeNull();
        expect(m.billing.planOfPrice({ plan: 'platinum' })).toBeNull();
      });

      it('the first failed payment starts the grace period; retries do not restart it; paying ends it', async () => {
        await m.billing.markPaymentFailed(cus());

        const first = (
          await unguarded.team.findUniqueOrThrow({ where: { id: teamB.id } })
        ).paymentFailedAt!;

        await new Promise((r) => setTimeout(r, 15));
        await m.billing.markPaymentFailed(cus());
        expect(
          (
            await unguarded.team.findUniqueOrThrow({ where: { id: teamB.id } })
          ).paymentFailedAt!.getTime()
        ).toBe(first.getTime());

        expect(
          m.ent.planStateOf({
            planKey: 'free',
            planOverride: null,
            paymentFailedAt: new Date(Date.now() - 2 * 86400_000),
          })
        ).toMatchObject({ inGrace: true, readOnly: false });
        expect(
          m.ent.planStateOf({
            planKey: 'free',
            planOverride: null,
            paymentFailedAt: new Date(Date.now() - 9 * 86400_000),
          })
        ).toMatchObject({ inGrace: false, readOnly: true });
        // a platform override is never locked by billing
        expect(
          m.ent.planStateOf({
            planKey: 'free',
            planOverride: 'enterprise',
            paymentFailedAt: new Date(Date.now() - 30 * 86400_000),
          }).readOnly
        ).toBe(false);

        await m.billing.markPaymentOk(cus());
        expect(
          (await unguarded.team.findUniqueOrThrow({ where: { id: teamB.id } }))
            .paymentFailedAt
        ).toBeNull();
      });

      it('a downgrade is blocked while usage exceeds the target plan, and the plan API previews it', async () => {
        await setPlan(teamA.id, 'professional');
        await closeAllJobs();

        const ids: string[] = [];

        for (let i = 0; i < 3; i++)
          ids.push(await jobCreate('ownerA', slugA, `Downgrade job ${i}`));

        for (const id of ids)
          expect((await act('ownerA', slugA, id, 'publish')).status).toBe(200);

        const check = await m.ent.checkDowngrade(teamA.id, 'free');

        expect(check).toEqual({
          allowed: false,
          blockers: [{ limit: 'activeJobs', used: 3, allowed: 2 }],
        });
        expect((await m.ent.checkDowngrade(teamA.id, 'starter')).allowed).toBe(
          true
        );

        const api = await call(m.planApi, 'ownerA', {
          query: { slug: slugA, target: 'free' },
        });

        expect(api.status).toBe(200);
        expect(api.json.data.change).toMatchObject({
          target: 'free',
          allowed: false,
        });
        expect(api.json.data.plan).toBe('professional');
        expect(JSON.stringify(api.json)).not.toMatch(
          /billingId|paymentFailedAt/
        );
        // any member can read it, outsiders cannot
        expect(
          (await call(m.planApi, 'memberA', { query: { slug: slugA } })).status
        ).toBe(200);
        expect(
          (await call(m.planApi, 'ownerB', { query: { slug: slugA } })).status
        ).toBe(403);

        await closeAllJobs();
        await setPlan(teamA.id, null);
      });
    });

    // =========================================================================
    describe('usage metering', () => {
      it('counts jobs published and applications, and reconciles gauges nightly', async () => {
        await setPlan(teamA.id, 'professional');
        await closeAllJobs();
        await unguarded.usageCounter.deleteMany({
          where: { teamId: teamA.id },
        });

        const id = await jobCreate('ownerA', slugA, 'Metered');

        await act('ownerA', slugA, id, 'publish');
        await m.ent.recordUsage(teamA.id, 'applications', 2);
        await m.ent.recordUsage(teamA.id, 'applications');

        const val = async (metric: string) =>
          (
            await prisma.usageCounter.findFirst({
              where: {
                teamId: teamA.id,
                metric,
                periodStart: m.ent.monthStart(),
              },
            })
          )?.value;

        expect(await val('jobs_published')).toBe(1);
        expect(await val('applications')).toBe(3);

        // drift is repaired by the reconciliation
        await prisma.usageCounter.create({
          data: {
            teamId: teamA.id,
            metric: 'activeJobs',
            periodStart: m.ent.monthStart(),
            value: 99,
          },
        });

        const r = await m.ent.reconcileUsage();

        expect(r.teams).toBeGreaterThanOrEqual(2);
        expect(await val('activeJobs')).toBe(1);
        expect(await val('seats')).toBe(2);
        expect(await val('applications')).toBe(3); // monthly counters are left alone

        // the ticker runs it once a day
        await prisma.usageCounter.updateMany({
          where: { teamId: teamA.id, metric: 'activeJobs' },
          data: { value: 42 },
        });
        await m.ticker.runDueTasks(new Date());
        expect(await val('activeJobs')).toBe(1);
        await closeAllJobs();
        await setPlan(teamA.id, null);
      });
    });

    // =========================================================================
    describe('custom domains', () => {
      const fakeDns = (records: {
        txt?: Record<string, string[][]>;
        cname?: Record<string, string[]>;
        a?: Record<string, string[]>;
      }) => ({
        resolveTxt: async (n: string) => {
          if (!records.txt?.[n])
            throw Object.assign(new Error('ENODATA'), { code: 'ENODATA' });

          return records.txt[n];
        },
        resolveCname: async (n: string) => {
          if (!records.cname?.[n])
            throw Object.assign(new Error('ENODATA'), { code: 'ENODATA' });

          return records.cname[n];
        },
        resolve4: async (n: string) => records.a?.[n] ?? [],
      });
      const host = `careers.${run}.example.org`;

      afterEach(() => m.domains.setResolver(null));

      it('normalises hostnames and refuses unsafe ones', () => {
        expect(
          m.domains.normalizeHostname('HTTPS://Careers.Acme.com/jobs?x=1')
        ).toBe('careers.acme.com');
        expect(m.domains.normalizeHostname('careers.acme.com.')).toBe(
          'careers.acme.com'
        );

        for (const bad of [
          'localhost',
          '127.0.0.1',
          '10.0.0.1',
          'acme',
          'a b.com',
          '-bad.example.com',
          'x.local',
          'foo.internal',
          'careers.acme.com:8080',
          'portal.platform.test',
          'platform.test',
          'localhost:3000',
          'a.b',
          '',
          'exa_mple.com',
          'example.c0m',
        ]) {
          expect(() => m.domains.normalizeHostname(bad)).toThrow();
        }
      });

      it('is an Enterprise feature, needs domain.manage, and allows one domain per portal', async () => {
        await setPlan(teamA.id, 'professional');

        const no = await call(m.domainApi, 'ownerA', {
          method: 'POST',
          query: { slug: slugA },
          body: { hostname: host },
        });

        expect(no.status).toBe(402);
        expect(no.json.error).toMatchObject({
          code: 'plan_feature',
          feature: 'customDomain',
        });

        await setPlan(teamA.id, 'enterprise');
        expect(
          (
            await call(m.domainApi, 'memberA', {
              method: 'POST',
              query: { slug: slugA },
              body: { hostname: host },
            })
          ).status
        ).toBe(403);
        expect(
          (
            await call(m.domainApi, 'ownerA', {
              method: 'POST',
              query: { slug: slugA },
              body: { hostname: 'localhost' },
            })
          ).status
        ).toBe(422);

        const ok = await call(m.domainApi, 'ownerA', {
          method: 'POST',
          query: { slug: slugA },
          body: { hostname: host.toUpperCase() },
        });

        expect(ok.status).toBe(201);
        expect(ok.json.data).toMatchObject({
          hostname: host,
          verified: false,
          certificateStatus: 'PENDING',
          url: null,
        });
        expect(ok.json.data.records.txt.name).toBe(`_verify.${host}`);
        expect(ok.json.data.records.txt.value).toMatch(
          /^hc-verify=[0-9a-f]{32}$/
        );
        expect(ok.json.data.records.cname).toEqual({
          name: host,
          value: 'portals.platform.test',
        });
        expect(
          (
            await call(m.domainApi, 'ownerA', {
              method: 'POST',
              query: { slug: slugA },
              body: { hostname: `other.${host}` },
            })
          ).status
        ).toBe(409);
        expect(
          (await call(m.domainApi, 'ownerB', { query: { slug: slugA } })).status
        ).toBe(403);
      });

      it('verifies only with the TXT record AND the CNAME (or a matching A record)', async () => {
        const d = await prisma.portalDomain.findFirstOrThrow({
          where: { teamId: teamA.id },
        });
        const txt = {
          [`_verify.${host}`]: [[`hc-verify=${d.verificationToken}`]],
        };

        m.domains.setResolver(fakeDns({}));

        const none = await call(m.domainVerifyApi, 'ownerA', {
          method: 'POST',
          query: { slug: slugA },
        });

        expect(none.json.data).toMatchObject({ verified: false });
        expect(none.json.data.lastError).toContain('TXT record');

        m.domains.setResolver(fakeDns({ txt }));
        expect(
          (
            await call(m.domainVerifyApi, 'ownerA', {
              method: 'POST',
              query: { slug: slugA },
            })
          ).json.data.lastError
        ).toContain('does not point to portals.platform.test');

        // a TXT with the wrong token is not enough
        m.domains.setResolver(
          fakeDns({
            txt: { [`_verify.${host}`]: [['hc-verify=deadbeef']] },
            cname: { [host]: ['portals.platform.test.'] },
          })
        );
        expect(
          (
            await call(m.domainVerifyApi, 'ownerA', {
              method: 'POST',
              query: { slug: slugA },
            })
          ).json.data.verified
        ).toBe(false);

        m.domains.setResolver(
          fakeDns({ txt, cname: { [host]: ['Portals.Platform.Test.'] } })
        );

        const ok = await call(m.domainVerifyApi, 'ownerA', {
          method: 'POST',
          query: { slug: slugA },
        });

        expect(ok.status).toBe(200);
        expect(ok.json.data).toMatchObject({
          verified: true,
          certificateStatus: 'READY',
          url: `https://${host}`,
          lastError: null,
        });
        expect(await m.domains.resolveVerifiedHost(host)).toEqual({
          slug: slugA,
          suspended: false,
        });
      });

      it('a verified host belongs to one portal: others cannot claim or verify it', async () => {
        await setPlan(teamB.id, 'enterprise');

        const steal = await call(m.domainApi, 'ownerB', {
          method: 'POST',
          query: { slug: slugB },
          body: { hostname: host },
        });

        expect(steal.status).toBe(409);
        expect(
          await unguarded.portalDomain.count({ where: { hostname: host } })
        ).toBe(1);

        // the database itself refuses a second verified row
        await expect(
          unguarded.portalDomain.create({
            data: {
              teamId: teamB.id,
              hostname: host,
              verificationToken: 'x',
              verifiedAt: new Date(),
            },
          })
        ).rejects.toThrow();

        await setPlan(teamB.id, null);
      });

      it('serves the portal slug to the proxy / middleware only for verified, known hosts', async () => {
        const ok = await call(m.resolveApi, null, { query: { host } });

        expect(ok.status).toBe(200);
        expect(ok.json.data).toEqual({ slug: slugA });
        expect(
          (
            await call(m.resolveApi, null, {
              query: { domain: host.toUpperCase() },
            })
          ).status
        ).toBe(200);
        expect(
          (
            await call(m.resolveApi, null, {
              query: { host: 'unknown.example.org' },
            })
          ).status
        ).toBe(404);
        expect((await call(m.resolveApi, null, { query: {} })).status).toBe(
          404
        );
        expect(JSON.stringify(ok.json)).not.toMatch(/token|team/i);
      });

      it('releases a host after two failed nightly checks, so a dropped domain cannot block its next owner', async () => {
        m.domains.setResolver(fakeDns({}));

        const first = await m.domains.recheckDomains();

        expect(first.released).toBe(0);
        expect(
          (
            await prisma.portalDomain.findFirstOrThrow({
              where: { teamId: teamA.id },
            })
          ).lastError
        ).toBeTruthy();
        expect(await m.domains.resolveVerifiedHost(host)).not.toBeNull(); // one failure is tolerated

        const second = await m.domains.recheckDomains();

        expect(second.released).toBe(1);
        expect(await m.domains.resolveVerifiedHost(host)).toBeNull();
      });

      it('removes the domain', async () => {
        expect(
          (
            await call(m.domainApi, 'ownerA', {
              method: 'DELETE',
              query: { slug: slugA },
            })
          ).status
        ).toBe(200);
        expect(
          await prisma.portalDomain.count({ where: { teamId: teamA.id } })
        ).toBe(0);
        await setPlan(teamA.id, null);
      });
    });

    // =========================================================================
    describe('platform admin', () => {
      beforeAll(async () => {
        // the admin accounts: verified e-mail on the allow-list
        await prisma.user
          .update({
            where: { id: users.admin1.id },
            data: {
              email: 'root-admin@p6-test.com',
              emailVerified: new Date(),
            },
          })
          .catch(async () => {
            await prisma.user.deleteMany({
              where: { email: 'root-admin@p6-test.com' },
            });
            await prisma.user.update({
              where: { id: users.admin1.id },
              data: {
                email: 'root-admin@p6-test.com',
                emailVerified: new Date(),
              },
            });
          });
        users.admin1.email = 'root-admin@p6-test.com';
      });

      it('is a separate role: portal owners, other users and unverified accounts are refused', async () => {
        for (const who of ['ownerA', 'memberA', 'plainAdmin']) {
          expect((await call(m.adminTenants, who)).status).toBe(403);
          expect((await call(m.adminPlans, who)).status).toBe(403);
          expect((await call(m.adminAudit, who)).status).toBe(403);
          expect(
            (
              await call(m.adminTenant, who, {
                method: 'PATCH',
                query: { id: teamA.id },
                body: { status: 'SUSPENDED' },
              })
            ).status
          ).toBe(403);
        }

        expect((await call(m.adminTenants, null)).status).toBe(401);

        // right e-mail, not verified
        await prisma.user
          .update({
            where: { id: users.unverifiedAdmin.id },
            data: { email: 'other-root@p6-test.com', emailVerified: null },
          })
          .catch(() => undefined);
        users.unverifiedAdmin.email = 'other-root@p6-test.com';
        expect((await call(m.adminTenants, 'unverifiedAdmin')).status).toBe(
          403
        );
        await prisma.user.update({
          where: { id: users.unverifiedAdmin.id },
          data: { email: `dup2-${run}@p6-test.com` },
        });
      });

      it('lists tenants with plan, usage and status, searchable, with headline numbers', async () => {
        const r = await call(m.adminTenants, 'admin1');

        expect(r.status).toBe(200);
        expect(r.json.data.stats).toEqual(
          expect.objectContaining({
            activePortals: expect.any(Number),
            paidPlans: expect.any(Number),
            paymentIssues: expect.any(Number),
            aiCreditsThisMonth: expect.any(Number),
          })
        );

        const row = r.json.data.tenants.find(
          (t: { slug: string }) => t.slug === slugA
        );

        expect(row).toMatchObject({
          name: 'Acme P6',
          status: 'ACTIVE',
          plan: 'free',
          owner: { email: users.ownerA.email },
        });
        expect(row.usage).toEqual(
          expect.objectContaining({ activeJobs: expect.any(Number), seats: 2 })
        );
        expect(JSON.stringify(row)).not.toMatch(/password|billingId/);

        const q = await call(m.adminTenants, 'admin1', {
          query: { q: `p6b-${run}` },
        });

        expect(
          q.json.data.tenants.map((t: { slug: string }) => t.slug)
        ).toEqual([slugB]);
      });

      it('suspends a portal: tenant APIs answer 403, public pages show the notice; activating restores it', async () => {
        const r = await call(m.adminTenant, 'admin1', {
          method: 'PATCH',
          query: { id: teamA.id },
          body: { status: 'SUSPENDED', reason: 'spam job posts' },
        });

        expect(r.status).toBe(200);

        const locked = await call(m.jobsApi, 'ownerA', {
          query: { slug: slugA },
        });

        expect(locked.status).toBe(403);
        expect(locked.json.error.message).toContain('spam job posts');
        expect(
          (await call(m.planApi, 'memberA', { query: { slug: slugA } })).status
        ).toBe(403);

        const { getPublicPortal } =
          require('models/publicPortal') as typeof import('models/publicPortal');

        expect((await getPublicPortal(slugA))?.suspended).toBe(true);
        expect(
          await m.domains.resolveVerifiedHost('nope.example.org')
        ).toBeNull();

        await call(m.adminTenant, 'admin1', {
          method: 'PATCH',
          query: { id: teamA.id },
          body: { status: 'ACTIVE' },
        });
        expect(
          (await call(m.jobsApi, 'ownerA', { query: { slug: slugA } })).status
        ).toBe(200);
        expect(
          (await prisma.team.findUniqueOrThrow({ where: { id: teamA.id } }))
            .suspendedReason
        ).toBeNull();
      });

      it('overrides a plan and edits plan limits; both take effect and are validated', async () => {
        expect(
          (
            await call(m.adminTenant, 'admin1', {
              method: 'PATCH',
              query: { id: teamA.id },
              body: { planOverride: 'platinum' },
            })
          ).status
        ).toBe(422);
        expect(
          (
            await call(m.adminTenant, 'admin1', {
              method: 'PATCH',
              query: { id: teamA.id },
              body: {},
            })
          ).status
        ).toBe(422);
        expect(
          (
            await call(m.adminTenant, 'admin1', {
              method: 'PATCH',
              query: { id: 'nope' },
              body: { status: 'ACTIVE' },
            })
          ).status
        ).toBe(404);

        await call(m.adminTenant, 'admin1', {
          method: 'PATCH',
          query: { id: teamA.id },
          body: { planOverride: 'enterprise' },
        });
        expect(
          (await call(m.planApi, 'ownerA', { query: { slug: slugA } })).json
            .data.plan
        ).toBe('enterprise');
        await call(m.adminTenant, 'admin1', {
          method: 'PATCH',
          query: { id: teamA.id },
          body: { planOverride: null },
        });
        expect(
          (await call(m.planApi, 'ownerA', { query: { slug: slugA } })).json
            .data.plan
        ).toBe('free');

        const list = await call(m.adminPlans, 'admin1');

        expect(list.json.data.plans.map((p: { key: string }) => p.key)).toEqual(
          ['free', 'starter', 'professional', 'enterprise']
        );

        const bad = await call(m.adminPlans, 'admin1', {
          method: 'PUT',
          body: {
            plan: 'free',
            limits: {
              activeJobs: -1,
              seats: 2,
              aiCreditsPerMonth: 1,
              storageGb: 1,
            },
            features: [],
          },
        });

        expect(bad.status).toBe(422);
        expect(
          (
            await call(m.adminPlans, 'admin1', {
              method: 'PUT',
              body: {
                plan: 'free',
                limits: {
                  activeJobs: 2,
                  seats: 2,
                  aiCreditsPerMonth: 1,
                  storageGb: 1,
                },
                features: ['made.up'],
              },
            })
          ).status
        ).toBe(422);

        const put = await call(m.adminPlans, 'admin1', {
          method: 'PUT',
          body: {
            plan: 'free',
            limits: {
              activeJobs: 1,
              seats: 2,
              aiCreditsPerMonth: 500,
              storageGb: 1,
            },
            features: ['ai.assist'],
          },
        });

        expect(put.status).toBe(200);

        // the new Free limit applies at once
        await closeAllJobs();

        const [a, b] = [
          await jobCreate('ownerA', slugA, 'Limit job one'),
          await jobCreate('ownerA', slugA, 'Limit job two'),
        ];

        expect((await act('ownerA', slugA, a, 'publish')).status).toBe(200);
        expect((await act('ownerA', slugA, b, 'publish')).status).toBe(402);

        await prisma.planEntitlement.deleteMany();
        m.ent.clearEntitlementCache();
        await closeAllJobs();
      });

      it('sets the platform default AI provider without ever returning the key', async () => {
        const key = 'sk-platform-key-9876543210';
        const r = await call(m.adminAi, 'admin1', {
          method: 'PUT',
          body: {
            provider: 'ANTHROPIC',
            apiKey: key,
            modelByTier: { fast: 'claude-haiku-5-5' },
          },
        });

        expect(r.status).toBe(200);
        expect(JSON.stringify(r.json)).not.toContain(key);
        expect(r.json.data).toMatchObject({
          provider: 'ANTHROPIC',
          hasKey: true,
          keyHint: '...3210',
        });

        const row = await prisma.aIProviderConfig.findFirstOrThrow({
          where: { teamId: null },
        });

        expect(row.encryptedApiKey).not.toContain(key);
        expect((await call(m.adminAi, 'ownerA')).status).toBe(403);
        expect(
          (
            await call(m.adminAi, 'admin1', {
              method: 'PUT',
              body: {
                provider: 'OPENAI_COMPATIBLE',
                baseUrl: 'http://127.0.0.1/v1',
              },
            })
          ).status
        ).toBe(422);

        const cleared = await call(m.adminAi, 'admin1', {
          method: 'PUT',
          body: { provider: 'ANTHROPIC', clearKey: true },
        });

        if (!cleared.json?.data)
          console.log('ADMINAI', cleared.status, JSON.stringify(cleared.json));
        expect(cleared.json.data.hasKey).toBe(false);
        await prisma.aIProviderConfig.deleteMany({ where: { teamId: null } });
      });

      it('writes every admin action to the audit log', async () => {
        const r = await call(m.adminAudit, 'admin1');

        expect(r.status).toBe(200);

        const actions = r.json.data.map((l: { action: string }) => l.action);

        expect(actions).toEqual(
          expect.arrayContaining([
            'tenant.suspend',
            'tenant.activate',
            'tenant.plan_override',
            'plan.update',
            'ai.default.update',
          ])
        );

        const susp = r.json.data.find(
          (l: { action: string }) => l.action === 'tenant.suspend'
        );

        expect(susp).toMatchObject({
          actorEmail: 'root-admin@p6-test.com',
          targetTeamId: teamA.id,
          details: { slug: slugA, reason: 'spam job posts' },
        });
      });
    });

    // =========================================================================
    describe('integrations: calendar OAuth and interview sync', () => {
      const realFetch = global.fetch;
      let calls: {
        url: string;
        method: string;
        body: any;
        auth: string | null;
      }[] = [];
      let behave: (
        url: string,
        method: string
      ) => { status: number; json?: unknown } = () => ({
        status: 200,
        json: {},
      });
      let applicationId = '';
      let participantId = '';

      const connect = async (provider = 'google_calendar', video = true) => {
        await unguarded.integration.deleteMany({ where: { teamId: teamA.id } });
        await prisma.integration.create({
          data: {
            teamId: teamA.id,
            provider,
            kind: 'calendar',
            status: 'CONNECTED',
            accountLabel: 'hr@acme.test',
            config: { video },
            connectedById: users.ownerA.id,
            encryptedCredentials: require('@/lib/ai/crypto').encryptSecret(
              JSON.stringify({
                accessToken: 'at-1',
                refreshToken: 'rt-1',
                expiresAt: Date.now() + 3600_000,
              })
            ),
          },
        });
      };

      beforeAll(async () => {
        await setPlan(teamA.id, 'professional');

        const role = await prisma.portalRole.findFirstOrThrow({
          where: { teamId: teamA.id, key: 'interviewer' },
        });

        await mkUser('ivP6');
        await prisma.teamMember.create({
          data: {
            teamId: teamA.id,
            userId: users.ivP6.id,
            role: role.baseRole,
            portalRoleId: role.id,
          },
        });
        participantId = users.ivP6.id;

        const job = await jobCreate('ownerA', slugA, 'Calendar job');

        await act('ownerA', slugA, job, 'publish');

        const cand = await prisma.user.create({
          data: {
            name: 'Cal Candidate',
            email: `cal-${run}@cand6.com`,
            emailVerified: new Date(),
          },
        });
        const tc = await prisma.tenantCandidate.create({
          data: {
            teamId: teamA.id,
            userId: cand.id,
            name: 'Cal Candidate',
            email: cand.email,
            source: 'portal',
          },
        });
        const stage = await prisma.pipelineStage.findFirstOrThrow({
          where: { teamId: teamA.id, jobId: null, name: 'Applied' },
        });
        const app = await prisma.jobApplication.create({
          data: {
            teamId: teamA.id,
            jobId: job,
            tenantCandidateId: tc.id,
            stageId: stage.id,
            answers: [],
          },
        });

        applicationId = app.id;
        users.cal = { id: cand.id, email: cand.email, name: cand.name };
      });

      beforeEach(() => {
        calls = [];
        behave = () => ({ status: 200, json: {} });
        global.fetch = jest.fn(async (url: any, init: any = {}) => {
          const body =
            init.body &&
            typeof init.body === 'string' &&
            init.body.startsWith('{')
              ? JSON.parse(init.body)
              : init.body;

          calls.push({
            url: String(url),
            method: init.method ?? 'GET',
            body,
            auth: init.headers?.Authorization ?? null,
          });

          const r = behave(String(url), init.method ?? 'GET');

          return {
            ok: r.status < 400,
            status: r.status,
            json: async () => r.json ?? {},
          } as Response;
        }) as never;
      });

      afterAll(() => {
        global.fetch = realFetch;
      });

      const schedule = (body: Record<string, unknown> = {}) =>
        call(m.interviewsApi, 'ownerA', {
          method: 'POST',
          query: { slug: slugA, applicationId },
          body: {
            startsAt: new Date(Date.now() + 2 * 86400_000).toISOString(),
            participantIds: [participantId],
            ...body,
          },
        });

      it('lists providers with entitlement and server availability, never secrets', async () => {
        await connect();

        const r = await call(m.integrationsApi, 'ownerA', {
          query: { slug: slugA },
        });

        expect(r.status).toBe(200);

        const g = r.json.data.find(
          (p: { key: string }) => p.key === 'google_calendar'
        );

        expect(g).toMatchObject({
          connected: true,
          entitled: true,
          availableOnServer: true,
          accountLabel: 'hr@acme.test',
          kind: 'calendar',
        });
        expect(JSON.stringify(r.json)).not.toMatch(/at-1|rt-1|encrypted/i);
        expect(
          r.json.data.find((p: { key: string }) => p.key === 'assessment')
            .entitled
        ).toBe(false); // Enterprise only
        expect(
          (await call(m.integrationsApi, 'memberA', { query: { slug: slugA } }))
            .status
        ).toBe(403);
        expect(
          (await call(m.integrationsApi, 'ownerB', { query: { slug: slugA } }))
            .status
        ).toBe(403);
      });

      it('starts OAuth with a signed state and a cookie nonce; the plan and server config are checked', async () => {
        const r = await call(m.integrationApi, 'ownerA', {
          method: 'POST',
          query: { slug: slugA, provider: 'google_calendar' },
        });

        expect(r.status).toBe(200);

        const u = new URL(r.json.data.url);

        expect(u.origin + u.pathname).toBe(
          'https://accounts.google.com/o/oauth2/v2/auth'
        );
        expect(u.searchParams.get('client_id')).toBe('google-client');
        expect(u.searchParams.get('redirect_uri')).toBe(
          'http://localhost:4002/api/integrations/callback/google_calendar'
        );
        expect(u.searchParams.get('scope')).toContain('calendar.events');
        expect(u.searchParams.get('access_type')).toBe('offline');
        expect(String(r.headers['set-cookie'])).toMatch(
          /hc_oauth=[0-9a-f]{32}; Path=\/api\/integrations; HttpOnly; SameSite=Lax/
        );

        const st = m.oauth.verifyState(u.searchParams.get('state') as string);

        expect(st).toMatchObject({
          teamId: teamA.id,
          userId: users.ownerA.id,
          provider: 'google_calendar',
        });

        const ms = await call(m.integrationApi, 'ownerA', {
          method: 'POST',
          query: { slug: slugA, provider: 'microsoft_calendar' },
        });

        expect(new URL(ms.json.data.url).origin).toBe(
          'https://login.microsoftonline.com'
        );

        await setPlan(teamA.id, 'free');
        expect(
          (
            await call(m.integrationApi, 'ownerA', {
              method: 'POST',
              query: { slug: slugA, provider: 'google_calendar' },
            })
          ).status
        ).toBe(402);
        await setPlan(teamA.id, 'professional');
        expect(
          (
            await call(m.integrationApi, 'ownerA', {
              method: 'POST',
              query: { slug: slugA, provider: 'nope' },
            })
          ).status
        ).toBe(404);
        expect(
          (
            await call(m.integrationApi, 'ownerA', {
              method: 'POST',
              query: { slug: slugA, provider: 'assessment' },
            })
          ).status
        ).toBe(422);
      });

      it('the callback stores encrypted tokens, and rejects tampered, foreign or replayed states', async () => {
        await unguarded.integration.deleteMany({ where: { teamId: teamA.id } });

        const start = await call(m.integrationApi, 'ownerA', {
          method: 'POST',
          query: { slug: slugA, provider: 'google_calendar' },
        });
        const state = new URL(start.json.data.url).searchParams.get(
          'state'
        ) as string;
        const nonce = String(start.headers['set-cookie']).match(
          /hc_oauth=([0-9a-f]+)/
        )![1];

        behave = (url) =>
          url.includes('oauth2.googleapis.com/token')
            ? {
                status: 200,
                json: {
                  access_token: 'ACCESS-TOKEN-XYZ',
                  refresh_token: 'REFRESH-TOKEN-XYZ',
                  expires_in: 3600,
                },
              }
            : { status: 200, json: { email: 'hr@acme.test' } };

        const cb = (
          as: string | null,
          q: Record<string, string>,
          cookie?: string
        ) =>
          call(m.callbackApi, as, {
            query: { provider: 'google_calendar', ...q },
            headers: cookie ? { cookie: `hc_oauth=${cookie}` } : {},
          });

        expect((await cb(null, { code: 'c', state })).status).toBe(401);
        expect(
          (await cb('ownerA', { code: 'c', state: `${state}x` }, nonce)).status
        ).toBe(400); // tampered
        expect(
          (await cb('ownerA', { code: 'c', state }, 'f'.repeat(32))).status
        ).toBe(400); // another browser
        expect((await cb('memberA', { code: 'c', state }, nonce)).status).toBe(
          400
        ); // another user
        expect(
          await prisma.integration.count({ where: { teamId: teamA.id } })
        ).toBe(0);

        const ok = await cb('ownerA', { code: 'auth-code', state }, nonce);

        expect(ok.status).toBe(302);
        expect(ok.redirect).toBe(
          `/teams/${slugA}/settings/integrations?connected=google_calendar`
        );

        const tokenCall = calls.find((c) =>
          c.url.includes('oauth2.googleapis.com/token')
        )!;

        expect(tokenCall.body).toContain('code=auth-code');
        expect(tokenCall.body).toContain('client_secret=google-secret');

        const row = await prisma.integration.findFirstOrThrow({
          where: { teamId: teamA.id },
        });

        expect(row).toMatchObject({
          provider: 'google_calendar',
          status: 'CONNECTED',
          accountLabel: 'hr@acme.test',
          connectedById: users.ownerA.id,
        });
        expect(row.encryptedCredentials).not.toMatch(
          /ACCESS-TOKEN|REFRESH-TOKEN/
        );
        expect(
          require('@/lib/ai/crypto').decryptSecret(row.encryptedCredentials)
        ).toContain('REFRESH-TOKEN-XYZ');

        // an expired state is refused
        const old = m.oauth.signState({
          teamId: teamA.id,
          userId: users.ownerA.id,
          provider: 'google_calendar',
          nonce,
          exp: Date.now() - 1000,
        });

        expect(
          (await cb('ownerA', { code: 'c', state: old }, nonce)).status
        ).toBe(400);
        // the provider's error redirect goes home without storing anything
        expect(
          (await cb('ownerA', { error: 'access_denied', state })).status
        ).toBe(302);
      });

      it('a user who lost integrations.manage cannot finish a flow they started earlier', async () => {
        const start = await call(m.integrationApi, 'ownerA', {
          method: 'POST',
          query: { slug: slugA, provider: 'google_calendar' },
        });
        const state = new URL(start.json.data.url).searchParams.get(
          'state'
        ) as string;
        const nonce = String(start.headers['set-cookie']).match(
          /hc_oauth=([0-9a-f]+)/
        )![1];
        const forged = m.oauth.signState({
          teamId: teamA.id,
          userId: users.memberA.id,
          provider: 'google_calendar',
          nonce,
          exp: Date.now() + 60_000,
        });

        void state;
        behave = () => ({
          status: 200,
          json: { access_token: 'a', refresh_token: 'r', expires_in: 3600 },
        });

        const r = await call(m.callbackApi, 'memberA', {
          query: { provider: 'google_calendar', code: 'c', state: forged },
          headers: { cookie: `hc_oauth=${nonce}` },
        });

        expect(r.status).toBe(403);
      });

      it('scheduling an interview creates a calendar event for the STAFF only, with a Meet link', async () => {
        await connect();
        behave = () => ({
          status: 200,
          json: {
            id: 'evt-1',
            hangoutLink: 'https://meet.google.com/abc-defg-hij',
          },
        });

        const r = await schedule();

        expect(r.status).toBe(201);

        const create = calls.find(
          (c) =>
            c.method === 'POST' && c.url.includes('/calendars/primary/events')
        )!;

        expect(create.auth).toBe('Bearer at-1');
        expect(create.url).toContain('conferenceDataVersion=1');
        expect(create.body.attendees).toEqual([{ email: users.ivP6.email }]);
        expect(JSON.stringify(create.body)).not.toContain(users.cal.email); // the candidate is invited through an approved draft
        expect(
          create.body.conferenceData.createRequest.conferenceSolutionKey.type
        ).toBe('hangoutsMeet');
        expect(create.body.summary).toContain('Cal Candidate');

        const row = await prisma.interview.findFirstOrThrow({
          where: { teamId: teamA.id, id: r.json.data.id },
        });

        expect(row.calendarEventIds).toEqual({
          provider: 'google_calendar',
          id: 'evt-1',
        });
        expect(row.meetingUrl).toBe('https://meet.google.com/abc-defg-hij');
        // the candidate's message is still a draft
        expect(
          await prisma.messageDraft.count({
            where: {
              teamId: teamA.id,
              applicationId,
              status: 'DRAFT',
              kind: 'INTERVIEW_INVITE',
            },
          })
        ).toBeGreaterThan(0);
      });

      it('rescheduling replaces the event; cancelling deletes it', async () => {
        await connect();

        let n = 0;

        behave = (_url, method) =>
          method === 'POST'
            ? { status: 200, json: { id: `evt-${++n}` } }
            : { status: 204 };

        const r = await schedule({ meetingUrl: 'https://zoom.example/own' });
        const id = r.json.data.id as string;

        expect(
          calls.find((c) => c.method === 'POST')!.body.conferenceData
        ).toBeUndefined(); // an existing link is kept
        expect(
          (
            await prisma.interview.findFirstOrThrow({
              where: { id, teamId: teamA.id },
            })
          ).meetingUrl
        ).toBe('https://zoom.example/own');

        calls.length = 0;
        await call(m.interviewApi, 'ownerA', {
          method: 'PUT',
          query: { slug: slugA, interviewId: id },
          body: {
            startsAt: new Date(Date.now() + 3 * 86400_000).toISOString(),
          },
        });
        expect(calls.map((c) => c.method)).toEqual(['DELETE', 'POST']);
        expect(
          (
            await prisma.interview.findFirstOrThrow({
              where: { id, teamId: teamA.id },
            })
          ).calendarEventIds
        ).toEqual({ provider: 'google_calendar', id: 'evt-2' });

        calls.length = 0;
        await call(m.interviewApi, 'ownerA', {
          method: 'PUT',
          query: { slug: slugA, interviewId: id },
          body: { status: 'CANCELLED' },
        });
        expect(calls.map((c) => c.method)).toEqual(['DELETE']);
        expect(calls[0].url).toContain('/events/evt-2');
        expect(
          (
            await prisma.interview.findFirstOrThrow({
              where: { id, teamId: teamA.id },
            })
          ).calendarEventIds
        ).toBeNull();
      });

      it('a calendar outage never fails the interview; the problem is shown on the integration', async () => {
        await connect();
        behave = () => ({ status: 500 });

        const r = await schedule();

        expect(r.status).toBe(201);
        expect(
          (
            await prisma.integration.findFirstOrThrow({
              where: { teamId: teamA.id },
            })
          ).lastError
        ).toContain('Google Calendar failed (500)');
        expect(
          (
            await prisma.interview.findFirstOrThrow({
              where: { id: r.json.data.id, teamId: teamA.id },
            })
          ).calendarEventIds
        ).toBeNull();
      });

      it('refreshes an expired access token and keeps working', async () => {
        await connect();
        await prisma.integration.updateMany({
          where: { teamId: teamA.id },
          data: {
            encryptedCredentials: require('@/lib/ai/crypto').encryptSecret(
              JSON.stringify({
                accessToken: 'old',
                refreshToken: 'rt-1',
                expiresAt: Date.now() - 1000,
              })
            ),
          },
        });
        behave = (url) =>
          url.includes('oauth2.googleapis.com/token')
            ? {
                status: 200,
                json: { access_token: 'fresh-token', expires_in: 3600 },
              }
            : { status: 200, json: { id: 'evt-9' } };

        await schedule();

        expect(
          calls.find((c) => c.url.includes('oauth2.googleapis.com/token'))!.body
        ).toContain('grant_type=refresh_token');
        expect(calls.find((c) => c.url.includes('/events'))!.auth).toBe(
          'Bearer fresh-token'
        );
        expect(
          require('@/lib/ai/crypto').decryptSecret(
            (
              await prisma.integration.findFirstOrThrow({
                where: { teamId: teamA.id },
              })
            ).encryptedCredentials
          )
        ).toContain('"refreshToken":"rt-1"');
      });

      it('Outlook creates a Teams meeting; a portal that lost the feature is skipped quietly', async () => {
        await connect('microsoft_calendar');
        behave = () => ({
          status: 200,
          json: {
            id: 'ms-1',
            onlineMeeting: {
              joinUrl: 'https://teams.microsoft.com/l/meetup-join/x',
            },
          },
        });

        const r = await schedule();
        const create = calls.find((c) =>
          c.url.includes('graph.microsoft.com/v1.0/me/events')
        )!;

        expect(create.body).toMatchObject({
          isOnlineMeeting: true,
          onlineMeetingProvider: 'teamsForBusiness',
        });
        expect(create.body.attendees[0].emailAddress.address).toBe(
          users.ivP6.email
        );
        expect(
          (
            await prisma.interview.findFirstOrThrow({
              where: { id: r.json.data.id, teamId: teamA.id },
            })
          ).meetingUrl
        ).toContain('teams.microsoft.com');

        calls.length = 0;
        await setPlan(teamA.id, 'free');
        expect((await schedule()).status).toBe(201);
        expect(calls).toHaveLength(0);
        await setPlan(teamA.id, 'professional');
      });

      it('turning meeting links off, and disconnecting, are respected', async () => {
        await connect('google_calendar', true);

        const off = await call(m.integrationApi, 'ownerA', {
          method: 'PUT',
          query: { slug: slugA, provider: 'google_calendar' },
          body: { video: false },
        });

        expect(off.status).toBe(200);
        await schedule();
        expect(
          calls.find((c) => c.url.includes('/events'))!.body.conferenceData
        ).toBeUndefined();

        expect(
          (
            await call(m.integrationApi, 'ownerA', {
              method: 'DELETE',
              query: { slug: slugA, provider: 'google_calendar' },
            })
          ).status
        ).toBe(200);
        expect(
          await prisma.integration.count({ where: { teamId: teamA.id } })
        ).toBe(0);
        expect(
          (
            await call(m.integrationApi, 'memberA', {
              method: 'DELETE',
              query: { slug: slugA, provider: 'google_calendar' },
            })
          ).status
        ).toBe(403);
      });
    });

    // =========================================================================
    describe('integrations: assessment and background-check partners', () => {
      const realFetch = global.fetch;
      let sent: {
        url: string;
        headers: Record<string, string>;
        body: string;
      }[] = [];
      let applicationId = '';
      let reply: { status: number; json?: unknown } = {
        status: 200,
        json: { id: 'ext-1' },
      };

      beforeAll(async () => {
        await setPlan(teamA.id, 'enterprise');

        const job = await jobCreate('ownerA', slugA, 'Partner job');

        await act('ownerA', slugA, job, 'publish');

        const cand = await prisma.user.create({
          data: {
            name: 'Pat Partner',
            email: `pat-${run}@cand6.com`,
            emailVerified: new Date(),
          },
        });
        const tc = await prisma.tenantCandidate.create({
          data: {
            teamId: teamA.id,
            userId: cand.id,
            name: 'Pat Partner',
            email: cand.email,
            source: 'portal',
          },
        });
        const stage = await prisma.pipelineStage.findFirstOrThrow({
          where: { teamId: teamA.id, jobId: null, name: 'Applied' },
        });

        applicationId = (
          await prisma.jobApplication.create({
            data: {
              teamId: teamA.id,
              jobId: job,
              tenantCandidateId: tc.id,
              stageId: stage.id,
              answers: [],
            },
          })
        ).id;
      });

      beforeEach(() => {
        sent = [];
        reply = { status: 200, json: { id: 'ext-1' } };
        global.fetch = jest.fn(async (url: any, init: any) => {
          sent.push({
            url: String(url),
            headers: init.headers,
            body: init.body,
          });

          return {
            ok: reply.status < 400,
            status: reply.status,
            json: async () => reply.json ?? {},
          } as Response;
        }) as never;
      });

      afterAll(async () => {
        global.fetch = realFetch;
        await setPlan(teamA.id, null);
      });

      const save = (
        provider: string,
        body: Record<string, unknown>,
        as = 'ownerA'
      ) =>
        call(m.integrationApi, as, {
          method: 'PUT',
          query: { slug: slugA, provider },
          body,
        });
      const request = (
        kind: string,
        body: Record<string, unknown> = {},
        as = 'ownerA'
      ) =>
        call(m.partnerApi, as, {
          method: 'POST',
          query: { slug: slugA, applicationId },
          body: { kind, ...body },
        });

      it('is Enterprise only, and the URL must be a public https address', async () => {
        await setPlan(teamA.id, 'professional');
        expect(
          (
            await save('assessment', {
              url: 'https://93.184.216.34/hooks',
              secret: 'a-long-enough-secret',
            })
          ).status
        ).toBe(402);
        await setPlan(teamA.id, 'enterprise');

        for (const url of [
          'http://93.184.216.34/hooks',
          'https://127.0.0.1/hooks',
          'https://169.254.169.254/latest',
          'https://10.0.0.5/x',
          'not a url',
        ]) {
          expect([422, 400]).toContain(
            (await save('assessment', { url, secret: 'a-long-enough-secret' }))
              .status
          );
        }

        expect(
          (await save('assessment', { url: 'https://93.184.216.34/hooks' }))
            .status
        ).toBe(422); // a signing secret is required
        expect(
          (
            await save('assessment', {
              url: 'https://93.184.216.34/hooks',
              secret: 'short',
            })
          ).status
        ).toBeGreaterThanOrEqual(400);
        expect(
          (
            await save(
              'assessment',
              {
                url: 'https://93.184.216.34/hooks',
                secret: 'a-long-enough-secret',
              },
              'memberA'
            )
          ).status
        ).toBe(403);
      });

      it('stores the secret encrypted, never returns it, and keeps it when only the URL changes', async () => {
        const r = await save('assessment', {
          url: 'https://93.184.216.34/hooks',
          secret: 'my-super-secret-value-1',
        });

        expect(r.status).toBe(200);
        expect(JSON.stringify(r.json)).not.toContain('my-super-secret-value-1');
        expect(
          r.json.data.find((p: { key: string }) => p.key === 'assessment')
        ).toMatchObject({
          connected: true,
          config: { url: 'https://93.184.216.34/hooks', hasSecret: true },
        });

        const row = await prisma.integration.findFirstOrThrow({
          where: { teamId: teamA.id, provider: 'assessment' },
        });

        expect(row.encryptedCredentials).not.toContain(
          'my-super-secret-value-1'
        );

        await save('assessment', { url: 'https://93.184.216.34/v2/hooks' });
        expect(
          JSON.parse(
            require('@/lib/ai/crypto').decryptSecret(
              (
                await prisma.integration.findFirstOrThrow({
                  where: { teamId: teamA.id, provider: 'assessment' },
                })
              ).encryptedCredentials
            )
          ).secret
        ).toBe('my-super-secret-value-1');
      });

      it('sends a signed request, records it on the application, and only for people who may manage it', async () => {
        const r = await request('assessment');

        expect(r.status).toBe(200);
        expect(r.json.data).toEqual({
          externalId: 'ext-1',
          status: 'REQUESTED',
        });

        const s = sent[0];

        expect(s.url).toBe('https://93.184.216.34/v2/hooks');

        const body = JSON.parse(s.body);

        expect(body).toMatchObject({
          type: 'assessment',
          applicationId,
          candidate: { name: 'Pat Partner' },
          job: { title: 'Partner job' },
        });
        expect(s.headers['X-Hirecraft-Signature']).toBe(
          `sha256=${createHmac('sha256', 'my-super-secret-value-1').update(s.body).digest('hex')}`
        );
        expect(m.partners.signBody('k', 'b')).toBe(
          `sha256=${createHmac('sha256', 'k').update('b').digest('hex')}`
        );

        const note = await prisma.applicationActivity.findFirstOrThrow({
          where: { teamId: teamA.id, applicationId, type: 'NOTE' },
          orderBy: { createdAt: 'desc' },
        });

        expect(note.payload).toMatchObject({
          integration: 'assessment',
          status: 'REQUESTED',
          externalId: 'ext-1',
        });
        expect([403, 404]).toContain(
          (await request('assessment', {}, 'memberA')).status
        );
        expect((await request('assessment', {}, 'ownerB')).status).toBe(403);
      });

      it('turns a partner failure into a clean 502 and leaves no activity behind', async () => {
        const before = await prisma.applicationActivity.count({
          where: { teamId: teamA.id, applicationId },
        });

        reply = { status: 500 };

        const r = await request('assessment');

        expect(r.status).toBe(502);
        expect(r.json.error.message).toContain('partner rejected');
        expect(
          await prisma.applicationActivity.count({
            where: { teamId: teamA.id, applicationId },
          })
        ).toBe(before);
      });

      it('background checks need the offers permission and an explicit consent confirmation', async () => {
        await save('background_check', {
          url: 'https://93.184.216.34/bg',
          secret: 'bg-secret-value-123456',
        });
        sent.length = 0;

        expect((await request('background_check')).status).toBe(422); // consent not confirmed
        expect(
          (await request('background_check', { consentConfirmed: false }))
            .status
        ).toBe(422);
        expect(sent).toHaveLength(0);

        const ok = await request('background_check', {
          consentConfirmed: true,
        });

        expect(ok.status).toBe(200);
        expect(JSON.parse(sent[0].body).consentConfirmed).toBe(true);

        const note = await prisma.applicationActivity.findFirstOrThrow({
          where: { teamId: teamA.id, applicationId, type: 'NOTE' },
          orderBy: { createdAt: 'desc' },
        });

        expect(note.payload).toMatchObject({
          integration: 'background_check',
          consentConfirmed: true,
        });

        // a recruiter-level member (no offers.manage) cannot start one
        const role = await prisma.portalRole.findFirstOrThrow({
          where: { teamId: teamA.id, key: 'recruiter' },
        });

        expect((role as { baseRole: string }).baseRole).toBeTruthy();
        expect(
          (
            await request(
              'background_check',
              { consentConfirmed: true },
              'memberA'
            )
          ).status
        ).toBe(403);
      });

      it('refuses when the partner is not connected or the application is closed', async () => {
        await call(m.integrationApi, 'ownerA', {
          method: 'DELETE',
          query: { slug: slugA, provider: 'assessment' },
        });
        expect((await request('assessment')).status).toBe(409);
        await save('assessment', {
          url: 'https://93.184.216.34/hooks',
          secret: 'a-long-enough-secret',
        });

        const rejected = await prisma.pipelineStage.findFirstOrThrow({
          where: { teamId: teamA.id, jobId: null, kind: 'REJECTED' },
        });

        await unguarded.jobApplication.update({
          where: { id: applicationId },
          data: { stageId: rejected.id },
        });
        expect((await request('assessment')).status).toBe(409);
        expect((await request('nope' as never)).status).toBe(422);
      });
    });
  }
);
