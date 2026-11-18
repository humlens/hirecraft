import { route, queryWithout } from '@/lib/apiRoute';
import { requireUser } from '@/lib/candidateAuth';
import { prisma } from '@/lib/prisma';
import {
  markReadSchema,
  notificationsQuerySchema,
  validateWithSchema,
} from '@/lib/zod';

// The signed-in user's notifications (recruiter or candidate)
export default route({
  GET: async (req, res) => {
    const user = await requireUser(req, res);
    const q = validateWithSchema(notificationsQuerySchema, queryWithout(req));
    const where = { userId: user.id, ...(q.unread ? { readAt: null } : {}) };

    const [rows, unread] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      }),
      prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    const page = rows.slice(0, q.limit);

    res.status(200).json({
      data: {
        notifications: page,
        unread,
        nextCursor: rows.length > q.limit ? page[page.length - 1].id : null,
      },
    });
  },
  POST: async (req, res) => {
    const user = await requireUser(req, res);
    const input = validateWithSchema(markReadSchema, req.body);

    // Always scoped to the caller: other users' ids are silently ignored
    const r = await prisma.notification.updateMany({
      where: {
        userId: user.id,
        readAt: null,
        ...('ids' in input ? { id: { in: input.ids } } : {}),
      },
      data: { readAt: new Date() },
    });

    res.status(200).json({ data: { updated: r.count } });
  },
});
