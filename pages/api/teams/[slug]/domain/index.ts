import { z } from 'zod';
import { route } from '@/lib/apiRoute';
import {
  normalizeHostname,
  newVerificationToken,
  verificationRecords,
} from '@/lib/domains';
import env from '@/lib/env';
import { assertEntitlement } from '@/lib/entitlements';
import { ApiError } from '@/lib/errors';
import { prisma, unguardedPrisma } from '@/lib/prisma';
import { sendAudit } from '@/lib/retraced';
import { requireTenantContext } from '@/lib/tenant';
import { validateWithSchema } from '@/lib/zod';

const view = (d: {
  id: string;
  hostname: string;
  verificationToken: string;
  verifiedAt: Date | null;
  certificateStatus: string;
  lastCheckedAt: Date | null;
  lastError: string | null;
}) => ({
  id: d.id,
  hostname: d.hostname,
  verified: !!d.verifiedAt,
  verifiedAt: d.verifiedAt,
  certificateStatus: d.certificateStatus,
  lastCheckedAt: d.lastCheckedAt,
  lastError: d.lastError,
  records: verificationRecords(d.hostname, d.verificationToken),
  url: d.verifiedAt ? `https://${d.hostname}` : null,
});

export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'domain.manage',
    });
    const rows = await prisma.portalDomain.findMany({
      where: { teamId: ctx.team.id },
      orderBy: { createdAt: 'asc' },
    });

    res.status(200).json({
      data: { enabled: env.customDomains.enabled, domains: rows.map(view) },
    });
  },
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'domain.manage',
    });

    if (!env.customDomains.enabled) {
      throw new ApiError(404, 'Custom domains are not enabled on this server.');
    }

    await assertEntitlement(ctx.team.id, { feature: 'customDomain' });

    const { hostname: raw } = validateWithSchema(
      z.object({ hostname: z.string().min(3).max(300) }),
      req.body
    );
    const hostname = normalizeHostname(raw);

    if (
      (await prisma.portalDomain.count({ where: { teamId: ctx.team.id } })) >= 1
    ) {
      throw new ApiError(
        409,
        'This portal already has a custom domain. Remove it first.'
      );
    }

    // A verified domain belongs to one portal. Unverified claims may coexist:
    // whoever proves DNS control first wins.
    const taken = await unguardedPrisma.portalDomain.findFirst({
      where: {
        teamId: { not: ctx.team.id },
        hostname,
        verifiedAt: { not: null },
      },
    });

    if (taken) {
      throw new ApiError(
        409,
        'This domain is already in use by another portal.'
      );
    }

    const row = await prisma.portalDomain.create({
      data: {
        teamId: ctx.team.id,
        hostname,
        verificationToken: newVerificationToken(),
      },
    });

    sendAudit({
      action: 'domain.add',
      crud: 'c',
      user: ctx.user as never,
      team: ctx.team,
    });
    res.status(201).json({ data: view(row) });
  },
  DELETE: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'domain.manage',
    });

    await prisma.portalDomain.deleteMany({ where: { teamId: ctx.team.id } });
    sendAudit({
      action: 'domain.remove',
      crud: 'd',
      user: ctx.user as never,
      team: ctx.team,
    });
    res.status(200).json({ data: { removed: true } });
  },
});

export { view as domainView };
