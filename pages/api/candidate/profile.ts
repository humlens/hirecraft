import type { NextApiRequest, NextApiResponse } from 'next';
import {
  handleError,
  methodNotAllowed,
  requireUser,
} from '@/lib/candidateAuth';
import { candidateProfileSchema, validateWithSchema } from '@/lib/zod';
import { findProfile, updateProfile } from 'models/candidate';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const user = await requireUser(req, res);

    switch (req.method) {
      case 'GET':
        res.status(200).json({ data: await findProfile(user.id) });
        break;
      case 'PUT': {
        const input = validateWithSchema(candidateProfileSchema, req.body);

        res.status(200).json({ data: await updateProfile(user.id, input) });
        break;
      }
      default:
        methodNotAllowed(req, res, 'GET, PUT');
    }
  } catch (error) {
    handleError(res, error);
  }
}
