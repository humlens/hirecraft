import type { NextApiRequest, NextApiResponse } from 'next';
import {
  handleError,
  methodNotAllowed,
  requireUser,
} from '@/lib/candidateAuth';
import { candidateProfileSchema, validateWithSchema } from '@/lib/zod';
import { findProfile, updateProfile } from 'models/candidate';
import { enqueue } from '@/lib/queue';

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

        const profile = await updateProfile(user.id, input);

        await enqueue('embed.profile', { userId: user.id });

        res.status(200).json({ data: profile });
        break;
      }
      default:
        methodNotAllowed(req, res, 'GET, PUT');
    }
  } catch (error) {
    handleError(res, error);
  }
}
