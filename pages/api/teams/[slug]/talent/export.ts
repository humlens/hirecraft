import { route } from '@/lib/apiRoute';
import { enforceRateLimit } from '@/lib/rateLimit';
import { sendAudit } from '@/lib/retraced';
import { requireTenantContext } from '@/lib/tenant';
import { exportCandidatesCsv } from 'models/talent';

export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'candidates.export',
    });

    enforceRateLimit(`export:${ctx.team.id}:${ctx.user.id}`, 10, 60 * 60);

    const raw = typeof req.query.ids === 'string' ? req.query.ids : '';
    const ids = raw
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 500);
    const { csv, count } = await exportCandidatesCsv(ctx, ids);

    // Exporting personal data is always audited
    sendAudit({
      action: 'candidates.export',
      crud: 'r',
      user: ctx.user as never,
      team: ctx.team,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="candidates.csv"'
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Row-Count', String(count));
    res.status(200).send(csv);
  },
});
