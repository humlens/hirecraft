import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import { findDuplicates } from 'models/talent';

export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'candidates.update',
    });

    res.status(200).json({ data: await findDuplicates(ctx) });
  },
});
