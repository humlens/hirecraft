import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import { ruleIdSchema, validateWithSchema } from '@/lib/zod';
import { deleteRule, ruleSchema, updateRule } from 'models/automation';
import { sendAudit } from '@/lib/retraced';

export default route({
  PUT: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'automation.manage',
    });
    const { ruleId } = validateWithSchema(ruleIdSchema, req.query);
    const input = validateWithSchema(ruleSchema, req.body);
    const rule = await updateRule(ctx, ruleId, input);

    sendAudit({
      action: 'automation.update',
      crud: 'u',
      user: ctx.user as never,
      team: ctx.team,
    });

    res.status(200).json({ data: rule });
  },
  DELETE: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'automation.manage',
    });
    const { ruleId } = validateWithSchema(ruleIdSchema, req.query);

    await deleteRule(ctx, ruleId);

    sendAudit({
      action: 'automation.update',
      crud: 'd',
      user: ctx.user as never,
      team: ctx.team,
    });

    res.status(200).json({ data: {} });
  },
});
