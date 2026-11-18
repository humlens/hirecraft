import { route } from '@/lib/apiRoute';
import { enforceRateLimit } from '@/lib/rateLimit';
import { sendAudit } from '@/lib/retraced';
import { requireTenantContext } from '@/lib/tenant';
import { importSchema, validateWithSchema } from '@/lib/zod';
import { importCandidates } from 'models/talent';

export const config = { api: { bodyParser: { sizeLimit: '1.5mb' } } };

// CSV with a header row: name,email[,phone][,tags]  (tags separated by ; or |)
export default route({
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'candidates.import',
    });

    enforceRateLimit(`import:${ctx.team.id}`, 20, 60 * 60);

    const { csv, poolId } = validateWithSchema(importSchema, req.body);
    const result = await importCandidates(ctx, csv, { poolId });

    sendAudit({
      action: 'candidates.import',
      crud: 'c',
      user: ctx.user as never,
      team: ctx.team,
    });

    res.status(200).json({ data: result });
  },
});
