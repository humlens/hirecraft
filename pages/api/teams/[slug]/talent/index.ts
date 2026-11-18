import { route, queryWithout } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import { listCandidatesSchema, validateWithSchema } from '@/lib/zod';
import { listCandidates } from 'models/talent';

export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      anyPermission: ['candidates.read', 'candidates.search'],
    });
    const f = validateWithSchema(
      listCandidatesSchema,
      queryWithout(req, 'slug')
    );

    res.status(200).json({ data: await listCandidates(ctx, f) });
  },
});
