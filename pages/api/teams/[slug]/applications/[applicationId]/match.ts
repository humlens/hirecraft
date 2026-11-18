import { route } from '@/lib/apiRoute';
import { requirePermission } from '@/lib/authz';
import { sendAudit } from '@/lib/retraced';
import { requireTenantContext } from '@/lib/tenant';
import { applicationIdSchema, validateWithSchema } from '@/lib/zod';
import { assessApplication, listAssessments } from 'models/ai/match';

// AI match assessments (suggestions only; they never change an application)
export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'applications.read',
    });

    requirePermission(ctx, 'ai.use');

    const { applicationId } = validateWithSchema(
      applicationIdSchema,
      req.query
    );

    res.status(200).json({ data: await listAssessments(ctx, applicationId) });
  },
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'applications.read',
    });

    requirePermission(ctx, 'ai.use');

    const { applicationId } = validateWithSchema(
      applicationIdSchema,
      req.query
    );
    const result = await assessApplication(ctx, applicationId);

    sendAudit({
      action: 'ai.match',
      crud: 'c',
      user: ctx.user as never,
      team: ctx.team,
    });

    res.status(201).json({ data: result });
  },
});
