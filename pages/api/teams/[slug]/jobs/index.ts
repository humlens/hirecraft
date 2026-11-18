import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantContext } from '@/lib/tenant';
import { createJobSchema, listJobsSchema, validateWithSchema } from '@/lib/zod';
import { createJob, listJobs } from 'models/job';
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
      case 'POST':
        await handlePOST(req, res);
        break;
      default:
        res.setHeader('Allow', 'GET, POST');
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

// List jobs (assignment-scoped roles only see their jobs)
const handleGET = async (req: NextApiRequest, res: NextApiResponse) => {
  const ctx = await requireTenantContext(req, res, { permission: 'jobs.read' });
  const query = Object.fromEntries(
    Object.entries(req.query).filter(([k]) => k !== 'slug')
  );
  const filters = validateWithSchema(listJobsSchema, query);

  const data = await listJobs(ctx, filters);

  res.status(200).json({ data });
};

// Create a draft job
const handlePOST = async (req: NextApiRequest, res: NextApiResponse) => {
  const ctx = await requireTenantContext(req, res, {
    permission: 'jobs.create',
  });
  const input = validateWithSchema(createJobSchema, req.body);

  const job = await createJob(ctx, input);

  sendAudit({
    action: 'job.create',
    crud: 'c',
    user: ctx.user as never,
    team: ctx.team,
  });

  recordMetric('job.created');

  res.status(201).json({ data: job });
};
