import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantContext } from '@/lib/tenant';
import {
  portalRoleIdSchema,
  updatePortalRoleSchema,
  validateWithSchema,
} from '@/lib/zod';
import {
  deletePortalRole,
  getPortalRole,
  updatePortalRole,
} from 'models/portalRole';
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
      case 'PUT':
        await handlePUT(req, res);
        break;
      case 'DELETE':
        await handleDELETE(req, res);
        break;
      default:
        res.setHeader('Allow', 'GET, PUT, DELETE');
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

const handleGET = async (req: NextApiRequest, res: NextApiResponse) => {
  const ctx = await requireTenantContext(req, res, {
    anyPermission: ['members.invite', 'members.remove', 'roles.manage'],
  });
  const { roleId } = validateWithSchema(portalRoleIdSchema, req.query);

  res.status(200).json({ data: await getPortalRole(ctx.team.id, roleId) });
};

const handlePUT = async (req: NextApiRequest, res: NextApiResponse) => {
  const ctx = await requireTenantContext(req, res, {
    permission: 'roles.manage',
  });
  const { roleId } = validateWithSchema(portalRoleIdSchema, req.query);
  const input = validateWithSchema(updatePortalRoleSchema, req.body);

  const role = await updatePortalRole(
    { permissions: ctx.permissions, actorRole: ctx.member.role },
    ctx.team.id,
    roleId,
    input
  );

  await sendEvent(ctx.team.id, 'role.updated', role);

  sendAudit({
    action: 'role.update',
    crud: 'u',
    user: ctx.user as never,
    team: ctx.team,
  });

  recordMetric('role.updated');

  res.status(200).json({ data: role });
};

const handleDELETE = async (req: NextApiRequest, res: NextApiResponse) => {
  const ctx = await requireTenantContext(req, res, {
    permission: 'roles.manage',
  });
  const { roleId } = validateWithSchema(portalRoleIdSchema, req.query);

  const role = await deletePortalRole(
    { permissions: ctx.permissions, actorRole: ctx.member.role },
    ctx.team.id,
    roleId
  );

  await sendEvent(ctx.team.id, 'role.removed', role);

  sendAudit({
    action: 'role.delete',
    crud: 'd',
    user: ctx.user as never,
    team: ctx.team,
  });

  recordMetric('role.removed');

  res.status(200).json({ data: {} });
};
