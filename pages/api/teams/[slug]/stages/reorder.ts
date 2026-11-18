import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import { reorderStagesSchema, validateWithSchema } from '@/lib/zod';
import { reorderStages } from 'models/stages';
import { sendAudit } from '@/lib/retraced';

export default route({
  PUT: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'automation.manage',
    });
    const { orderedIds, jobId } = validateWithSchema(
      reorderStagesSchema,
      req.body
    );
    const stages = await reorderStages(ctx, orderedIds, jobId);

    sendAudit({
      action: 'pipeline.update',
      crud: 'u',
      user: ctx.user as never,
      team: ctx.team,
    });

    res.status(200).json({ data: stages });
  },
});
