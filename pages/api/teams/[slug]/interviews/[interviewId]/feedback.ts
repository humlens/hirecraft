import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import {
  feedbackSchema,
  interviewIdSchema,
  validateWithSchema,
} from '@/lib/zod';
import { submitFeedback } from 'models/interview';

export default route({
  PUT: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'feedback.submit',
    });
    const { interviewId } = validateWithSchema(interviewIdSchema, req.query);
    const input = validateWithSchema(feedbackSchema, req.body);

    res
      .status(200)
      .json({ data: await submitFeedback(ctx, interviewId, input) });
  },
});
