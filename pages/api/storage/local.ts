import type { NextApiRequest, NextApiResponse } from 'next';
import { readLocalSigned } from '@/lib/storage';

// Serves files for the local-disk storage driver (development and tests).
// Access requires a valid, unexpired HMAC signature. In production with S3,
// downloads go straight to short-lived pre-signed S3 URLs instead.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).end();

    return;
  }

  const q = (k: string) => String(req.query[k] ?? '');

  const result = await readLocalSigned({
    key: q('key'),
    expires: q('expires'),
    disposition: q('disposition'),
    sig: q('sig'),
  }).catch(() => ({ ok: false as const, status: 403, reason: 'invalid' }));

  if (!result.ok) {
    res.status(result.status).json({ error: { message: result.reason } });

    return;
  }

  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', result.disposition);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).send(result.body);
}
