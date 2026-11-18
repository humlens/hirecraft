import { route } from '@/lib/apiRoute';
import { enforceRateLimit } from '@/lib/rateLimit';
import { requireTenantContext } from '@/lib/tenant';
import { testConnection } from 'models/ai/settings';

export default route({
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'ai.configure',
    });

    enforceRateLimit(`ai-test:${ctx.team.id}`, 10, 60);

    res.status(200).json({ data: await testConnection(ctx) });
  },
});
