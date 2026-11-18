import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantContext } from '@/lib/tenant';
import { applicationIdSchema, validateWithSchema } from '@/lib/zod';
import { getApplicationResume } from 'models/application';
import { getSignedUrl } from '@/lib/storage';

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

    // Permission and assignment scope are checked BEFORE a URL is issued.
    const ctx = await requireTenantContext(req, res, {
      permission: 'applications.read',
    });
    const { applicationId } = validateWithSchema(
      applicationIdSchema,
      req.query
    );
    const resume = await getApplicationResume(ctx, applicationId);

    const url = await getSignedUrl(resume.storageKey, {
      fileName: resume.fileName,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ data: { url, fileName: resume.fileName } });
  } catch (error: any) {
    const message = error.message || 'Something went wrong';
    const status = error.status || 500;

    res.status(status).json({ error: { message } });
  }
}
