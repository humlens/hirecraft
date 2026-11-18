import type { NextApiRequest, NextApiResponse } from 'next';
import { requirePermission } from '@/lib/authz';
import { ApiError } from '@/lib/errors';
import { requireTenantContext } from '@/lib/tenant';
import { jobActionSchema, jobIdSchema, validateWithSchema } from '@/lib/zod';
import { runJobAction } from 'models/job';
import { sendAudit } from '@/lib/retraced';
import { sendEvent } from '@/lib/svix';

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

    await handlePOST(req, res);
  } catch (error: any) {
    const message = error.message || 'Something went wrong';
    const status = error.status || 500;

    res.status(status).json({ error: { message, ...(error.details ?? {}) } });
  }
}

// publish | schedule | close | reopen | archive | duplicate
const handlePOST = async (req: NextApiRequest, res: NextApiResponse) => {
  const ctx = await requireTenantContext(req, res);
  const { jobId } = validateWithSchema(jobIdSchema, req.query);
  const input = validateWithSchema(jobActionSchema, req.body);

  switch (input.action) {
    case 'publish':
    case 'schedule':
    case 'close':
    case 'reopen':
      requirePermission(ctx, 'jobs.publish');
      break;
    case 'archive':
      requirePermission(ctx, 'jobs.delete');
      break;
    case 'duplicate':
      requirePermission(ctx, 'jobs.create');
      break;
    default:
      throw new ApiError(400, 'Unknown action');
  }

  const job = await runJobAction(ctx, jobId, input);

  const audit = {
    publish: 'job.publish',
    schedule: 'job.publish',
    close: 'job.close',
    reopen: 'job.publish',
    archive: 'job.archive',
    duplicate: 'job.create',
  } as const;

  sendAudit({
    action: audit[input.action],
    crud: 'u',
    user: ctx.user as never,
    team: ctx.team,
  });

  if (input.action === 'publish' || input.action === 'reopen') {
    await sendEvent(ctx.team.id, 'job.published', {
      id: job.id,
      title: job.title,
      slug: job.slug,
    });
  }

  if (input.action === 'close') {
    await sendEvent(ctx.team.id, 'job.closed', {
      id: job.id,
      title: job.title,
      slug: job.slug,
    });
  }

  res.status(200).json({ data: job });
};
