import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import { poolMemberSchema, validateWithSchema } from '@/lib/zod';
import { z } from 'zod';
import { setPoolMember } from 'models/talent';

export default route({
  PUT: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'candidates.update',
    });
    const { poolId } = validateWithSchema(
      z.object({ poolId: z.string().min(1).max(64) }),
      req.query
    );
    const { candidateId, member } = validateWithSchema(
      poolMemberSchema,
      req.body
    );

    await setPoolMember(ctx, poolId, candidateId, member);

    res.status(200).json({ data: {} });
  },
});
