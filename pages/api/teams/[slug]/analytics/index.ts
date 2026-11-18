import { route, queryWithout } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import { analyticsQuerySchema, validateWithSchema } from '@/lib/zod';
import { getAnalytics } from 'models/analytics';

export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'analytics.read',
    });
    const q = validateWithSchema(
      analyticsQuerySchema,
      queryWithout(req, 'slug')
    );
    const to = q.to ?? new Date();
    const from = q.from ?? new Date(to.getTime() - 30 * 86400_000);

    res
      .status(200)
      .json({ data: await getAnalytics(ctx, { from, to, jobId: q.jobId }) });
  },
});
