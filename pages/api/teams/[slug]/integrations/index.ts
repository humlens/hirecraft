import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import { listIntegrations } from 'models/integration';

export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'integrations.manage',
    });

    res.status(200).json({ data: await listIntegrations(ctx) });
  },
});
