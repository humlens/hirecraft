import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantContext } from '@/lib/tenant';
import { applicationIdSchema, validateWithSchema } from '@/lib/zod';
import { getApplication } from 'models/application';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({
        error: { message: `Method ${req.method} Not Allowed` },
      });

      return;
    }

    const ctx = await requireTenantContext(req, res, {
      permission: 'applications.read',
    });
    const { applicationId } = validateWithSchema(
      applicationIdSchema,
      req.query
    );

    res.status(200).json({ data: await getApplication(ctx, applicationId) });
  } catch (error: any) {
    const message = error.message || 'Something went wrong';
    const status = error.status || 500;

    res.status(status).json({ error: { message } });
  }
}
