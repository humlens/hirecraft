import type { NextApiRequest, NextApiResponse } from 'next';
import { ApiError } from './errors';
import { getSession } from './session';

/** Signed-in user for candidate APIs (any account may act as a candidate). */
export async function requireUser(req: NextApiRequest, res: NextApiResponse) {
  const session = await getSession(req, res);

  if (!session?.user?.id) {
    throw new ApiError(401, 'Unauthorized');
  }

  return session.user as { id: string; email: string; name: string };
}

export const handleError = (res: NextApiResponse, error: any) => {
  const message = error.message || 'Something went wrong';
  const status = error.status || 500;

  res.status(status).json({ error: { message } });
};

export const methodNotAllowed = (
  req: NextApiRequest,
  res: NextApiResponse,
  allow: string
) => {
  res.setHeader('Allow', allow);
  res.status(405).json({
    error: { message: `Method ${req.method} Not Allowed` },
  });
};
