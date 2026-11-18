import { z } from 'zod';
import { route } from '@/lib/apiRoute';
import { PLANS } from '@/lib/entitlements';
import { ApiError } from '@/lib/errors';
import { logPlatformAction, requirePlatformAdmin } from '@/lib/platformAdmin';
import { unguardedPrisma } from '@/lib/prisma';
import { validateWithSchema } from '@/lib/zod';

const patchSchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    reason: z.string().trim().max(300).optional(),
    planOverride: z.enum(PLANS).nullable().optional(),
  })
  .refine(
    (v) => v.status !== undefined || v.planOverride !== undefined,
    'Nothing to change'
  );

// Suspend / activate a portal and override its plan. Every change is logged.
export default route({
  PATCH: async (req, res) => {
    const admin = await requirePlatformAdmin(req, res);
    const id = String(req.query.id ?? '');
    const input = validateWithSchema(patchSchema, req.body);
    const team = await unguardedPrisma.team.findUnique({ where: { id } });

    if (!team) {
      throw new ApiError(404, 'Portal not found.');
    }

    const data: Record<string, unknown> = {};

    if (input.status) {
      data.status = input.status;
      data.suspendedReason =
        input.status === 'SUSPENDED' ? (input.reason ?? null) : null;
    }

    if (input.planOverride !== undefined) {
      data.planOverride = input.planOverride;
    }

    const updated = await unguardedPrisma.team.update({ where: { id }, data });

    if (input.status && input.status !== team.status) {
      await logPlatformAction(
        admin,
        input.status === 'SUSPENDED' ? 'tenant.suspend' : 'tenant.activate',
        id,
        { slug: team.slug, reason: input.reason ?? null }
      );
    }

    if (input.planOverride !== undefined) {
      await logPlatformAction(admin, 'tenant.plan_override', id, {
        slug: team.slug,
        from: team.planOverride,
        to: input.planOverride,
      });
    }

    res.status(200).json({
      data: {
        id: updated.id,
        status: updated.status,
        planOverride: updated.planOverride,
      },
    });
  },
});
