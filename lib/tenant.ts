import type { Team, TeamMember } from '@prisma/client';
import type { NextApiRequest, NextApiResponse } from 'next';
import { ApiError } from './errors';
import {
  getDataScope,
  getEffectivePermissions,
  requirePermission,
  requireAnyPermission,
} from './authz';
import type { PermissionKey } from './portal-roles';
import { prisma } from './prisma';
import { getSession } from './session';
import { teamSlugSchema, validateWithSchema } from './zod';

export type TenantUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

export type TenantContext = {
  user: TenantUser;
  team: Team;
  member: TeamMember & {
    portalRole: {
      id: string;
      key: string;
      name: string;
      permissions: { permission: { key: string } }[];
    } | null;
  };
  permissions: Set<PermissionKey>;
  scope: 'all' | 'assigned';
};

/**
 * Resolves the tenant for an API request and authorises the caller.
 *
 * The tenant comes from the `[slug]` route parameter only (never from the
 * body), membership is checked on the server, a suspended portal is locked
 * out, and the effective permission set is attached.
 *
 * Every tenant-facing handler must start with this function.
 */
export async function requireTenantContext(
  req: NextApiRequest,
  res: NextApiResponse,
  options: {
    permission?: PermissionKey;
    anyPermission?: PermissionKey[];
    allowSuspended?: boolean;
  } = {}
): Promise<TenantContext> {
  const session = await getSession(req, res);

  if (!session?.user?.id) {
    throw new ApiError(401, 'Unauthorized');
  }

  const { slug } = validateWithSchema(teamSlugSchema, req.query);

  const member = await prisma.teamMember.findFirst({
    where: { userId: session.user.id, team: { slug } },
    include: {
      team: true,
      portalRole: {
        select: {
          id: true,
          key: true,
          name: true,
          permissions: { select: { permission: { select: { key: true } } } },
        },
      },
    },
  });

  // Same response for "no such portal" and "not a member": no slug probing.
  if (!member) {
    throw new ApiError(403, 'You do not have access to this team.');
  }

  const { team, ...memberRow } = member;

  if (team.status === 'SUSPENDED' && !options.allowSuspended) {
    throw new ApiError(
      403,
      team.suspendedReason
        ? `This portal is suspended: ${team.suspendedReason}`
        : 'This portal is suspended.'
    );
  }

  const ctx: TenantContext = {
    user: session.user,
    team,
    member: memberRow,
    permissions: getEffectivePermissions(memberRow),
    scope: getDataScope(memberRow),
  };

  if (options.permission) {
    requirePermission(ctx, options.permission);
  }

  if (options.anyPermission) {
    requireAnyPermission(ctx, options.anyPermission);
  }

  return ctx;
}

/**
 * Builds a tenant context outside an HTTP request (background jobs), for a
 * user whose permission was already checked when the job was queued. Membership
 * and suspension are re-checked here.
 */
export async function buildTenantContext(
  teamId: string,
  userId: string
): Promise<TenantContext> {
  const member = await prisma.teamMember.findFirst({
    where: { teamId, userId },
    include: {
      team: true,
      user: { select: { id: true, name: true, email: true, image: true } },
      portalRole: {
        select: {
          id: true,
          key: true,
          name: true,
          permissions: { select: { permission: { select: { key: true } } } },
        },
      },
    },
  });

  if (!member || member.team.status === 'SUSPENDED') {
    throw new ApiError(403, 'You do not have access to this team.');
  }

  const { team, user, ...memberRow } = member;

  return {
    user,
    team,
    member: memberRow,
    permissions: getEffectivePermissions(memberRow),
    scope: getDataScope(memberRow),
  };
}
