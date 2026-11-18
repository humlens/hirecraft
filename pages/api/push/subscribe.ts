import { z } from 'zod';
import { route } from '@/lib/apiRoute';
import { requireUser } from '@/lib/candidateAuth';
import { ApiError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { pushEnabled } from '@/lib/push';
import { validateWithSchema } from '@/lib/zod';

const b64url = z
  .string()
  .min(8)
  .max(300)
  .regex(/^[A-Za-z0-9_\-+/=]+$/);
const subscribeSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(1000)
    .refine((u) => u.startsWith('https://'), 'Endpoint must be https'),
  keys: z.object({ p256dh: b64url, auth: b64url }),
});

// Subscribing is the user's consent to Web Push on this device. A device that
// switches accounts is re-assigned to the signed-in user (the endpoint is unique).
export default route({
  POST: async (req, res) => {
    const user = await requireUser(req, res);

    if (!pushEnabled()) {
      throw new ApiError(503, 'Push notifications are not enabled.');
    }

    const { endpoint, keys } = validateWithSchema(subscribeSchema, req.body);
    const count = await prisma.pushSubscription.count({
      where: { userId: user.id },
    });

    if (count >= 10) {
      throw new ApiError(409, 'Too many subscribed devices. Remove one first.');
    }

    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: {
        userId: user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200),
      },
      update: {
        userId: user.id,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
    });

    res.status(201).json({ data: { subscribed: true } });
  },
  DELETE: async (req, res) => {
    const user = await requireUser(req, res);
    const { endpoint } = validateWithSchema(
      z.object({ endpoint: z.string().url().max(1000) }),
      req.body
    );

    // only the owner can remove it; anything else is a silent no-op
    await prisma.pushSubscription.deleteMany({
      where: { endpoint, userId: user.id },
    });

    res.status(200).json({ data: { subscribed: false } });
  },
});
