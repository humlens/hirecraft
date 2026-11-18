import type { NextApiRequest, NextApiResponse } from 'next';
import {
  handleError,
  methodNotAllowed,
  requireUser,
} from '@/lib/candidateAuth';
import { listMyApplications } from 'models/apply';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const user = await requireUser(req, res);

    if (req.method !== 'GET') {
      return methodNotAllowed(req, res, 'GET');
    }

    res.status(200).json({ data: await listMyApplications(user.id) });
  } catch (error) {
    handleError(res, error);
  }
}
