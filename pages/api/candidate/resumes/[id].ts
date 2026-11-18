import type { NextApiRequest, NextApiResponse } from 'next';
import {
  handleError,
  methodNotAllowed,
  requireUser,
} from '@/lib/candidateAuth';
import { getSignedUrl } from '@/lib/storage';
import { deleteOwnResume, getOwnResume } from 'models/candidate';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const user = await requireUser(req, res);
    const id = String(req.query.id ?? '');

    switch (req.method) {
      case 'GET': {
        const resume = await getOwnResume(user.id, id);
        const url = await getSignedUrl(resume.storageKey, {
          fileName: resume.fileName,
        });

        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({ data: { url, fileName: resume.fileName } });
        break;
      }
      case 'DELETE':
        await deleteOwnResume(user.id, id);
        res.status(200).json({ data: {} });
        break;
      default:
        methodNotAllowed(req, res, 'GET, DELETE');
    }
  } catch (error) {
    handleError(res, error);
  }
}
