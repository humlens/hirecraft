import type { NextApiRequest, NextApiResponse } from 'next';
import {
  handleError,
  methodNotAllowed,
  requireUser,
} from '@/lib/candidateAuth';
import { withdrawMyApplication } from 'models/apply';
import { sendEvent } from '@/lib/svix';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const user = await requireUser(req, res);

    if (req.method !== 'POST') {
      return methodNotAllowed(req, res, 'POST');
    }

    const result = await withdrawMyApplication(
      user.id,
      String(req.query.id ?? '')
    );

    await sendEvent(result.teamId, 'application.withdrawn', { ...result });

    res.status(200).json({ data: {} });
  } catch (error) {
    handleError(res, error);
  }
}
