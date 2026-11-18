import { route } from '@/lib/apiRoute';
import { requirePermission } from '@/lib/authz';
import { requireTenantContext } from '@/lib/tenant';
import { interviewIdSchema, validateWithSchema } from '@/lib/zod';
import { summarizeFeedback } from 'models/ai/interviewAssist';

export default route({
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'interviews.manage',
    });

    requirePermission(ctx, 'ai.use');

    const { interviewId } = validateWithSchema(interviewIdSchema, req.query);

    res.status(200).json({ data: await summarizeFeedback(ctx, interviewId) });
  },
});
