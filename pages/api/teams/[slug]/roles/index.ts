import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantContext } from '@/lib/tenant';
import { PERMISSIONS } from '@/lib/portal-roles';
import { createPortalRoleSchema, validateWithSchema } from '@/lib/zod';
import { createPortalRole, listPortalRoles } from 'models/portalRole';
import { sendAudit } from '@/lib/retraced';
import { sendEvent } from '@/lib/svix';
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
      case 'POST':
        await handlePOST(req, res);
        break;
      default:
        res.setHeader('Allow', 'GET, POST');
        res.status(405).json({
          error: { message: `Method ${method} Not Allowed` },
        });
    }
  } catch (error: any) {
    const message = error.message || 'Something went wrong';
    const status = error.status || 500;

    res.status(status).json({ error: { message } });
  }
}

// List the roles of a portal, plus the permission catalogue
const handleGET = async (req: NextApiRequest, res: NextApiResponse) => {
  const ctx = await requireTenantContext(req, res, {
    anyPermission: ['members.invite', 'members.remove', 'roles.manage'],
  });

  const roles = await listPortalRoles(ctx.team.id);

  res.status(200).json({
    data: {
      roles,
      permissions: PERMISSIONS,
      canManage: ctx.permissions.has('roles.manage'),
    },
  });
};

// Create a custom role
const handlePOST = async (req: NextApiRequest, res: NextApiResponse) => {
  const ctx = await requireTenantContext(req, res, {
    permission: 'roles.manage',
  });

  const input = validateWithSchema(createPortalRoleSchema, req.body);

  const role = await createPortalRole(
    { permissions: ctx.permissions, actorRole: ctx.member.role },
    ctx.team.id,
    input
  );

  await sendEvent(ctx.team.id, 'role.created', role);

  sendAudit({
    action: 'role.create',
    crud: 'c',
    user: ctx.user as never,
    team: ctx.team,
  });

  recordMetric('role.created');

  res.status(201).json({ data: role });
};
