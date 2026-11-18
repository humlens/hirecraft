import { route, queryWithout } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import {
  createStageSchema,
  stagesQuerySchema,
  validateWithSchema,
} from '@/lib/zod';
import { createStage, listStages } from 'models/stages';
import { sendAudit } from '@/lib/retraced';

export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'automation.manage',
    });
    const { jobId } = validateWithSchema(
      stagesQuerySchema,
      queryWithout(req, 'slug')
    );

    res.status(200).json({ data: await listStages(ctx, jobId) });
  },
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'automation.manage',
    });
    const input = validateWithSchema(createStageSchema, req.body);
    const stage = await createStage(ctx, input);

    sendAudit({
      action: 'pipeline.update',
      crud: 'c',
      user: ctx.user as never,
      team: ctx.team,
    });

    res.status(201).json({ data: stage });
  },
});
