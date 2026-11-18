import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import {
  applicationIdSchema,
  scheduleInterviewSchema,
  validateWithSchema,
} from '@/lib/zod';
import { interviewsForApplication, scheduleInterview } from 'models/interview';
import { sendAudit } from '@/lib/retraced';
import { sendEvent } from '@/lib/svix';

export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'interviews.manage',
    });
    const { applicationId } = validateWithSchema(
      applicationIdSchema,
      req.query
    );

    res
      .status(200)
      .json({ data: await interviewsForApplication(ctx, applicationId) });
  },
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'interviews.manage',
    });
    const { applicationId } = validateWithSchema(
      applicationIdSchema,
      req.query
    );
    const input = validateWithSchema(scheduleInterviewSchema, req.body);
    const interview = await scheduleInterview(ctx, applicationId, input);

    sendAudit({
      action: 'interview.schedule',
      crud: 'c',
      user: ctx.user as never,
      team: ctx.team,
    });
    await sendEvent(ctx.team.id, 'interview.scheduled', {
      interviewId: interview.id,
      applicationId,
      startsAt: interview.startsAt,
    });

    res.status(201).json({ data: interview });
  },
});
