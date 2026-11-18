import { assertEntitlement } from '@/lib/entitlements';
import type { NextApiRequest, NextApiResponse } from 'next';
import { ApiError } from '@/lib/errors';
import { requireTenantContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/authz';
import { updatePortalSchema, validateWithSchema } from '@/lib/zod';
import { getPortal, updatePortal } from 'models/portal';
import { sendAudit } from '@/lib/retraced';
import { recordMetric } from '@/lib/metrics';

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
      case 'PUT':
        await handlePUT(req, res);
        break;
      default:
        res.setHeader('Allow', 'GET, PUT');
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

// Portal profile and branding
const handleGET = async (req: NextApiRequest, res: NextApiResponse) => {
  const ctx = await requireTenantContext(req, res, {
    permission: 'portal.read',
  });

  const { profile, branding } = await getPortal(ctx.team.id);

  res.status(200).json({
    data: {
      team: { name: ctx.team.name, slug: ctx.team.slug },
      profile,
      branding,
      canUpdateProfile: ctx.permissions.has('portal.update'),
      canUpdateBranding: ctx.permissions.has('branding.update'),
    },
  });
};

const handlePUT = async (req: NextApiRequest, res: NextApiResponse) => {
  const ctx = await requireTenantContext(req, res);

  const input = validateWithSchema(updatePortalSchema, req.body);

  // Each section is guarded by its own permission.
  if (input.profile) {
    requirePermission(ctx, 'portal.update');
  }

  if (input.branding) {
    requirePermission(ctx, 'branding.update');
    await assertEntitlement(ctx.team.id, { feature: 'branding' });
  }

  if (!input.profile && !input.branding) {
    throw new ApiError(422, 'Nothing to update');
  }

  const result = await updatePortal(ctx.team.id, ctx.team.name, input);

  if (input.profile) {
    sendAudit({
      action: 'portal.update',
      crud: 'u',
      user: ctx.user as never,
      team: ctx.team,
    });
  }

  if (input.branding) {
    sendAudit({
      action: 'portal.branding.update',
      crud: 'u',
      user: ctx.user as never,
      team: ctx.team,
    });
  }

  recordMetric('portal.updated');

  res.status(200).json({ data: result });
};
