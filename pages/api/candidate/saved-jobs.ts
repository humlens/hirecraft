import type { NextApiRequest, NextApiResponse } from 'next';
import {
  handleError,
  methodNotAllowed,
  requireUser,
} from '@/lib/candidateAuth';
import { savedJobSchema, validateWithSchema } from '@/lib/zod';
import { listSavedJobs, saveJob, unsaveJob } from 'models/apply';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const user = await requireUser(req, res);

    switch (req.method) {
      case 'GET':
        res.status(200).json({ data: await listSavedJobs(user.id) });
        break;
      case 'POST': {
        const { jobId } = validateWithSchema(savedJobSchema, req.body);

        await saveJob(user.id, jobId);
        res.status(201).json({ data: {} });
        break;
      }
      case 'DELETE': {
        const { jobId } = validateWithSchema(savedJobSchema, req.query);

        await unsaveJob(user.id, jobId);
        res.status(200).json({ data: {} });
        break;
      }
      default:
        methodNotAllowed(req, res, 'GET, POST, DELETE');
    }
  } catch (error) {
    handleError(res, error);
  }
}
