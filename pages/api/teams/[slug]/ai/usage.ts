import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import { getRequestLog, getUsage } from 'models/ai/settings';

export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'ai.configure',
    });
    const withLog = req.query.log === '1';

    res.status(200).json({
      data: {
        usage: await getUsage(ctx),
        ...(withLog ? { log: await getRequestLog(ctx) } : {}),
      },
    });
  },
});
