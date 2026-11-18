/**
 * @jest-environment node
 *
 * Integration tests against a real PostgreSQL database.
 * Run with:  DATABASE_URL=postgresql://... npm run test:integration
 * (skipped in the default `npm test`)
 */
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const enabled = process.env.INTEGRATION === '1' && !!process.env.DATABASE_URL;
const suite = enabled ? describe : describe.skip;

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
jest.mock('@/lib/email/sendTeamInviteEmail', () => ({
  sendTeamInviteEmail: jest.fn(async () => undefined),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const load = () => ({
  prisma: require('@/lib/prisma')
    .prisma as typeof import('@/lib/prisma').prisma,
  createPortal: require('models/portal').createPortal,
  membersApi: require('pages/api/teams/[slug]/members').default,
  invitationsApi: require('pages/api/teams/[slug]/invitations').default,
  rolesApi: require('pages/api/teams/[slug]/roles/index').default,
  roleApi: require('pages/api/teams/[slug]/roles/[roleId]').default,
  portalApi: require('pages/api/teams/[slug]/portal').default,
  permissionsApi: require('pages/api/teams/[slug]/permissions').default,
  teamsApi: require('pages/api/teams/index').default,
});

suite('portal foundation (integration)', () => {
  const m = load();
  const { prisma } = m;
  const run = Date.now().toString(36);
  const users: Record<string, { id: string; email: string; name: string }> = {};
  let slugA = '';
  let slugB = '';

  const call = async (
    handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void>,
    as: string | null,
    opts: {
      method?: string;
      slug?: string;
      query?: Record<string, string>;
      body?: unknown;
    } = {}
  ) => {
    currentUser = as ? users[as] : null;
    const { req, res } = createMocks({
      method: (opts.method ?? 'GET') as never,
      query: { ...(opts.slug ? { slug: opts.slug } : {}), ...opts.query },
      body: opts.body as never,
    });
    await handler(req as never, res as never);
    const text = res._getData();
    return {
      status: res._getStatusCode(),
      json: text ? JSON.parse(text) : undefined,
    };
  };

  const mkUser = async (key: string) => {
    const u = await prisma.user.create({
      data: {
        name: key,
        email: `${key}-${run}@acme-test.com`,
        emailVerified: new Date(),
      },
    });
    users[key] = { id: u.id, email: u.email, name: u.name };
  };

  const roleId = async (slug: string, key: string) => {
    const team = await prisma.team.findUniqueOrThrow({ where: { slug } });
    const r = await prisma.portalRole.findFirstOrThrow({
      where: { teamId: team.id, key },
    });
    return r.id;
  };

  const addMember = async (slug: string, user: string, key: string) => {
    const team = await prisma.team.findUniqueOrThrow({ where: { slug } });
    const r = await prisma.portalRole.findFirstOrThrow({
      where: { teamId: team.id, key },
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

  beforeAll(async () => {
    for (const k of [
      'ownerA',
      'ownerB',
      'adminA',
      'hrA',
      'recruiterA',
      'viewerA',
      'ownerA2',
      'outsider',
    ]) {
      await mkUser(k);
    }

    slugA = `acme-${run}`;
    slugB = `beta-${run}`;
    await m.createPortal({
      userId: users.ownerA.id,
      name: 'Acme',
      slug: slugA,
    });
    await m.createPortal({
      userId: users.ownerB.id,
      name: 'Beta',
      slug: slugB,
    });
    await addMember(slugA, 'adminA', 'admin');
    await addMember(slugA, 'hrA', 'hr_manager');
    await addMember(slugA, 'recruiterA', 'recruiter');
    await addMember(slugA, 'viewerA', 'viewer');
  });

  afterAll(async () => {
    const emails = Object.values(users).map((u) => u.email);
    await prisma.team.deleteMany({
      where: { slug: { in: [slugA, slugB, `x-${run}`, `rollback-${run}`] } },
    });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  describe('createPortal', () => {
    it('creates team, profile, branding, 7 role copies and the owner in one go', async () => {
      const team = await prisma.team.findUniqueOrThrow({
        where: { slug: slugA },
        include: {
          portalProfile: true,
          portalBranding: true,
          portalRoles: true,
          members: { include: { portalRole: true } },
        },
      });

      expect(team.portalProfile?.companyName).toBe('Acme');
      expect(team.portalBranding?.primaryColor).toBe('#3346D3');
      expect(team.portalRoles).toHaveLength(7);
      const owner = team.members.find((x) => x.userId === users.ownerA.id);
      expect(owner?.role).toBe('OWNER');
      expect(owner?.portalRole?.key).toBe('portal_owner');
    });

    it('rolls back everything when a step fails (duplicate slug)', async () => {
      await expect(
        m.createPortal({ userId: users.ownerA.id, name: 'Dup', slug: slugA })
      ).rejects.toMatchObject({ status: 400 });

      expect(await prisma.team.count({ where: { slug: slugA } })).toBe(1);
      const teamA = await prisma.team.findUniqueOrThrow({
        where: { slug: slugA },
      });
      expect(
        await prisma.portalRole.count({ where: { teamId: teamA.id } })
      ).toBe(7);
    });

    it('is atomic: a failing owner membership leaves no orphan portal', async () => {
      await expect(
        m.createPortal({
          userId: 'does-not-exist',
          name: 'Rollback',
          slug: `rollback-${run}`,
        })
      ).rejects.toBeDefined();

      expect(
        await prisma.team.count({ where: { slug: `rollback-${run}` } })
      ).toBe(0);
    });

    it('refuses reserved slugs', async () => {
      await expect(
        m.createPortal({ userId: users.ownerA.id, name: 'New', slug: 'new' })
      ).rejects.toMatchObject({ status: 400 });
    });

    it('POST /api/teams creates a portal from the wizard payload', async () => {
      const r = await call(m.teamsApi, 'outsider', {
        method: 'POST',
        body: {
          name: 'Wizard Co',
          slug: `x-${run}`,
          completeOnboarding: true,
          profile: { website: 'https://wizard.example.com', industry: 'IT' },
          branding: { primaryColor: '#112233', theme: 'DARK' },
        },
      });
      expect(r.status).toBe(200);

      const team = await prisma.team.findUniqueOrThrow({
        where: { slug: `x-${run}` },
        include: { portalProfile: true, portalBranding: true },
      });
      expect(team.portalProfile?.onboardingCompletedAt).not.toBeNull();
      expect(team.portalBranding?.theme).toBe('DARK');
      expect(team.portalBranding?.primaryColor).toBe('#112233');
    });
  });

  describe('tenant guard (runtime)', () => {
    it('throws when a tenant model is queried without teamId', async () => {
      await expect(prisma.portalRole.findMany()).rejects.toThrow(/teamId/);
      await expect(
        prisma.portalProfile.findFirst({ where: { companyName: 'Acme' } })
      ).rejects.toThrow(/teamId/);
    });
  });

  describe('cross-tenant isolation', () => {
    // ownerB is a Portal Owner of B but has no relationship with A.
    const endpoints: [string, () => Promise<{ status: number }>][] = [
      ['GET portal', () => call(m.portalApi, 'ownerB', { slug: slugA })],
      [
        'PUT portal',
        () =>
          call(m.portalApi, 'ownerB', {
            method: 'PUT',
            slug: slugA,
            body: { profile: { companyName: 'Hacked' } },
          }),
      ],
      ['GET roles', () => call(m.rolesApi, 'ownerB', { slug: slugA })],
      [
        'POST roles',
        () =>
          call(m.rolesApi, 'ownerB', {
            method: 'POST',
            slug: slugA,
            body: { name: 'Evil', permissions: ['portal.read'] },
          }),
      ],
      ['GET members', () => call(m.membersApi, 'ownerB', { slug: slugA })],
      [
        'PATCH members',
        () =>
          call(m.membersApi, 'ownerB', {
            method: 'PATCH',
            slug: slugA,
            body: { memberId: users.viewerA.id, role: 'ADMIN' },
          }),
      ],
      [
        'DELETE members',
        () =>
          call(m.membersApi, 'ownerB', {
            method: 'DELETE',
            slug: slugA,
            query: { memberId: users.viewerA.id },
          }),
      ],
      [
        'GET invitations',
        () =>
          call(m.invitationsApi, 'ownerB', {
            slug: slugA,
            query: { sentViaEmail: 'true' },
          }),
      ],
      [
        'POST invitations',
        () =>
          call(m.invitationsApi, 'ownerB', {
            method: 'POST',
            slug: slugA,
            body: {
              email: 'x@acme-test.com',
              role: 'MEMBER',
              sentViaEmail: true,
            },
          }),
      ],
      [
        'GET permissions',
        () => call(m.permissionsApi, 'ownerB', { slug: slugA }),
      ],
    ];

    it.each(endpoints)(
      "%s as another portal's owner -> 403",
      async (_n, fn) => {
        const r = await fn();
        expect(r.status).toBe(403);
      }
    );

    it('unknown portal and non-member are indistinguishable', async () => {
      const a = await call(m.portalApi, 'ownerB', { slug: slugA });
      const b = await call(m.portalApi, 'ownerB', { slug: `nope-${run}` });
      expect(a.status).toBe(403);
      expect(b.status).toBe(403);
      expect(a.json).toEqual(b.json);
    });

    it('unauthenticated -> 401', async () => {
      expect((await call(m.portalApi, null, { slug: slugA })).status).toBe(401);
    });

    it("A's data is untouched after the attempts", async () => {
      const teamA = await prisma.team.findUniqueOrThrow({
        where: { slug: slugA },
      });
      const p = await prisma.portalProfile.findFirstOrThrow({
        where: { teamId: teamA.id },
      });
      expect(p.companyName).toBe('Acme');
      expect(
        await prisma.teamMember.count({ where: { team: { slug: slugA } } })
      ).toBe(5);
    });

    it("a role id from portal B cannot be used through portal A's slug", async () => {
      const bRole = await roleId(slugB, 'viewer');

      // read / update / delete B's role via A's owner on A's slug -> 404
      for (const method of ['GET', 'PUT', 'DELETE']) {
        const r = await call(m.roleApi, 'ownerA', {
          method,
          slug: slugA,
          query: { roleId: bRole },
          body: { name: 'Renamed' },
        });
        expect(r.status).toBe(404);
      }

      // assigning B's role to A's member -> 404
      const patch = await call(m.membersApi, 'ownerA', {
        method: 'PATCH',
        slug: slugA,
        body: { memberId: users.viewerA.id, portalRoleId: bRole },
      });
      expect(patch.status).toBe(404);

      // inviting into A with B's role -> 404
      const inv = await call(m.invitationsApi, 'ownerA', {
        method: 'POST',
        slug: slugA,
        body: {
          email: 'cross@acme-test.com',
          portalRoleId: bRole,
          sentViaEmail: true,
        },
      });
      expect(inv.status).toBe(404);
      expect(
        await prisma.invitation.count({ where: { team: { slug: slugA } } })
      ).toBe(0);
    });

    it("a member id from portal B cannot be removed via A's slug", async () => {
      const r = await call(m.membersApi, 'ownerA', {
        method: 'DELETE',
        slug: slugA,
        query: { memberId: users.ownerB.id },
      });
      expect(r.status).toBe(404);
      expect(
        await prisma.teamMember.count({ where: { team: { slug: slugB } } })
      ).toBe(1);
    });
  });

  describe('RBAC', () => {
    it('owner has all permission keys', async () => {
      const r = await call(m.permissionsApi, 'ownerA', { slug: slugA });
      expect(r.status).toBe(200);
      expect(r.json.portal.keys).toContain('billing.manage');
      expect(r.json.portal.baseRole).toBe('OWNER');
    });

    it('owner invites a recruiter; after accepting they hold exactly the recruiter permissions', async () => {
      const recruiterRole = await roleId(slugA, 'recruiter');
      await mkUser('newRecruiter');

      const inv = await call(m.invitationsApi, 'ownerA', {
        method: 'POST',
        slug: slugA,
        body: {
          email: users.newRecruiter.email,
          portalRoleId: recruiterRole,
          sentViaEmail: true,
        },
      });
      expect(inv.status).toBe(204);

      const stored = await prisma.invitation.findFirstOrThrow({
        where: { email: users.newRecruiter.email },
      });
      expect(stored.portalRoleId).toBe(recruiterRole);
      expect(stored.role).toBe('MEMBER');

      const accept = await call(m.invitationsApi, 'newRecruiter', {
        method: 'PUT',
        slug: slugA,
        body: { inviteToken: stored.token },
      });
      expect(accept.status).toBe(204);
      expect(await prisma.invitation.count({ where: { id: stored.id } })).toBe(
        0
      );

      const perms = await call(m.permissionsApi, 'newRecruiter', {
        slug: slugA,
      });
      expect(perms.json.portal.role.name).toBe('Recruiter');
      expect(perms.json.portal.scope).toBe('assigned');
      expect(perms.json.portal.keys).toEqual(
        expect.arrayContaining(['jobs.publish', 'applications.manage'])
      );
      for (const k of [
        'billing.manage',
        'roles.manage',
        'members.invite',
        'offers.manage',
      ]) {
        expect(perms.json.portal.keys).not.toContain(k);
      }
    });

    it('accepting an invitation twice / as an existing member is rejected and keeps the role', async () => {
      const inv = await prisma.invitation.create({
        data: {
          teamId: (
            await prisma.team.findUniqueOrThrow({ where: { slug: slugA } })
          ).id,
          invitedBy: users.ownerA.id,
          role: 'ADMIN',
          sentViaEmail: false,
          token: `tok-${run}`,
          expires: new Date(Date.now() + 1e6),
        },
      });
      const r = await call(m.invitationsApi, 'viewerA', {
        method: 'PUT',
        slug: slugA,
        body: { inviteToken: inv.token },
      });
      expect(r.status).toBe(400);
      const mem = await prisma.teamMember.findFirstOrThrow({
        where: { userId: users.viewerA.id, team: { slug: slugA } },
      });
      expect(mem.role).toBe('MEMBER');
      await prisma.invitation.delete({ where: { id: inv.id } });
    });

    it('an expired invitation cannot be accepted', async () => {
      const inv = await prisma.invitation.create({
        data: {
          teamId: (
            await prisma.team.findUniqueOrThrow({ where: { slug: slugA } })
          ).id,
          invitedBy: users.ownerA.id,
          role: 'MEMBER',
          sentViaEmail: false,
          token: `old-${run}`,
          expires: new Date(Date.now() - 1000),
        },
      });
      const r = await call(m.invitationsApi, 'outsider', {
        method: 'PUT',
        slug: slugA,
        body: { inviteToken: inv.token },
      });
      expect(r.status).toBe(400);
      await prisma.invitation.delete({ where: { id: inv.id } });
    });

    it('recruiter cannot reach admin endpoints', async () => {
      expect(
        (await call(m.rolesApi, 'recruiterA', { slug: slugA })).status
      ).toBe(403);
      expect(
        (await call(m.membersApi, 'recruiterA', { slug: slugA })).status
      ).toBe(403);
      expect(
        (
          await call(m.portalApi, 'recruiterA', {
            method: 'PUT',
            slug: slugA,
            body: { profile: { companyName: 'x' } },
          })
        ).status
      ).toBe(403);
      expect(
        (
          await call(m.invitationsApi, 'recruiterA', {
            method: 'POST',
            slug: slugA,
            body: {
              email: 'a@acme-test.com',
              role: 'MEMBER',
              sentViaEmail: true,
            },
          })
        ).status
      ).toBe(403);
    });

    it('recruiter can read portal settings but not edit branding', async () => {
      expect(
        (await call(m.portalApi, 'recruiterA', { slug: slugA })).status
      ).toBe(200);
      expect(
        (
          await call(m.portalApi, 'recruiterA', {
            method: 'PUT',
            slug: slugA,
            body: { branding: { primaryColor: '#000000' } },
          })
        ).status
      ).toBe(403);
    });

    it('admin can edit profile and branding; each section needs its own permission', async () => {
      const r = await call(m.portalApi, 'adminA', {
        method: 'PUT',
        slug: slugA,
        body: {
          profile: { companyName: 'Acme Corp', website: 'https://acme.test' },
          branding: { primaryColor: '#ff0000', theme: 'LIGHT' },
        },
      });
      expect(r.status).toBe(200);
      const g = await call(m.portalApi, 'adminA', { slug: slugA });
      expect(g.json.data.profile.companyName).toBe('Acme Corp');
      expect(g.json.data.branding.primaryColor).toBe('#ff0000');
    });

    it('a custom role with only branding.update can edit branding but not profile', async () => {
      const created = await call(m.rolesApi, 'ownerA', {
        method: 'POST',
        slug: slugA,
        body: {
          name: 'Brand Editor',
          permissions: ['portal.read', 'branding.update'],
        },
      });
      expect(created.status).toBe(201);
      await mkUser('brand');
      const team = await prisma.team.findUniqueOrThrow({
        where: { slug: slugA },
      });
      await prisma.teamMember.create({
        data: {
          teamId: team.id,
          userId: users.brand.id,
          role: 'MEMBER',
          portalRoleId: created.json.data.id,
        },
      });

      expect(
        (
          await call(m.portalApi, 'brand', {
            method: 'PUT',
            slug: slugA,
            body: { branding: { heroTitle: 'Join us' } },
          })
        ).status
      ).toBe(200);
      expect(
        (
          await call(m.portalApi, 'brand', {
            method: 'PUT',
            slug: slugA,
            body: { profile: { companyName: 'Nope' } },
          })
        ).status
      ).toBe(403);
    });

    it('sanitises branding HTML', async () => {
      const r = await call(m.portalApi, 'ownerA', {
        method: 'PUT',
        slug: slugA,
        body: {
          branding: {
            aboutHtml:
              '<p onclick="x()">Hi <script>alert(1)</script><a href="javascript:alert(1)">l</a><img src=x onerror=y></p>',
          },
        },
      });
      expect(r.status).toBe(200);
      const html: string = r.json.data.branding.aboutHtml;
      expect(html).not.toMatch(/script|onclick|onerror|javascript:|<img/i);
      expect(html).toContain('Hi');
    });

    it('rejects invalid branding input', async () => {
      const r = await call(m.portalApi, 'ownerA', {
        method: 'PUT',
        slug: slugA,
        body: { branding: { primaryColor: 'red' } },
      });
      expect(r.status).toBe(422);
    });
  });

  describe('privilege escalation', () => {
    it('HR manager cannot invite with the Admin or Owner role', async () => {
      const adminRole = await roleId(slugA, 'admin');
      const ownerRole = await roleId(slugA, 'portal_owner');

      for (const portalRoleId of [adminRole, ownerRole]) {
        const r = await call(m.invitationsApi, 'hrA', {
          method: 'POST',
          slug: slugA,
          body: { email: 'e@acme-test.com', portalRoleId, sentViaEmail: true },
        });
        expect(r.status).toBe(403);
      }

      const legacy = await call(m.invitationsApi, 'hrA', {
        method: 'POST',
        slug: slugA,
        body: { email: 'e@acme-test.com', role: 'OWNER', sentViaEmail: true },
      });
      expect(legacy.status).toBe(403);
    });

    it('HR manager can invite a recruiter', async () => {
      const r = await call(m.invitationsApi, 'hrA', {
        method: 'POST',
        slug: slugA,
        body: {
          email: 'ok@acme-test.com',
          portalRoleId: await roleId(slugA, 'recruiter'),
          sentViaEmail: true,
        },
      });
      expect(r.status).toBe(204);
      await prisma.invitation.deleteMany({
        where: { email: 'ok@acme-test.com' },
      });
    });

    it('HR manager cannot promote a member to Admin or modify an Admin', async () => {
      const promote = await call(m.membersApi, 'hrA', {
        method: 'PATCH',
        slug: slugA,
        body: {
          memberId: users.viewerA.id,
          portalRoleId: await roleId(slugA, 'admin'),
        },
      });
      expect(promote.status).toBe(403);

      const demoteAdmin = await call(m.membersApi, 'hrA', {
        method: 'PATCH',
        slug: slugA,
        body: {
          memberId: users.adminA.id,
          portalRoleId: await roleId(slugA, 'viewer'),
        },
      });
      expect(demoteAdmin.status).toBe(403);

      const removeAdmin = await call(m.membersApi, 'hrA', {
        method: 'DELETE',
        slug: slugA,
        query: { memberId: users.adminA.id },
      });
      expect(removeAdmin.status).toBe(403);
    });

    it('a member cannot change their own role', async () => {
      const r = await call(m.membersApi, 'hrA', {
        method: 'PATCH',
        slug: slugA,
        body: {
          memberId: users.hrA.id,
          portalRoleId: await roleId(slugA, 'viewer'),
        },
      });
      expect(r.status).toBe(400);
    });

    it('admin cannot create a role containing roles.manage or billing.manage', async () => {
      // admin lacks roles.manage entirely
      const r = await call(m.rolesApi, 'adminA', {
        method: 'POST',
        slug: slugA,
        body: { name: 'Sneaky', permissions: ['billing.manage'] },
      });
      expect(r.status).toBe(403);
    });

    it('HR manager cannot create roles (no roles.manage)', async () => {
      const r = await call(m.rolesApi, 'hrA', {
        method: 'POST',
        slug: slugA,
        body: { name: 'X', permissions: ['jobs.read'] },
      });
      expect(r.status).toBe(403);
    });

    it('rejects unknown permission keys', async () => {
      const r = await call(m.rolesApi, 'ownerA', {
        method: 'POST',
        slug: slugA,
        body: { name: 'Bad', permissions: ['jobs.read', 'root.access'] },
      });
      expect(r.status).toBe(422);
    });
  });

  describe('roles management', () => {
    it('lists the seven system roles plus the catalogue', async () => {
      const r = await call(m.rolesApi, 'hrA', { slug: slugA });
      expect(r.status).toBe(200);
      expect(
        r.json.data.roles.filter((x: { isSystem: boolean }) => x.isSystem)
      ).toHaveLength(7);
      expect(r.json.data.permissions.length).toBeGreaterThan(25);
      expect(r.json.data.canManage).toBe(false);
    });

    it('custom role lifecycle: create, update, in-use delete is blocked, then delete', async () => {
      const c = await call(m.rolesApi, 'ownerA', {
        method: 'POST',
        slug: slugA,
        body: {
          name: 'Sourcer',
          permissions: ['portal.read', 'candidates.search'],
        },
      });
      expect(c.status).toBe(201);
      const id = c.json.data.id;

      const dup = await call(m.rolesApi, 'ownerA', {
        method: 'POST',
        slug: slugA,
        body: { name: 'Sourcer', permissions: ['portal.read'] },
      });
      expect(dup.status).toBe(409);

      const u = await call(m.roleApi, 'ownerA', {
        method: 'PUT',
        slug: slugA,
        query: { roleId: id },
        body: {
          permissions: ['portal.read', 'candidates.search', 'candidates.read'],
        },
      });
      expect(u.status).toBe(200);
      expect(u.json.data.permissions).toContain('candidates.read');

      const patch = await call(m.membersApi, 'ownerA', {
        method: 'PATCH',
        slug: slugA,
        body: { memberId: users.viewerA.id, portalRoleId: id },
      });
      expect(patch.status).toBe(200);
      const perms = await call(m.permissionsApi, 'viewerA', { slug: slugA });
      expect(perms.json.portal.keys.sort()).toEqual(
        ['candidates.read', 'candidates.search', 'portal.read'].sort()
      );

      const blocked = await call(m.roleApi, 'ownerA', {
        method: 'DELETE',
        slug: slugA,
        query: { roleId: id },
      });
      expect(blocked.status).toBe(409);

      await call(m.membersApi, 'ownerA', {
        method: 'PATCH',
        slug: slugA,
        body: {
          memberId: users.viewerA.id,
          portalRoleId: await roleId(slugA, 'viewer'),
        },
      });
      const del = await call(m.roleApi, 'ownerA', {
        method: 'DELETE',
        slug: slugA,
        query: { roleId: id },
      });
      expect(del.status).toBe(200);
    });

    it('system roles are immutable', async () => {
      const id = await roleId(slugA, 'recruiter');
      for (const method of ['PUT', 'DELETE']) {
        const r = await call(m.roleApi, 'ownerA', {
          method,
          slug: slugA,
          query: { roleId: id },
          body: { permissions: ['billing.manage'] },
        });
        expect(r.status).toBe(400);
      }
    });
  });

  describe('last owner guard', () => {
    let slugC = '';

    beforeAll(async () => {
      slugC = `solo-${run}`;
      await m.createPortal({
        userId: users.ownerA2.id,
        name: 'Solo',
        slug: slugC,
      });
    });

    afterAll(async () => {
      await prisma.team.deleteMany({ where: { slug: slugC } });
    });

    it('the only owner cannot leave', async () => {
      const r = await call(m.membersApi, 'ownerA2', {
        method: 'PUT',
        slug: slugC,
      });
      expect(r.status).toBe(400);
      expect(r.json.error.message).toMatch(/at least one owner/);
    });

    it('the only owner cannot be removed or downgraded by an admin/owner', async () => {
      await mkUser('adminC');
      await addMember(slugC, 'adminC', 'admin');

      const del = await call(m.membersApi, 'adminC', {
        method: 'DELETE',
        slug: slugC,
        query: { memberId: users.ownerA2.id },
      });
      // admin can't touch an owner at all
      expect(del.status).toBe(403);

      expect(
        await prisma.teamMember.count({
          where: { team: { slug: slugC }, role: 'OWNER' },
        })
      ).toBe(1);
    });

    it('a sole owner cannot downgrade themselves', async () => {
      const r = await call(m.membersApi, 'ownerA2', {
        method: 'PATCH',
        slug: slugC,
        body: { memberId: users.ownerA2.id, role: 'ADMIN' },
      });
      expect(r.status).toBe(400); // cannot change own role
    });

    it('with a second owner, an owner can leave; the remaining one is protected', async () => {
      await mkUser('owner2C');
      await addMember(slugC, 'owner2C', 'portal_owner');

      const leave = await call(m.membersApi, 'ownerA2', {
        method: 'PUT',
        slug: slugC,
      });
      expect(leave.status).toBe(200);

      const last = await call(m.membersApi, 'owner2C', {
        method: 'PUT',
        slug: slugC,
      });
      expect(last.status).toBe(400);
      expect(
        await prisma.teamMember.count({
          where: { team: { slug: slugC }, role: 'OWNER' },
        })
      ).toBe(1);
    });

    it('is race-safe: two owners leaving at once leaves exactly one', async () => {
      const slugD = `race-${run}`;
      await mkUser('raceA');
      await mkUser('raceB');
      await m.createPortal({
        userId: users.raceA.id,
        name: 'Race',
        slug: slugD,
      });
      await addMember(slugD, 'raceB', 'portal_owner');

      try {
        const results = await Promise.all([
          call(m.membersApi, 'raceA', { method: 'PUT', slug: slugD }),
          call(m.membersApi, 'raceB', { method: 'PUT', slug: slugD }),
        ]);

        expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
        expect(
          await prisma.teamMember.count({
            where: { team: { slug: slugD }, role: 'OWNER' },
          })
        ).toBe(1);
      } finally {
        await prisma.team.deleteMany({ where: { slug: slugD } });
      }
    });
  });

  describe('suspended tenant lockout', () => {
    beforeAll(async () => {
      await prisma.team.update({
        where: { slug: slugB },
        data: { status: 'SUSPENDED', suspendedReason: 'test' },
      });
    });

    afterAll(async () => {
      await prisma.team.update({
        where: { slug: slugB },
        data: { status: 'ACTIVE', suspendedReason: null },
      });
    });

    it('every tenant API returns 403 for a suspended portal, even for its owner', async () => {
      const results = await Promise.all([
        call(m.portalApi, 'ownerB', { slug: slugB }),
        call(m.rolesApi, 'ownerB', { slug: slugB }),
        call(m.membersApi, 'ownerB', { slug: slugB }),
        call(m.invitationsApi, 'ownerB', {
          slug: slugB,
          query: { sentViaEmail: 'true' },
        }),
        call(m.permissionsApi, 'ownerB', { slug: slugB }),
        call(m.portalApi, 'ownerB', {
          method: 'PUT',
          slug: slugB,
          body: { profile: { companyName: 'x' } },
        }),
      ]);
      for (const r of results) {
        expect(r.status).toBe(403);
        expect(r.json.error.message).toMatch(/suspended/);
      }
    });

    it('invitations to a suspended portal cannot be accepted', async () => {
      const team = await prisma.team.findUniqueOrThrow({
        where: { slug: slugB },
      });
      const inv = await prisma.invitation.create({
        data: {
          teamId: team.id,
          invitedBy: users.ownerB.id,
          role: 'MEMBER',
          sentViaEmail: false,
          token: `susp-${run}`,
          expires: new Date(Date.now() + 1e6),
        },
      });
      const r = await call(m.invitationsApi, 'outsider', {
        method: 'PUT',
        slug: slugB,
        body: { inviteToken: inv.token },
      });
      expect(r.status).toBe(403);
    });
  });

  describe('legacy portals (no portal roles yet)', () => {
    it('members without a portal role fall back to base-role permissions, and roles are created lazily', async () => {
      const slugL = `legacy-${run}`;
      await mkUser('legacyOwner');
      await mkUser('legacyMember');
      const team = await prisma.team.create({
        data: { name: 'Legacy', slug: slugL },
      });
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: users.legacyOwner.id, role: 'OWNER' },
      });
      await prisma.teamMember.create({
        data: {
          teamId: team.id,
          userId: users.legacyMember.id,
          role: 'MEMBER',
        },
      });

      try {
        const o = await call(m.permissionsApi, 'legacyOwner', { slug: slugL });
        expect(o.json.portal.keys).toContain('roles.manage');
        const mem = await call(m.permissionsApi, 'legacyMember', {
          slug: slugL,
        });
        expect(mem.json.portal.keys).toEqual(['portal.read']);

        expect(
          await prisma.portalRole.count({ where: { teamId: team.id } })
        ).toBe(0);
        const roles = await call(m.rolesApi, 'legacyOwner', { slug: slugL });
        expect(roles.json.data.roles).toHaveLength(7);
        // idempotent
        await call(m.rolesApi, 'legacyOwner', { slug: slugL });
        expect(
          await prisma.portalRole.count({ where: { teamId: team.id } })
        ).toBe(7);
      } finally {
        await prisma.team.deleteMany({ where: { slug: slugL } });
      }
    });
  });
});
