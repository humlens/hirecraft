import { z } from 'zod';
import { route, queryWithout } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import { validateWithSchema } from '@/lib/zod';
import { getReviewQueue } from 'models/reviewQueue';

export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'applications.read',
    });
    const q = validateWithSchema(
      z.object({
        jobId: z.string().min(1).max(64).optional(),
        limit: z.coerce.number().int().min(1).max(50).optional(),
      }),
      queryWithout(req, 'slug')
    );

    res.status(200).json({ data: await getReviewQueue(ctx, q) });
  },
});
