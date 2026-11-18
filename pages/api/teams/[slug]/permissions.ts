import { permissions } from '@/lib/permissions';
import { requireTenantContext } from '@/lib/tenant';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    switch (req.method) {
      case 'GET':
        await handleGET(req, res);
        break;
      default:
        res.setHeader('Allow', 'GET');
        res.status(405).json({
          error: { message: `Method ${req.method} Not Allowed` },
        });
    }
  } catch (error: any) {
    const message = error.message || 'Something went wrong';
    const status = error.status || 500;

    res.status(status).json({ error: { message } });
  }
}

// Get permissions for a team for the current user
const handleGET = async (req: NextApiRequest, res: NextApiResponse) => {
  const ctx = await requireTenantContext(req, res);

  res.json({
    // Legacy resource/action permissions (SSO, webhooks, API keys, ...)
    data: permissions[ctx.member.role],
    // Portal permission keys and role of the current member
    portal: {
      keys: Array.from(ctx.permissions).sort(),
      role: ctx.member.portalRole
        ? { id: ctx.member.portalRole.id, name: ctx.member.portalRole.name }
        : null,
      baseRole: ctx.member.role,
      scope: ctx.scope,
    },
  });
};
