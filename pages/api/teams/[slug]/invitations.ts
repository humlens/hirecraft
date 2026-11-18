import { assertEntitlement } from '@/lib/entitlements';
import { sendTeamInviteEmail } from '@/lib/email/sendTeamInviteEmail';
import { ApiError } from '@/lib/errors';
import { sendAudit } from '@/lib/retraced';
import { getSession } from '@/lib/session';
import { sendEvent } from '@/lib/svix';
import {
  createInvitation,
  deleteInvitation,
  getInvitation,
  getInvitationCount,
  getInvitations,
  isInvitationExpired,
} from 'models/invitation';
import { requireTenantContext } from '@/lib/tenant';
import { assertCanGrantBaseRole } from '@/lib/authz';
import { resolveAssignableRole } from 'models/portalRole';
import { prisma } from '@/lib/prisma';
import type { NextApiRequest, NextApiResponse } from 'next';
import { recordMetric } from '@/lib/metrics';
import { extractEmailDomain, isEmailAllowed } from '@/lib/email/utils';
import { Invitation, Role } from '@prisma/client';
import { countTeamMembers } from 'models/teamMember';
import { syncSystemRoles } from 'models/portal';
import {
  acceptInvitationSchema,
  deleteInvitationSchema,
  getInvitationsSchema,
  inviteViaEmailSchema,
  validateWithSchema,
} from '@/lib/zod';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { method } = req;

  try {
    switch (method) {
      case 'GET':
        await handleGET(req, res);
        break;
      case 'POST':
        await handlePOST(req, res);
        break;
      case 'PUT':
        await handlePUT(req, res);
        break;
      case 'DELETE':
        await handleDELETE(req, res);
        break;
      default:
        res.setHeader('Allow', 'GET, POST, PUT, DELETE');
        res.status(405).json({
          error: { message: `Method ${method} Not Allowed` },
        });
    }
  } catch (error: any) {
    const message = error.message || 'Something went wrong';
    const status = error.status || 500;

    res.status(status).json({ error: { message, ...(error.details ?? {}) } });
  }
}

