import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';

type Tx = Prisma.TransactionClient;

/**
 * Locks the owner rows of a team (SELECT ... FOR UPDATE) so concurrent
 * removals/downgrades are serialised, and returns the owners' user ids.
 * Must be called inside an interactive transaction.
 */
export async function lockTeamOwners(tx: Tx, teamId: string) {
  const rows = await tx.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM "TeamMember"
    WHERE "teamId" = ${teamId} AND role = 'OWNER'
    FOR UPDATE`;

  return rows.map((r) => r.userId);
}

/**
 * Throws 400 if `userId` is the last owner of the team. Call it inside the
 * same transaction that removes or downgrades the member.
 */
export async function assertNotLastOwner(
  tx: Tx,
  teamId: string,
  userId: string
) {
  const owners = await lockTeamOwners(tx, teamId);

  if (owners.includes(userId) && owners.length <= 1) {
    throw new ApiError(400, 'A portal must have at least one owner.');
  }
}
