import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import {
  renameStageSchema,
  stageIdSchema,
  validateWithSchema,
} from '@/lib/zod';
import { deleteStage, renameStage } from 'models/stages';
import { sendAudit } from '@/lib/retraced';

export default route({
  PUT: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'automation.manage',
    });
    const { stageId } = validateWithSchema(stageIdSchema, req.query);
    const { name } = validateWithSchema(renameStageSchema, req.body);
    const stage = await renameStage(ctx, stageId, name);

    sendAudit({
      action: 'pipeline.update',
      crud: 'u',
      user: ctx.user as never,
      team: ctx.team,
    });

    res.status(200).json({ data: stage });
  },
  DELETE: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'automation.manage',
    });
    const { stageId } = validateWithSchema(stageIdSchema, req.query);

    await deleteStage(ctx, stageId);

    sendAudit({
      action: 'pipeline.update',
      crud: 'd',
      user: ctx.user as never,
      team: ctx.team,
    });

    res.status(200).json({ data: {} });
  },
});