// Invite a user to a team
const handlePOST = async (req: NextApiRequest, res: NextApiResponse) => {
  const ctx = await requireTenantContext(req, res, {
    permission: 'members.invite',
  });
  const teamMember = { ...ctx.member, team: ctx.team, user: ctx.user as never };

  const input = validateWithSchema(inviteViaEmailSchema, req.body) as {
    email?: string;
    role?: Role;
    portalRoleId?: string;
    sentViaEmail: boolean;
    domains?: string;
  };
  const { email, sentViaEmail, domains } = input;

  // a seat is reserved by an email invitation; link invites take one when someone joins
  if (sentViaEmail) {
    await assertEntitlement(ctx.team.id, { limit: 'seats' });
  }

  // The role a person is invited with can never exceed the inviter's own.
  let role: Role = input.role ?? Role.MEMBER;
  let portalRoleId: string | null = null;

  if (input.portalRoleId) {
    const portalRole = await resolveAssignableRole(
      { permissions: ctx.permissions, actorRole: ctx.member.role },
      ctx.team.id,
      input.portalRoleId
    );

    role = portalRole.baseRole;
    portalRoleId = portalRole.id;
  } else {
    assertCanGrantBaseRole(ctx.member.role, role);
  }

  let invitation: undefined | Invitation = undefined;

  // Invite via email
  if (sentViaEmail) {
    if (!email) {
      throw new ApiError(400, 'Email is required.');
    }

    if (!isEmailAllowed(email)) {
      throw new ApiError(
        400,
        'It seems you entered a non-business email. Invitations can only be sent to work emails.'
      );
    }

    /*
    Aggregate  (cost=12.61..12.62 rows=1 width=8) (actual time=0.040..0.040 rows=1 loops=1)
  ->  Nested Loop  (cost=0.42..12.60 rows=1 width=32) (actual time=0.037..0.038 rows=1 loops=1)
        ->  Index Scan using "User_email_key" on "User" j1  (cost=0.14..8.16 rows=1 width=37) (actual time=0.025..0.026 rows=1 loops=1)
              Index Cond: (email = 'admin@example.com'::text)
              Filter: (id IS NOT NULL)
        ->  Index Only Scan using "TeamMember_teamId_userId_key" on "TeamMember"  (cost=0.28..4.30 rows=1 width=37) (actual time=0.010..0.010 rows=1 loops=1)
              Index Cond: (("teamId" = '386a5102-0427-403a-b6c1-877de86d1ce0'::text) AND ("userId" = j1.id))
              Heap Fetches: 0
Planning Time: 1.472 ms
Execution Time: 0.065 ms
    */

    /*
SELECT COUNT(*) FROM (
    SELECT 
        "public"."TeamMember"."id" 
    FROM "public"."TeamMember" LEFT JOIN "public"."User" AS "j1" ON ("j1"."id") = ("public"."TeamMember"."userId") 
    WHERE ("public"."TeamMember"."teamId" = '7974330a-c8ca-4043-9e3c-3f326d1b6973' AND ("j1"."email" = 'admin@example.com' AND ("j1"."id" IS NOT NULL))) 
    OFFSET 0
) AS "sub"
*/

    /*
Aggregate  (cost=2.05..2.06 rows=1 width=8) (actual time=0.046..0.047 rows=1 loops=1)
  ->  Nested Loop  (cost=0.00..2.04 rows=1 width=32) (actual time=0.046..0.046 rows=0 loops=1)
        Join Filter: ("TeamMember"."userId" = j1.id)
        Rows Removed by Join Filter: 1
        ->  Seq Scan on "TeamMember"  (cost=0.00..1.01 rows=1 width=37) (actual time=0.028..0.028 rows=1 loops=1)
              Filter: ("teamId" = '7974330a-c8ca-4043-9e3c-3f326d1b6973'::text)
              Rows Removed by Filter: 4
        ->  Seq Scan on "User" j1  (cost=0.00..1.01 rows=1 width=37) (actual time=0.011..0.011 rows=1 loops=1)
              Filter: ((id IS NOT NULL) AND (email = 'admin@example.com'::text))
              Rows Removed by Filter: 2
Planning Time: 1.285 ms
Execution Time: 0.152 ms
*/
    const memberExists = await countTeamMembers({
      where: {
        teamId: teamMember.teamId,
        user: {
          email,
        },
      },
    });

    if (memberExists) {
      throw new ApiError(400, 'This user is already a member of the team.');
    }

    const invitationExists = await getInvitationCount({
      where: {
        email,
        teamId: teamMember.teamId,
      },
    });

    if (invitationExists) {
      throw new ApiError(400, 'An invitation already exists for this email.');
    }

    invitation = await createInvitation({
      teamId: teamMember.teamId,
      invitedBy: teamMember.userId,
      email,
      role,
      portalRoleId,
      sentViaEmail: true,
      allowedDomains: [],
    });
  }

  // Invite via link
  if (!sentViaEmail) {
    invitation = await createInvitation({
      teamId: teamMember.teamId,
      invitedBy: teamMember.userId,
      role,
      portalRoleId,
      email: null,
      sentViaEmail: false,
      allowedDomains: domains
        ? domains.split(',').map((d) => d.trim().toLowerCase())
        : [],
    });
  }

  if (!invitation) {
    throw new ApiError(400, 'Could not create invitation. Please try again.');
  }

  if (invitation.sentViaEmail) {
    await sendTeamInviteEmail(teamMember.team, invitation);
  }

  await sendEvent(teamMember.teamId, 'invitation.created', invitation);

  sendAudit({
    action: 'member.invitation.create',
    crud: 'c',
    user: teamMember.user,
    team: teamMember.team,
  });

  recordMetric('invitation.created');

  res.status(204).end();
};

