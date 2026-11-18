import type { Role } from '@prisma/client';
import { ApiError } from './errors';
import {
  ALL_PERMISSION_KEYS,
  ASSIGNMENT_SCOPED_ROLE_KEYS,
  BASE_ROLE_PERMISSIONS,
  type PermissionKey,
} from './portal-roles';

export type MemberWithPortalRole = {
  role: Role;
  portalRole?: {
    key: string;
    permissions: { permission: { key: string } }[];
  } | null;
};

export type AuthzContext = {
  member: MemberWithPortalRole;
  permissions: ReadonlySet<PermissionKey>;
};

/**
 * Effective permission keys of a member.
 *  - OWNER (base role) always gets every key.
 *  - A member with a portal role gets exactly that role's keys.
 *  - A member without a portal role gets what their base role implies.
 */
export function getEffectivePermissions(
  member: MemberWithPortalRole
): Set<PermissionKey> {
  if (member.role === 'OWNER') {
    return new Set(ALL_PERMISSION_KEYS);
  }

  if (member.portalRole) {
    const known = new Set<string>(ALL_PERMISSION_KEYS);

    return new Set(
      member.portalRole.permissions
        .map((p) => p.permission.key)
        .filter((k): k is PermissionKey => known.has(k))
    );
  }

  return new Set(BASE_ROLE_PERMISSIONS[member.role] ?? []);
}

export const hasPermission = (
  ctx: Pick<AuthzContext, 'permissions'>,
  key: PermissionKey
) => ctx.permissions.has(key);

export const hasAnyPermission = (
  ctx: Pick<AuthzContext, 'permissions'>,
  keys: PermissionKey[]
) => keys.some((k) => ctx.permissions.has(k));

export function requirePermission(
  ctx: Pick<AuthzContext, 'permissions'>,
  key: PermissionKey
) {
  if (!ctx.permissions.has(key)) {
    throw new ApiError(403, `You do not have the "${key}" permission.`);
  }
}

export function requireAnyPermission(
  ctx: Pick<AuthzContext, 'permissions'>,
  keys: PermissionKey[]
) {
  if (!hasAnyPermission(ctx, keys)) {
    throw new ApiError(
      403,
      `You need one of these permissions: ${keys.join(', ')}.`
    );
  }
}

/** Recruiters, hiring managers and interviewers only see assigned records. */
export const getDataScope = (
  member: MemberWithPortalRole
): 'all' | 'assigned' =>
  member.role !== 'OWNER' &&
  member.portalRole &&
  ASSIGNMENT_SCOPED_ROLE_KEYS.has(member.portalRole.key)
    ? 'assigned'
    : 'all';

/**
 * Privilege-escalation guard: an actor may only grant a set of permissions
 * (through a role) that they hold themselves.
 */
export function assertCanGrant(
  actor: Pick<AuthzContext, 'permissions'>,
  granted: readonly string[]
) {
  const missing = granted.filter(
    (k) => !actor.permissions.has(k as PermissionKey)
  );

  if (missing.length) {
    throw new ApiError(
      403,
      `You cannot grant permissions you do not hold: ${missing.join(', ')}.`
    );
  }
}

/** Base-role guard for grants: OWNER needs an owner, ADMIN needs admin+. */
export function assertCanGrantBaseRole(actorRole: Role, target: Role) {
  if (target === 'OWNER' && actorRole !== 'OWNER') {
    throw new ApiError(403, 'Only a Portal Owner can grant the Owner role.');
  }

  if (target === 'ADMIN' && actorRole === 'MEMBER') {
    throw new ApiError(403, 'You cannot grant an administrator role.');
  }
}
