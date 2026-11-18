import type { NextApiRequest, NextApiResponse } from 'next';
import { ApiError } from '@/lib/errors';
import { enforceRateLimit } from '@/lib/rateLimit';
import {
  handleError,
  methodNotAllowed,
  requireUser,
} from '@/lib/candidateAuth';
import { applySchema, validateWithSchema } from '@/lib/zod';
import { applyToJob } from 'models/apply';
import { getPublicPortal } from 'models/publicPortal';
import { sendEvent } from '@/lib/svix';
import { recordMetric } from '@/lib/metrics';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    if (req.method !== 'POST') {
      return methodNotAllowed(req, res, 'POST');
    }

    const user = await requireUser(req, res);

    enforceRateLimit(`apply:${user.id}`, 30, 60 * 60);

    const portal = await getPublicPortal(String(req.query.portal ?? ''));

    if (!portal) {
      throw new ApiError(404, 'Portal not found.');
    }

    if (portal.suspended) {
      throw new ApiError(403, 'This portal is not accepting applications.');
    }

    const input = validateWithSchema(applySchema, req.body);

    const result = await applyToJob({
      user,
      teamId: portal.team.id,
      jobSlug: String(req.query.jobSlug ?? ''),
      // Consent is recorded against the privacy policy in force
      policyVersion: portal.branding.updatedAt?.toISOString() ?? 'default',
      input,
    });

    await sendEvent(portal.team.id, 'application.created', { ...result });

    recordMetric('application.created');

    res.status(201).json({ data: result });
  } catch (error) {
    handleError(res, error);
  }
}
