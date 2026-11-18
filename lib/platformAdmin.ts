import type { NextApiRequest, NextApiResponse } from 'next';
import env from './env';
import { ApiError } from './errors';
import { prisma, unguardedPrisma } from './prisma';
import { getSession } from './session';

/**
 * Platform super admin: a platform-wide role that is separate from every portal
 * role. Admins are the accounts whose VERIFIED email is listed in
 * PLATFORM_ADMIN_EMAILS (comma-separated). Nothing in a portal can grant it.
 */
export async function requirePlatformAdmin(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getSession(req, res);

  if (!session?.user?.id) {
    throw new ApiError(401, 'Unauthorized');
  }

  const user = await unguardedPrisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, emailVerified: true },
  });

  // Same answer for "not an admin" and "no such thing": do not reveal the area exists.
  if (
    !user ||
    !user.emailVerified ||
    !env.platformAdminEmails.includes(user.email.toLowerCase())
  ) {
    throw new ApiError(403, 'You do not have access to this area.');
  }

  return user;
}

/** Append-only record of what a platform admin did. */
export async function logPlatformAction(
  actor: { id: string; email: string },
  action: string,
  targetTeamId: string | null,
  details: Record<string, unknown> = {}
) {
  await prisma.platformAuditLog.create({
    data: {
      actorUserId: actor.id,
      actorEmail: actor.email,
      action,
      targetTeamId,
      details: details as never,
    },
  });
}
