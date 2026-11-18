const { faker } = require('@faker-js/faker');
const { PrismaClient } = require('@prisma/client');
const client = new PrismaClient();
const { hash } = require('bcryptjs');
const { randomUUID } = require('crypto');
const { PERMISSIONS, SYSTEM_ROLES } = require('../lib/portal-roles');

let USER_COUNT = 10;
const TEAM_COUNT = 5;
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'admin@123';
const USER_EMAIL = 'user@example.com';
const USER_PASSWORD = 'user@123';
async function seedUsers() {
  const newUsers: any[] = [];
  await createRandomUser(ADMIN_EMAIL, ADMIN_PASSWORD);
  await createRandomUser(USER_EMAIL, USER_PASSWORD);
  await Promise.all(
    Array(USER_COUNT)
      .fill(0)
      .map(() => createRandomUser())
  );

  console.log('Seeded users', newUsers.length);

  return newUsers;

  async function createRandomUser(
    email: string | undefined = undefined,
    password: string | undefined = undefined
  ) {
    try {
      const originalPassword = password || faker.internet.password();
      email = email || faker.internet.email();
      password = await hash(originalPassword, 12);
      const user = await client.user.create({
        data: {
          email,
          name: faker.person.firstName(),
          password,
          emailVerified: new Date(),
        },
      });
      newUsers.push({
        ...user,
        password: originalPassword,
      });
      USER_COUNT--;
    } catch (ex: any) {
      if (ex.message.indexOf('Unique constraint failed') > -1) {
        console.error('Duplicate email', email);
      } else {
        console.log(ex);
      }
    }
  }
}

async function seedTeams() {
  const newTeams: any[] = [];

  await Promise.all(
    Array(TEAM_COUNT)
      .fill(0)
      .map(() => createRandomTeam())
  );
  console.log('Seeded teams', newTeams.length);
  return newTeams;

  async function createRandomTeam() {
    const name = faker.company.name();
    const team = await client.team.create({
      data: {
        name,
        slug: name
          .toString()
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^\w-]+/g, '')
          .replace(/--+/g, '-')
          .replace(/^-+/, '')
          .replace(/-+$/, ''),
      },
    });
    newTeams.push(team);
  }
}

async function seedTeamMembers(users: any[], teams: any[]) {
  const newTeamMembers: any[] = [];
  const roles = ['OWNER', 'MEMBER'];
  for (const user of users) {
    const count = Math.floor(Math.random() * (TEAM_COUNT - 1)) + 2;
    const teamUsed = new Set();
    for (let j = 0; j < count; j++) {
      try {
        let teamId;
        do {
          teamId = teams[Math.floor(Math.random() * TEAM_COUNT)].id;
        } while (teamUsed.has(teamId));
        teamUsed.add(teamId);
        newTeamMembers.push({
          role:
            user.email === ADMIN_EMAIL
              ? 'OWNER'
              : user.email === USER_EMAIL
                ? 'MEMBER'
                : roles[Math.floor(Math.random() * 2)],
          teamId,
          userId: user.id,
        });
      } catch (ex) {
        console.log(ex);
      }
    }
  }

  await client.teamMember.createMany({
    data: newTeamMembers,
  });
  console.log('Seeded team members', newTeamMembers.length);
}

async function seedInvitations(teams: any[], users: any[]) {
  const newInvitations: any[] = [];
  for (const team of teams) {
    const count = Math.floor(Math.random() * users.length) + 2;
    for (let j = 0; j < count; j++) {
      try {
        const invitation = await client.invitation.create({
          data: {
            teamId: team.id,
            invitedBy: users[Math.floor(Math.random() * users.length)].id,
            email: faker.internet.email(),
            role: 'MEMBER',
            sentViaEmail: true,
            token: randomUUID(),
            allowedDomains: [],
            expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
        newInvitations.push(invitation);
      } catch (ex) {
        console.log(ex);
      }
    }
  }

  console.log('Seeded invitations', newInvitations.length);

  return newInvitations;
}

// ---------------------------------------------------------------------------
// Job portal: permissions, system roles per portal, profile and branding
// ---------------------------------------------------------------------------

async function seedPermissions() {
  await client.permission.createMany({
    data: PERMISSIONS.map((p: any) => ({ ...p })),
    skipDuplicates: true,
  });
  const rows = await client.permission.findMany();
  return new Map<string, string>(rows.map((r: any) => [r.key, r.id]));
}

// Gives a team its portal profile, branding and system role copies, and maps
// its existing members onto the matching portal role.
async function provisionPortal(teamId: string, companyName: string) {
  const permissionIds = await seedPermissions();

  await client.portalProfile.upsert({
    where: { teamId },
    create: { teamId, companyName, onboardingCompletedAt: new Date() },
    update: {},
  });
  await client.portalBranding.upsert({
    where: { teamId },
    create: { teamId },
    update: {},
  });

  const roleIds = new Map<string, string>();
  for (const def of SYSTEM_ROLES) {
    const existing = await client.portalRole.findFirst({
      where: { teamId, key: def.key },
    });
    const role =
      existing ||
      (await client.portalRole.create({
        data: {
          teamId,
          key: def.key,
          name: def.name,
          description: def.description,
          baseRole: def.baseRole,
          isSystem: true,
          isOwnerRole: def.isOwnerRole,
          permissions: {
            create: def.permissions.map((key: string) => ({
              permissionId: permissionIds.get(key),
            })),
          },
        },
      }));
    roleIds.set(def.key, role.id);
  }

  // Existing members: OWNER -> Portal Owner, ADMIN -> Admin, MEMBER -> Viewer
  const byBase: Record<string, string> = {
    OWNER: 'portal_owner',
    ADMIN: 'admin',
    MEMBER: 'viewer',
  };
  for (const [base, key] of Object.entries(byBase)) {
    await client.teamMember.updateMany({
      where: { teamId, role: base, portalRoleId: null },
      data: { portalRoleId: roleIds.get(key) },
    });
  }

  return roleIds;
}

const DEMO_PASSWORD = 'demo@123';

// Two demo portals with one member per portal role.
async function seedDemoPortals() {
  const portals = [
    { name: 'Acme Careers', slug: 'acme-careers', domain: 'acme.example' },
    {
      name: 'TechCareers India',
      slug: 'techcareers-india',
      domain: 'techcareers.example',
    },
  ];

  for (const portal of portals) {
    const team = await client.team.create({
      data: { name: portal.name, slug: portal.slug },
    });
    const roleIds = await provisionPortal(team.id, portal.name);

    await client.portalBranding.update({
      where: { teamId: team.id },
      data: {
        heroTitle: `Join ${portal.name}`,
        heroSubtitle: 'Find your next role with us',
      },
    });

    const password = await hash(DEMO_PASSWORD, 12);

    for (const def of SYSTEM_ROLES) {
      const user = await client.user.create({
        data: {
          name: `${def.name} (${portal.slug})`,
          email: `${def.key.replace('_', '-')}@${portal.domain}`,
          password,
          emailVerified: new Date(),
        },
      });
      await client.teamMember.create({
        data: {
          teamId: team.id,
          userId: user.id,
          role: def.baseRole,
          portalRoleId: roleIds.get(def.key),
        },
      });
    }
  }

  console.log(
    `Seeded demo portals (login as e.g. portal-owner@acme.example / ${DEMO_PASSWORD})`
  );
}

async function init() {
  const users = await seedUsers();
  const teams = await seedTeams();
  await seedTeamMembers(users, teams);
  await seedInvitations(teams, users);

  for (const team of teams) {
    await provisionPortal(team.id, team.name);
  }

  await seedDemoPortals();
}

init();
