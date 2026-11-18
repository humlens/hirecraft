import { Prisma, type Role } from '@prisma/client';
import { ApiError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import {
  assertCanGrant,
  assertCanGrantBaseRole,
  type AuthzContext,
} from '@/lib/authz';
import { slugify } from '@/lib/server-common';
import { ensurePermissions, syncSystemRoles } from './portal';

const roleInclude = {
  permissions: { select: { permission: { select: { key: true } } } },
  _count: { select: { members: true, invitations: true } },
} satisfies Prisma.PortalRoleInclude;

export type PortalRoleView = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  baseRole: Role;
  isSystem: boolean;
  isOwnerRole: boolean;
  permissions: string[];
  memberCount: number;
};

const toView = (
  r: Prisma.PortalRoleGetPayload<{ include: typeof roleInclude }>
): PortalRoleView => ({
  id: r.id,
  key: r.key,
  name: r.name,
  description: r.description,
  baseRole: r.baseRole,
  isSystem: r.isSystem,
  isOwnerRole: r.isOwnerRole,
  permissions: r.permissions.map((p) => p.permission.key).sort(),
  memberCount: r._count.members,
});

/** Lists a portal's roles, lazily creating missing system roles. */
export async function listPortalRoles(teamId: string) {
  await prisma.$transaction((tx) => syncSystemRoles(tx, teamId));

  const roles = await prisma.portalRole.findMany({
    where: { teamId },
    include: roleInclude,
    orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
  });

  return roles.map(toView);
}

export async function getPortalRole(teamId: string, roleId: string) {
  const role = await prisma.portalRole.findFirst({
    where: { id: roleId, teamId },
    include: roleInclude,
  });

  if (!role) {
    throw new ApiError(404, 'Role not found.');
  }

  return toView(role);
}

/**
 * Loads a role of this portal that the actor is allowed to hand out.
 * Prevents cross-tenant role ids and privilege escalation.
 */
export async function resolveAssignableRole(
  actor: Pick<AuthzContext, 'permissions'> & { actorRole: Role },
  teamId: string,
  roleId: string
) {
  const role = await getPortalRole(teamId, roleId);

  assertCanGrantBaseRole(actor.actorRole, role.baseRole);
  assertCanGrant(actor, role.permissions);

  return role;
}

async function permissionIdsFor(tx: Prisma.TransactionClient, keys: string[]) {
  const all = await ensurePermissions(tx);

  return keys.map((k) => all.get(k) as string);
}

export async function createPortalRole(
  actor: Pick<AuthzContext, 'permissions'> & { actorRole: Role },
  teamId: string,
  input: {
    name: string;
    description?: string;
    baseRole: 'MEMBER' | 'ADMIN';
    permissions: string[];
  }
) {
  assertCanGrantBaseRole(actor.actorRole, input.baseRole);
  assertCanGrant(actor, input.permissions);

  const key = `custom_${slugify(input.name)}`;

  try {
    const role = await prisma.$transaction(async (tx) => {
      const ids = await permissionIdsFor(tx, input.permissions);

      return tx.portalRole.create({
        data: {
          teamId,
          key,
          name: input.name,
          description: input.description,
          baseRole: input.baseRole,
          isSystem: false,
          permissions: {
            create: ids.map((permissionId) => ({ permissionId })),
          },
        },
        include: roleInclude,
      });
    });

    return toView(role);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ApiError(409, 'A role with this name already exists.');
    }

    throw error;
  }
}

export async function updatePortalRole(
  actor: Pick<AuthzContext, 'permissions'> & { actorRole: Role },
  teamId: string,
  roleId: string,
  input: {
    name?: string;
    description?: string;
    baseRole?: 'MEMBER' | 'ADMIN';
    permissions?: string[];
  }
) {
  const existing = await getPortalRole(teamId, roleId);

  if (existing.isSystem) {
    throw new ApiError(400, 'System roles cannot be modified.');
  }

  // The actor must be able to grant both the old and the new shape, so a
  // limited user cannot edit a role that is more powerful than themselves.
  assertCanGrantBaseRole(actor.actorRole, existing.baseRole);
  assertCanGrant(actor, existing.permissions);

  if (input.baseRole) {
    assertCanGrantBaseRole(actor.actorRole, input.baseRole);
  }

  if (input.permissions) {
    assertCanGrant(actor, input.permissions);
  }

  const role = await prisma.$transaction(async (tx) => {
    if (input.permissions) {
      const ids = await permissionIdsFor(tx, input.permissions);

      await tx.portalRolePermission.deleteMany({ where: { roleId } });
      await tx.portalRolePermission.createMany({
        data: ids.map((permissionId) => ({ roleId, permissionId })),
      });
    }

    // Members and pending invitations that use this role follow its base role.
    if (input.baseRole) {
      await tx.teamMember.updateMany({
        where: { teamId, portalRoleId: roleId },
        data: { role: input.baseRole },
      });
      await tx.invitation.updateMany({
        where: { teamId, portalRoleId: roleId },
        data: { role: input.baseRole },
      });
    }

    return tx.portalRole.update({
      where: { id: roleId, teamId },
      data: {
        ...(input.name && { name: input.name }),
        ...(input.description !== undefined && {
          description: input.description,
        }),
        ...(input.baseRole && { baseRole: input.baseRole }),
      },
      include: roleInclude,
    });
  });

  return toView(role);
}

export async function deletePortalRole(
  actor: Pick<AuthzContext, 'permissions'> & { actorRole: Role },
  teamId: string,
  roleId: string
) {
  const existing = await getPortalRole(teamId, roleId);

  if (existing.isSystem) {
    throw new ApiError(400, 'System roles cannot be deleted.');
  }

  assertCanGrantBaseRole(actor.actorRole, existing.baseRole);
  assertCanGrant(actor, existing.permissions);

  const inUse = await prisma.invitation.count({
    where: { teamId, portalRoleId: roleId },
  });

  if (existing.memberCount > 0 || inUse > 0) {
    throw new ApiError(
      409,
      'This role is assigned to members or pending invitations. Reassign them first.'
    );
  }

  await prisma.portalRole.delete({ where: { id: roleId, teamId } });

  return existing;
}
