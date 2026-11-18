import { route, queryWithout } from '@/lib/apiRoute';
import { ApiError } from '@/lib/errors';
import { requireTenantContext } from '@/lib/tenant';
import { memberPermissions } from 'models/interview';
import { prisma } from '@/lib/prisma';

const ALLOWED = ['feedback.submit', 'offers.approve'] as const;

// People of this portal who hold a given permission (for pickers such as
// interview participants and offer approvers). Needs interviews.manage or
// offers.manage, not full member management.
export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      anyPermission: ['interviews.manage', 'offers.manage'],
    });
    const { permission } = queryWithout(req, 'slug') as { permission?: string };

    if (!permission || !(ALLOWED as readonly string[]).includes(permission)) {
      throw new ApiError(
        422,
        `permission must be one of: ${ALLOWED.join(', ')}`
      );
    }

    const members = await prisma.teamMember.findMany({
      where: { teamId: ctx.team.id },
      select: {
        userId: true,
        user: { select: { name: true, email: true } },
        portalRole: { select: { name: true } },
      },
    });
    const out: {
      userId: string;
      name: string;
      email: string;
      role: string | null;
    }[] = [];

    for (const m of members) {
      const perms = await memberPermissions(ctx.team.id, m.userId);

      if (perms?.has(permission as (typeof ALLOWED)[number])) {
        out.push({
          userId: m.userId,
          name: m.user.name,
          email: m.user.email,
          role: m.portalRole?.name ?? null,
        });
      }
    }

    res.status(200).json({ data: out });
  },
});
