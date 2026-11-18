import { route } from '@/lib/apiRoute';
import { requireUser } from '@/lib/candidateAuth';
import { ApiError } from '@/lib/errors';
import { NOTIFICATION_TYPES, isNotificationType } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';
import { preferencesSchema, validateWithSchema } from '@/lib/zod';

const list = async (userId: string) => {
  const saved = await prisma.notificationPreference.findMany({
    where: { userId },
  });
  const byType = new Map(saved.map((p) => [p.type, p]));

  return Object.entries(NOTIFICATION_TYPES).map(([type, def]) => ({
    type,
    label: def.label,
    inApp: byType.get(type)?.inApp ?? true,
    email: byType.get(type)?.email ?? def.email,
    push: byType.get(type)?.push ?? def.push,
  }));
};

export default route({
  GET: async (req, res) => {
    const user = await requireUser(req, res);

    res.status(200).json({ data: await list(user.id) });
  },
  PUT: async (req, res) => {
    const user = await requireUser(req, res);
    const { preferences } = validateWithSchema(preferencesSchema, req.body);

    for (const p of preferences) {
      if (!isNotificationType(p.type)) {
        throw new ApiError(422, `Unknown notification type: ${p.type}`);
      }

      const push = p.push ?? NOTIFICATION_TYPES[p.type].push;

      await prisma.notificationPreference.upsert({
        where: { userId_type: { userId: user.id, type: p.type } },
        create: {
          userId: user.id,
          type: p.type,
          inApp: p.inApp,
          email: p.email,
          push,
        },
        update: {
          inApp: p.inApp,
          email: p.email,
          ...(p.push === undefined ? {} : { push: p.push }),
        },
      });
    }

    res.status(200).json({ data: await list(user.id) });
  },
});
