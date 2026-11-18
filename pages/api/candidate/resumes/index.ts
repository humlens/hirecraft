import { randomUUID } from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import env from '@/lib/env';
import { ApiError } from '@/lib/errors';
import { enforceRateLimit } from '@/lib/rateLimit';
import { putObject } from '@/lib/storage';
import {
  readBodyLimited,
  scanUpload,
  validateResume,
} from '@/lib/uploadValidation';
import {
  handleError,
  methodNotAllowed,
  requireUser,
} from '@/lib/candidateAuth';
import { prisma } from '@/lib/prisma';
import { ensureProfile, listResumes, MAX_RESUMES } from 'models/candidate';

// The body is the raw file: we read the stream ourselves to enforce a size cap.
export const config = { api: { bodyParser: false } };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const user = await requireUser(req, res);

    switch (req.method) {
      case 'GET':
        res.status(200).json({ data: await listResumes(user.id) });
        break;
      case 'POST':
        await handlePOST(req, res, user.id);
        break;
      default:
        methodNotAllowed(req, res, 'GET, POST');
    }
  } catch (error) {
    handleError(res, error);
  }
}

// Upload: POST with the file as the body, `Content-Type` = file MIME type and
// `X-File-Name` = url-encoded original name.
const handlePOST = async (
  req: NextApiRequest,
  res: NextApiResponse,
  userId: string
) => {
  enforceRateLimit(`upload:${userId}`, 20, 60 * 60);

  const max = env.storage.maxResumeBytes;
  const declared = Number(req.headers['content-length'] ?? 0);

  if (declared > max) {
    throw new ApiError(413, 'File too large.');
  }

  const mime = (req.headers['content-type'] ?? '').split(';')[0].trim();
  let fileName = 'resume';

  try {
    fileName = decodeURIComponent(
      String(req.headers['x-file-name'] ?? 'resume')
    );
  } catch {
    // keep default
  }

  fileName = fileName.replace(/[^\w.\- ]/g, '_').slice(0, 120) || 'resume';

  const profile = await ensureProfile(userId);
  const count = await prisma.candidateResume.count({
    where: { profileId: profile.id, deletedAt: null },
  });

  if (count >= MAX_RESUMES) {
    throw new ApiError(400, `You can keep at most ${MAX_RESUMES} resumes.`);
  }

  const buffer = await readBodyLimited(req, max);
  const ext = validateResume(buffer, mime, max);

  await scanUpload(buffer, { fileName, mime });

  const storageKey = `candidates/${userId}/resumes/${randomUUID()}.${ext}`;

  await putObject(storageKey, buffer, mime);

  const resume = await prisma.candidateResume.create({
    data: {
      profileId: profile.id,
      storageKey,
      fileName,
      mime,
      size: buffer.length,
      version: count + 1,
      isDefault: count === 0,
      // Parsing is manual until Phase 4 (AI resume parser)
      parseStatus: 'PENDING',
    },
    select: {
      id: true,
      fileName: true,
      mime: true,
      size: true,
      version: true,
      isDefault: true,
      parseStatus: true,
      createdAt: true,
    },
  });

  res.status(201).json({ data: resume });
};
