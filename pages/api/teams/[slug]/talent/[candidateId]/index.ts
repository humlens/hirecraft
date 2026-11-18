import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import { candidateIdSchema, validateWithSchema } from '@/lib/zod';
import { getCandidate } from 'models/talent';

export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'candidates.read',
    });
    const { candidateId } = validateWithSchema(candidateIdSchema, req.query);

    res.status(200).json({ data: await getCandidate(ctx, candidateId) });
  },
});
