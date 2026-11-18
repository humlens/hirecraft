import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import {
  interviewIdSchema,
  updateInterviewSchema,
  validateWithSchema,
} from '@/lib/zod';
import { getInterview, updateInterview } from 'models/interview';
import { sendAudit } from '@/lib/retraced';

export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      anyPermission: ['interviews.manage', 'feedback.submit'],
    });
    const { interviewId } = validateWithSchema(interviewIdSchema, req.query);

    res.status(200).json({ data: await getInterview(ctx, interviewId) });
  },
  PUT: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'interviews.manage',
    });
    const { interviewId } = validateWithSchema(interviewIdSchema, req.query);
    const input = validateWithSchema(updateInterviewSchema, req.body);

    const interview = await updateInterview(ctx, interviewId, input);

    sendAudit({
      action: 'interview.update',
      crud: 'u',
      user: ctx.user as never,
      team: ctx.team,
    });

    res.status(200).json({ data: interview });
  },
});
