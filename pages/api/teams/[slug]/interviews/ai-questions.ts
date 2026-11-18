import { z } from 'zod';
import { route } from '@/lib/apiRoute';
import { requirePermission } from '@/lib/authz';
import { requireTenantContext } from '@/lib/tenant';
import { validateWithSchema } from '@/lib/zod';
import { suggestInterviewQuestions } from 'models/ai/interviewAssist';

const schema = z.object({
  applicationId: z.string().min(1).max(64),
  competencies: z.array(z.string().trim().min(1).max(60)).max(8).default([]),
});

export default route({
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'interviews.manage',
    });

    requirePermission(ctx, 'ai.use');

    const { applicationId, competencies } = validateWithSchema(
      schema,
      req.body
    );

    res
      .status(200)
      .json({
        data: await suggestInterviewQuestions(ctx, applicationId, competencies),
      });
  },
});
