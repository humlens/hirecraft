import { route } from '@/lib/apiRoute';
import env from '@/lib/env';
import { requireTenantContext } from '@/lib/tenant';

// The portal's Stripe invoices (billing history). Empty when the portal has no
// Stripe customer yet or Stripe is not configured; never throws on Stripe errors.
export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'billing.manage',
      allowReadOnly: true,
    });

    if (!ctx.team.billingId || !env.stripe.secretKey) {
      res.status(200).json({ data: [] });

      return;
    }

    try {
      // loaded lazily: the Stripe client cannot be created without a key
      const { stripe } = await import('@/lib/stripe');
      const list = await stripe.invoices.list({
        customer: ctx.team.billingId,
        limit: 12,
      });

      res.status(200).json({
        data: list.data.map((i) => ({
          id: i.id,
          date: new Date(i.created * 1000).toISOString(),
          description:
            i.lines?.data?.[0]?.description ?? i.description ?? 'Subscription',
          amount: (i.status === 'paid' ? i.amount_paid : i.amount_due) / 100,
          currency: i.currency.toUpperCase(),
          status: i.status,
          retried: (i.attempt_count ?? 0) > 1,
          url: i.hosted_invoice_url ?? null,
        })),
      });
    } catch {
      res.status(200).json({ data: [] });
    }
  },
});
