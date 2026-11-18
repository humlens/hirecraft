import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantContext, type TenantContext } from '@/lib/tenant';
import {
  applicationIdSchema,
  bulkMoveStageSchema,
  moveStageSchema,
  validateWithSchema,
} from '@/lib/zod';
import { moveApplicationStage } from 'models/application';
import { sendAudit } from '@/lib/retraced';
import { sendEvent } from '@/lib/svix';
import { recordMetric } from '@/lib/metrics';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({
        error: { message: `Method ${req.method} Not Allowed` },
      });

      return;
    }

    const ctx = await requireTenantContext(req, res, {
      permission: 'applications.manage',
    });

    // Single move: { applicationId, stageId }; bulk: { applicationIds, stageId }
    if (Array.isArray(req.body?.applicationIds)) {
      const input = validateWithSchema(bulkMoveStageSchema, req.body);
      const results: { applicationId: string; ok: boolean; error?: string }[] =
        [];

      for (const applicationId of input.applicationIds) {
        try {
          await move(ctx, applicationId, input.stageId, input.rejectionReason);
          results.push({ applicationId, ok: true });
        } catch (error: any) {
          results.push({ applicationId, ok: false, error: error.message });
        }
      }

      res.status(200).json({ data: { results } });

      return;
    }

    const { applicationId } = validateWithSchema(applicationIdSchema, req.body);
    const input = validateWithSchema(moveStageSchema, req.body);
    const result = await move(
      ctx,
      applicationId,
      input.stageId,
      input.rejectionReason
    );

    res.status(200).json({ data: result });
  } catch (error: any) {
    const message = error.message || 'Something went wrong';
    const status = error.status || 500;

    res.status(status).json({ error: { message } });
  }
}

async function move(
  ctx: TenantContext,
  applicationId: string,
  stageId: string,
  reason?: string
) {
  const result = await moveApplicationStage(
    ctx,
    applicationId,
    stageId,
    reason
  );

  sendAudit({
    action: 'application.stage_change',
    crud: 'u',
    user: ctx.user as never,
    team: ctx.team,
  });

  await sendEvent(ctx.team.id, 'application.stage_changed', { ...result });

  if (result.to.kind === 'HIRED') {
    await sendEvent(ctx.team.id, 'candidate.hired', { ...result });
  }

  recordMetric('application.stage_changed');

  return result;
}
