import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import { jobIdSchema, validateWithSchema } from '@/lib/zod';
import { customizeJobPipeline, resetJobPipeline } from 'models/stages';
import { sendAudit } from '@/lib/retraced';

// Give a job its own pipeline (POST) or go back to the portal pipeline (DELETE)
export default route({
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'automation.manage',
    });
    const { jobId } = validateWithSchema(jobIdSchema, req.query);
    const stages = await customizeJobPipeline(ctx, jobId);

    sendAudit({
      action: 'pipeline.update',
      crud: 'c',
      user: ctx.user as never,
      team: ctx.team,
    });

    res.status(201).json({ data: stages });
  },
  DELETE: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'automation.manage',
    });
    const { jobId } = validateWithSchema(jobIdSchema, req.query);

    await resetJobPipeline(ctx, jobId);

    sendAudit({
      action: 'pipeline.update',
      crud: 'd',
      user: ctx.user as never,
      team: ctx.team,
    });

    res.status(200).json({ data: {} });
  },
});
