import { assertEntitlement } from '@/lib/entitlements';
import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import { validateWithSchema } from '@/lib/zod';
import { createRule, listRules, ruleSchema } from 'models/automation';
import { sendAudit } from '@/lib/retraced';

export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'automation.manage',
    });

    res.status(200).json({ data: await listRules(ctx.team.id) });
  },
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'automation.manage',
    });

    await assertEntitlement(ctx.team.id, { feature: 'automation' });

    const input = validateWithSchema(ruleSchema, req.body);
    const rule = await createRule(ctx, input);

    sendAudit({
      action: 'automation.update',
      crud: 'c',
      user: ctx.user as never,
      team: ctx.team,
    });

    res.status(201).json({ data: rule });
  },
});
