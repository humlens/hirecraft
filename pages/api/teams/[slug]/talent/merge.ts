import { route } from '@/lib/apiRoute';
import { sendAudit } from '@/lib/retraced';
import { requireTenantContext } from '@/lib/tenant';
import { mergeSchema, validateWithSchema } from '@/lib/zod';
import { mergeCandidates } from 'models/talent';

export default route({
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'candidates.update',
    });
    const { sourceId, targetId } = validateWithSchema(mergeSchema, req.body);
    const result = await mergeCandidates(ctx, sourceId, targetId);

    sendAudit({
      action: 'candidate.merge',
      crud: 'u',
      user: ctx.user as never,
      team: ctx.team,
    });

    res.status(200).json({ data: result });
  },
});
