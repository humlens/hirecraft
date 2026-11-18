import { route } from '@/lib/apiRoute';
import { checkDns } from '@/lib/domains';
import { ApiError } from '@/lib/errors';
import { prisma, unguardedPrisma } from '@/lib/prisma';
import { sendAudit } from '@/lib/retraced';
import { requireTenantContext } from '@/lib/tenant';
import { domainView } from './index';

// Checks the DNS records. On success the domain is verified for this portal and
// competing unverified claims of the same hostname are dropped. Certificates are
// issued by the edge proxy on first request (it asks /api/public/domains/resolve).
export default route({
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'domain.manage',
    });
    const d = await prisma.portalDomain.findFirst({
      where: { teamId: ctx.team.id },
    });

    if (!d) {
      throw new ApiError(404, 'Add a domain first.');
    }

    const r = await checkDns(d.hostname, d.verificationToken);

    if (!r.ok) {
      const row = await prisma.portalDomain.update({
        where: { id: d.id, teamId: ctx.team.id },
        data: { lastCheckedAt: new Date(), lastError: r.error },
      });

      res.status(200).json({
        data: {
          ...domainView(row),
          checks: { txt: r.txtOk, cname: r.cnameOk },
        },
      });

      return;
    }

    const row = await unguardedPrisma.$transaction(async (tx) => {
      // someone else may have verified it in the meantime
      const other = await tx.portalDomain.findFirst({
        where: {
          hostname: d.hostname,
          verifiedAt: { not: null },
          teamId: { not: ctx.team.id },
        },
      });

      if (other) {
        throw new ApiError(
          409,
          'This domain is already in use by another portal.'
        );
      }

      await tx.portalDomain.deleteMany({
        where: {
          hostname: d.hostname,
          teamId: { not: ctx.team.id },
          verifiedAt: null,
        },
      });

      return tx.portalDomain.update({
        where: { id: d.id },
        data: {
          verifiedAt: new Date(),
          certificateStatus: 'READY',
          lastCheckedAt: new Date(),
          lastError: null,
        },
      });
    });

    sendAudit({
      action: 'domain.verify',
      crud: 'u',
      user: ctx.user as never,
      team: ctx.team,
    });
    res.status(200).json({
      data: { ...domainView(row), checks: { txt: true, cname: true } },
    });
  },
});
