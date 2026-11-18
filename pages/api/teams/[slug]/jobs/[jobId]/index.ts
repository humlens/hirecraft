import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantContext } from '@/lib/tenant';
import { jobIdSchema, updateJobSchema, validateWithSchema } from '@/lib/zod';
import { deleteJob, getJob, updateJob } from 'models/job';
import { sendAudit } from '@/lib/retraced';
import { recordMetric } from '@/lib/metrics';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { method } = req;

  try {
    switch (method) {
      case 'GET':
        await handleGET(req, res);
        break;
      case 'PUT':
        await handlePUT(req, res);
        break;
      case 'DELETE':
        await handleDELETE(req, res);
        break;
      default:
        res.setHeader('Allow', 'GET, PUT, DELETE');
        res.status(405).json({
          error: { message: `Method ${method} Not Allowed` },
        });
    }
  } catch (error: any) {
    const message = error.message || 'Something went wrong';
    const status = error.status || 500;

    res.status(status).json({ error: { message } });
  }
}

const handleGET = async (req: NextApiRequest, res: NextApiResponse) => {
  const ctx = await requireTenantContext(req, res, { permission: 'jobs.read' });
  const { jobId } = validateWithSchema(jobIdSchema, req.query);

  res.status(200).json({ data: await getJob(ctx, jobId) });
};

const handlePUT = async (req: NextApiRequest, res: NextApiResponse) => {
  const ctx = await requireTenantContext(req, res, {
    permission: 'jobs.update',
  });
  const { jobId } = validateWithSchema(jobIdSchema, req.query);
  const input = validateWithSchema(updateJobSchema, req.body);

  const job = await updateJob(ctx, jobId, input);

  sendAudit({
    action: 'job.update',
    crud: 'u',
    user: ctx.user as never,
    team: ctx.team,
  });

  recordMetric('job.updated');

  res.status(200).json({ data: job });
};

// Soft delete
const handleDELETE = async (req: NextApiRequest, res: NextApiResponse) => {
  const ctx = await requireTenantContext(req, res, {
    permission: 'jobs.delete',
  });
  const { jobId } = validateWithSchema(jobIdSchema, req.query);

  await deleteJob(ctx, jobId);

  sendAudit({
    action: 'job.delete',
    crud: 'd',
    user: ctx.user as never,
    team: ctx.team,
  });

  res.status(200).json({ data: {} });
};
