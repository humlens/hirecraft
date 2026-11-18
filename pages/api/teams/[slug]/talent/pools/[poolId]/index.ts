import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import { validateWithSchema } from '@/lib/zod';
import { z } from 'zod';
import { deletePool } from 'models/talent';

export default route({
  DELETE: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'candidates.update',
    });
    const { poolId } = validateWithSchema(
      z.object({ poolId: z.string().min(1).max(64) }),
      req.query
    );

    await deletePool(ctx, poolId);

    res.status(200).json({ data: {} });
  },
});
