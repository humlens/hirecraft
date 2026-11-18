import type { NextApiRequest, NextApiResponse } from 'next';

type Handler = (req: NextApiRequest, res: NextApiResponse) => Promise<void>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Same shape as the kit's hand-written route handlers: dispatch on the HTTP
 * method, 405 with an `Allow` header otherwise, and one error format
 * `{ error: { message } }` using `error.status` (ApiError) or 500.
 */
export const route =
  (handlers: Partial<Record<Method, Handler>>) =>
  async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      const handler = handlers[req.method as Method];

      if (!handler) {
        res.setHeader('Allow', Object.keys(handlers).join(', '));
        res.status(405).json({
          error: { message: `Method ${req.method} Not Allowed` },
        });

        return;
      }

      await handler(req, res);
    } catch (error: any) {
      const message = error.message || 'Something went wrong';
      const status = error.status || 500;

      res.status(status).json({ error: { message, ...(error.details ?? {}) } });
    }
  };

/** Query params without the `[slug]` route param. */
export const queryWithout = (req: NextApiRequest, ...keys: string[]) =>
  Object.fromEntries(
    Object.entries(req.query).filter(([k]) => !keys.includes(k))
  );
