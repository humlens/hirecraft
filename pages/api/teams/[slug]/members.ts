import { ApiError } from '@/lib/errors';
import { sendAudit } from '@/lib/retraced';
import { sendEvent } from '@/lib/svix';
import { Role } from '@prisma/client';
import { getTeamMembers } from 'models/team';
import { requireTenantContext } from '@/lib/tenant';
import { assertNotLastOwner } from '@/lib/ownerGuard';
import {
  assertCanGrantBaseRole,
  getEffectivePermissions,
  assertCanGrant,
} from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { resolveAssignableRole } from 'models/portalRole';
import type { NextApiRequest, NextApiResponse } from 'next';
import { recordMetric } from '@/lib/metrics';
import { validateMembershipOperation } from '@/lib/rbac';
import {
  deleteMemberSchema,
  updateMemberSchema,
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
      case 'DELETE':
        await handleDELETE(req, res);
        break;
      case 'PUT':
        await handlePUT(req, res);
        break;
      case 'PATCH':
        await handlePATCH(req, res);
        break;
      default:
        res.setHeader('Allow', 'GET, DELETE, PUT, PATCH');
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

// Get members of a team
const handleGET = async (req: NextApiRequest, res: NextApiResponse) => {
  const ctx = await requireTenantContext(req, res, {
    anyPermission: ['members.invite', 'members.remove', 'roles.manage'],
  });

  const members = await getTeamMembers(ctx.team.slug);

  recordMetric('member.fetched');

  res.status(200).json({ data: members });
};

// Delete the member from the team
const handleDELETE = async (req: NextApiRequest, res: NextApiResponse) => {
  const ctx = await requireTenantContext(req, res, {
    permission: 'members.remove',
  });

  const { memberId } = validateWithSchema(
    deleteMemberSchema,
    req.query as { memberId: string }
  );

  await assertCanManageTarget(ctx, memberId);

  await validateMembershipOperation(memberId, {
    ...ctx.member,
    team: ctx.team,
  });

  const teamMemberRemoved = await prisma.$transaction(async (tx) => {
    await assertNotLastOwner(tx, ctx.team.id, memberId);

    return tx.teamMember.delete({
      where: { teamId_userId: { teamId: ctx.team.id, userId: memberId } },
    });
  });

  await sendEvent(ctx.team.id, 'member.removed', teamMemberRemoved);

  sendAudit({
    action: 'member.remove',
    crud: 'd',
    user: ctx.user as never,
    team: ctx.team,
  });

  recordMetric('member.removed');

  res.status(200).json({ data: {} });
};

// Leave a team
const handlePUT = async (req: NextApiRequest, res: NextApiResponse) => {
  const ctx = await requireTenantContext(req, res, {
    permission: 'portal.read',
  });

  await prisma.$transaction(async (tx) => {
    await assertNotLastOwner(tx, ctx.team.id, ctx.user.id);

    await tx.teamMember.delete({
      where: {
        teamId_userId: { teamId: ctx.team.id, userId: ctx.user.id },
      },
    });
  });

  recordMetric('member.left');

  res.status(200).json({ data: {} });
};

// Update the role of a member
const handlePATCH = async (req: NextApiRequest, res: NextApiResponse) => {
  const ctx = await requireTenantContext(req, res, {
    permission: 'members.invite',
  });

  const { memberId, role, portalRoleId } = validateWithSchema(
    updateMemberSchema,
    req.body
  );

  if (memberId === ctx.user.id) {
    throw new ApiError(400, 'You cannot change your own role.');
  }

  await assertCanManageTarget(ctx, memberId);

  await validateMembershipOperation(
    memberId,
    { ...ctx.member, team: ctx.team },
    { role }
  );

  const actor = { permissions: ctx.permissions, actorRole: ctx.member.role };

  // Work out the new base role and portal role.
  let newRole: Role;
  let newPortalRoleId: string | null;

  if (portalRoleId) {
    const portalRole = await resolveAssignableRole(
      actor,
      ctx.team.id,
      portalRoleId
    );

    newRole = portalRole.baseRole;
    newPortalRoleId = portalRole.id;
  } else {
    // Legacy path: set the base role only, drop any portal role.
    newRole = role ?? Role.MEMBER;
    newPortalRoleId = null;
    assertCanGrantBaseRole(ctx.member.role, newRole);
  }

  const memberUpdated = await prisma.$transaction(async (tx) => {
    if (newRole !== Role.OWNER) {
      await assertNotLastOwner(tx, ctx.team.id, memberId);
    }

    return tx.teamMember.update({
      where: { teamId_userId: { teamId: ctx.team.id, userId: memberId } },
      data: { role: newRole, portalRoleId: newPortalRoleId },
    });
  });

  sendAudit({
    action: 'member.update',
    crud: 'u',
    user: ctx.user as never,
    team: ctx.team,
  });

  recordMetric('member.role.updated');

  res.status(200).json({ data: memberUpdated });
};

/**
 * An actor can only manage a member whose current permissions they fully
 * hold (no editing or removing someone more powerful than yourself).
 */
async function assertCanManageTarget(
  ctx: Awaited<ReturnType<typeof requireTenantContext>>,
  memberId: string
) {
  const target = await prisma.teamMember.findFirst({
    where: { teamId: ctx.team.id, userId: memberId },
    include: {
      portalRole: {
        select: {
          key: true,
          permissions: { select: { permission: { select: { key: true } } } },
        },
      },
    },
  });

  if (!target) {
    throw new ApiError(404, 'Member not found.');
  }

  assertCanGrantBaseRole(ctx.member.role, target.role);
  assertCanGrant(ctx, Array.from(getEffectivePermissions(target)));
}
