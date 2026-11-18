import { ApiError } from '@/lib/errors';
import { getSession } from '@/lib/session';
import type { NextApiRequest, NextApiResponse } from 'next';
import { completeOAuth } from 'models/integration';

const cookie = (req: NextApiRequest, name: string) =>
  (req.headers.cookie ?? '')
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === name)?.[1];

// The provider sends the user back here. Needs the signed-in session (middleware),
// the signed state, and the nonce cookie set when the flow started.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const session = await getSession(req, res);

    if (!session?.user?.id) throw new ApiError(401, 'Unauthorized');

    const code = String(req.query.code ?? '');
    const state = String(req.query.state ?? '');

    if (req.query.error || !code || !state) {
      res.redirect(302, '/dashboard');

      return;
    }

    const r = await completeOAuth(String(req.query.provider), {
      code,
      state,
      cookieNonce: cookie(req, 'hc_oauth'),
      userId: session.user.id,
    });

    res.setHeader('Set-Cookie', 'hc_oauth=; Path=/api/integrations; Max-Age=0');
    res.redirect(
      302,
      `/teams/${r.slug}/settings/integrations?connected=${r.provider}`
    );
  } catch (error: any) {
    res
      .status(error.status || 500)
      .json({ error: { message: error.message || 'Something went wrong' } });
  }
}
