import type { NextApiRequest, NextApiResponse } from 'next';
import {
  handleError,
  methodNotAllowed,
  requireUser,
} from '@/lib/candidateAuth';
import { eraseCandidate, exportCandidateData } from 'models/candidate';

// GET = export my data (JSON). DELETE = erase my account.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const user = await requireUser(req, res);

    switch (req.method) {
      case 'GET':
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader(
          'Content-Disposition',
          'attachment; filename="my-data.json"'
        );
        res.status(200).json({ data: await exportCandidateData(user.id) });
        break;
      case 'DELETE':
        await eraseCandidate(user.id);
        res.status(200).json({ data: {} });
        break;
      default:
        methodNotAllowed(req, res, 'GET, DELETE');
    }
  } catch (error) {
    handleError(res, error);
  }
}
