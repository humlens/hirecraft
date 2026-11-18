import { route } from '@/lib/apiRoute';
import { requirePermission } from '@/lib/authz';
import { requireTenantContext } from '@/lib/tenant';
import { jobIdSchema, validateWithSchema } from '@/lib/zod';
import { queueJobMatching } from 'models/ai/match';

// Queue an assessment for every active application of a job that has none
export default route({
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'applications.read',
    });

    requirePermission(ctx, 'ai.use');

    const { jobId } = validateWithSchema(jobIdSchema, req.query);

    res.status(202).json({ data: await queueJobMatching(ctx, jobId) });
  },
});
