import { timingSafeEqual } from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import env from '@/lib/env';
import { runDueTasks } from '@/lib/ticker';

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);

  return x.length === y.length && timingSafeEqual(x, y);
};

// GET /api/internal/cron  (Authorization: Bearer <CRON_SECRET>)
// The same work as POST /api/internal/tick, for schedulers that can only send
// GET: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: { message: 'Method Not Allowed' } });

    return;
  }

  if (!env.cronSecret) {
    res
      .status(503)
      .json({ error: { message: 'CRON_SECRET is not configured.' } });

    return;
  }

  const given = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');

  if (!same(given, env.cronSecret)) {
    res.status(401).json({ error: { message: 'Unauthorized' } });

    return;
  }

  try {
    res.status(200).json({ data: await runDueTasks() });
  } catch (error: any) {
    res
      .status(500)
      .json({ error: { message: error.message || 'Cron failed' } });
  }
}
