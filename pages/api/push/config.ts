import { route } from '@/lib/apiRoute';
import { requireUser } from '@/lib/candidateAuth';
import env from '@/lib/env';
import { pushEnabled } from '@/lib/push';
import { prisma } from '@/lib/prisma';

// What the browser needs to subscribe: the public VAPID key and whether this
// user already has a device subscribed.
export default route({
  GET: async (req, res) => {
    const user = await requireUser(req, res);

    res.status(200).json({
      data: {
        enabled: pushEnabled(),
        publicKey: pushEnabled() ? env.push.publicKey : null,
        devices: await prisma.pushSubscription.count({
          where: { userId: user.id },
        }),
      },
    });
  },
});