// Get all invitations for a team
const handleGET = async (req: NextApiRequest, res: NextApiResponse) => {
  const teamMember = await requireTenantContext(req, res, {
    anyPermission: ['members.invite', 'members.remove', 'roles.manage'],
  });

  const { sentViaEmail } = validateWithSchema(
    getInvitationsSchema,
    req.query as { sentViaEmail: string }
  );

  const invitations = await getInvitations(
    teamMember.team.id,
    sentViaEmail === 'true'
  );

  recordMetric('invitation.fetched');

  res.status(200).json({ data: invitations });
};

// Delete an invitation
const handleDELETE = async (req: NextApiRequest, res: NextApiResponse) => {
  const ctx = await requireTenantContext(req, res, {
    permission: 'members.invite',
  });
  const teamMember = { ...ctx.member, team: ctx.team, user: ctx.user as never };

  const { id } = validateWithSchema(
    deleteInvitationSchema,
    req.query as { id: string }
  );

  const invitation = await getInvitation({ id });

  if (
    invitation.invitedBy != ctx.user.id ||
    invitation.team.id != ctx.team.id
  ) {
    throw new ApiError(
      400,
      `You don't have permission to delete this invitation.`
    );
  }

  await deleteInvitation({ id });

  sendAudit({
    action: 'member.invitation.delete',
    crud: 'd',
    user: teamMember.user,
    team: teamMember.team,
  });

  await sendEvent(teamMember.teamId, 'invitation.removed', invitation);

  recordMetric('invitation.removed');

  res.status(200).json({ data: {} });
};

// Accept an invitation to an organization
const handlePUT = async (req: NextApiRequest, res: NextApiResponse) => {
  const { inviteToken } = validateWithSchema(
    acceptInvitationSchema,
    req.body as { inviteToken: string }
  );

  const invitation = await getInvitation({ token: inviteToken });

  if (await isInvitationExpired(invitation.expires)) {
    throw new ApiError(400, 'Invitation expired. Please request a new one.');
  }

  await assertEntitlement(invitation.teamId, {
    limit: 'seats',
    adding: invitation.sentViaEmail ? 0 : 1, // an email invite already holds its seat
  });

  const session = await getSession(req, res);
  const email = session?.user.email as string;

  // Make sure the user is logged in with the invited email address (Join via email)
  if (invitation.sentViaEmail && invitation.email !== email) {
    throw new ApiError(
      400,
      'You must be logged in with the email address you were invited with.'
    );
  }

  // Make sure the user is logged in with an allowed domain (Join via link)
  if (!invitation.sentViaEmail && invitation.allowedDomains.length) {
    const emailDomain = extractEmailDomain(email);
    const allowJoin = invitation.allowedDomains.find(
      (domain) => domain === emailDomain
    );

    if (!allowJoin) {
      throw new ApiError(
        400,
        'You must be logged in with an email address from an allowed domain.'
      );
    }
  }

  if (invitation.team.status === 'SUSPENDED') {
    throw new ApiError(403, 'This portal is suspended.');
  }

  const userId = session?.user?.id as string;

  // Join + invitation cleanup are atomic. An existing member keeps their
  // current role (an invitation must never silently change it).
  const teamMember = await prisma.$transaction(async (tx) => {
    const existing = await tx.teamMember.findUnique({
      where: { teamId_userId: { teamId: invitation.team.id, userId } },
    });

    if (existing) {
      throw new ApiError(400, 'You are already a member of this team.');
    }

    // Portals created before portal roles get their role copies on demand.
    await syncSystemRoles(tx, invitation.team.id);

    const portalRole = invitation.portalRoleId
      ? await tx.portalRole.findFirst({
          where: { id: invitation.portalRoleId, teamId: invitation.team.id },
        })
      : null;

    const member = await tx.teamMember.create({
      data: {
        teamId: invitation.team.id,
        userId,
        role: portalRole?.baseRole ?? invitation.role,
        portalRoleId: portalRole?.id ?? null,
      },
    });

    if (invitation.sentViaEmail) {
      await tx.invitation.delete({ where: { token: inviteToken } });
    }

    return member;
  });

  await sendEvent(invitation.team.id, 'member.created', teamMember);

  recordMetric('member.created');

  res.status(204).end();
};
