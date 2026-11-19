import { route, queryWithout } from '@/lib/apiRoute';
import { requirePermission } from '@/lib/authz';
import { enforceRateLimit } from '@/lib/rateLimit';
import { sendAudit } from '@/lib/retraced';
import { requireTenantContext } from '@/lib/tenant';
import { analyticsQuerySchema, validateWithSchema } from '@/lib/zod';
import { exportApplicationsCsv } from 'models/analytics';

// Applications report with personal data: needs analytics.read AND candidates.export
export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'analytics.read',
    });

    requirePermission(ctx, 'candidates.export');
    enforceRateLimit(`export:${ctx.team.id}:${ctx.user.id}`, 10, 60 * 60);

    const q = validateWithSchema(
      analyticsQuerySchema,
      queryWithout(req, 'slug')
    );
    const to = q.to ?? new Date();
    const from = q.from ?? new Date(to.getTime() - 30 * 86400_000);
    const { csv, count } = await exportApplicationsCsv(ctx, {
      from,
      to,
      jobId: q.jobId,
      recruiterId: q.recruiterId,
    });

    sendAudit({
      action: 'applications.export',
      crud: 'r',
      user: ctx.user as never,
      team: ctx.team,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="applications.csv"'
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Row-Count', String(count));
    res.status(200).send(csv);
  },
});
