import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import { poolSchema, validateWithSchema } from '@/lib/zod';
import { createPool, listPools } from 'models/talent';

export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      anyPermission: ['candidates.read', 'candidates.search'],
    });

    res.status(200).json({ data: await listPools(ctx.team.id) });
  },
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'candidates.update',
    });
    const { name, description } = validateWithSchema(poolSchema, req.body);

    res.status(201).json({ data: await createPool(ctx, name, description) });
  },
});
