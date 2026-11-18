import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import { listTags } from 'models/talent';

export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      anyPermission: ['candidates.read', 'candidates.search'],
    });

    res.status(200).json({ data: await listTags(ctx.team.id) });
  },
});
