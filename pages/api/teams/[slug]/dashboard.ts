import { z } from 'zod';
import { route, queryWithout } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import { validateWithSchema } from '@/lib/zod';
import { getDashboard } from 'models/dashboard';

// Any member may open the dashboard; the numbers follow their job scope.
export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res);
    const { days } = validateWithSchema(
      z.object({
        days: z.coerce
          .number()
          .int()
          .refine((d) => [7, 30, 90].includes(d), '7, 30 or 90')
          .default(30),
      }),
      queryWithout(req, 'slug')
    );

    res.status(200).json({ data: await getDashboard(ctx, days) });
  },
});
