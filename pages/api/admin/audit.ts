import { route } from '@/lib/apiRoute';
import { requirePlatformAdmin } from '@/lib/platformAdmin';
import { prisma } from '@/lib/prisma';

export default route({
  GET: async (req, res) => {
    await requirePlatformAdmin(req, res);
    res.status(200).json({
      data: await prisma.platformAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    });
  },
});
