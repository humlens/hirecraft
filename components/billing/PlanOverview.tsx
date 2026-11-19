import { Error, Loading } from '@/components/shared';
import SettingsNav from '@/components/shared/shell/SettingsNav';
import { defaultHeaders } from '@/lib/common';
import useApi from 'hooks/useApi';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import toast from 'react-hot-toast';

type Def = { limits: Record<string, number | null>; features: string[] };
type Overview = {
  plan: string;
  label: string;
  limits: Record<string, number | null>;
  features: string[];
  usage: Record<string, number>;
  limitLabels: Record<string, string>;
  lifecycle: {
    inGrace: boolean;
    graceEndsAt: string | null;
    readOnly: boolean;
  };
  enforced: boolean;
  salesUrl: string | null;
  plans: ({ key: string; label: string } & Def)[];
  subscription: { renewsAt: string; cancelAt: string | null } | null;
  change?: {
    target: string;
    allowed: boolean;
    blockers: { limit: string; used: number; allowed: number }[];
  };
};
type Price = {
  id: string;
  amount: number | null;
  currency: string;
  metadata: { plan?: string; interval?: string };
};
type Invoice = {
  id: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
  status: string | null;
  retried: boolean;
  url: string | null;
};

const ORDER = ['free', 'starter', 'professional', 'enterprise'];
const show = (n: number | null) => (n === null ? '∞' : n.toLocaleString());

const money = (n: number, currency: string) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(n);

/** Plan, limits, live usage and billing history. Limits are enforced by the server, not by this page. */
const PlanOverview = ({ slug }: { slug: string }) => {
  const { t } = useTranslation('common');
  const [target, setTarget] = useState<string | null>(null);
  const [interval, setInterval] = useState<'month' | 'year'>('month');
  const { data, isLoading, isError } = useApi<Overview>(
    `/api/teams/${slug}/plan${target ? `?target=${target}` : ''}`
  );
  const products = useApi<{
    products: { prices: Price[] }[];
  }>(`/api/teams/${slug}/payments/products`);
  const invoices = useApi<Invoice[]>(`/api/teams/${slug}/payments/invoices`);

  if (isLoading && !data) return <Loading />;
  if (isError) return <Error message={isError.message} />;
  if (!data) return null;

  const prices = (products.data?.products ?? []).flatMap((p) => p.prices);
  const priceFor = (plan: string) =>
    prices.find(
      (p) => p.metadata?.plan === plan && p.metadata?.interval === interval
    );
  const keys = Object.keys(data.limits);
  const currentRank = ORDER.indexOf(data.plan);

  const openPortal = async () => {
    const r = await fetch(`/api/teams/${slug}/payments/create-portal-link`, {
      method: 'POST',
      headers: defaultHeaders,
      credentials: 'same-origin',
    });
    const json = await r.json();

    if (!r.ok) {
      toast.error(json.error?.message ?? t('stripe-checkout-fallback-error'));
      return;
    }

    window.open(json.data.url, '_blank', 'noopener,noreferrer');
  };

  const checkout = async (price: Price) => {
    const r = await fetch(
      `/api/teams/${slug}/payments/create-checkout-session`,
      {
        method: 'POST',
        headers: defaultHeaders,
        body: JSON.stringify({ price: price.id, quantity: 1 }),
      }
    );
    const json = await r.json();

    if (json?.data?.url) {
      window.open(json.data.url, '_blank', 'noopener,noreferrer');
    } else {
      toast.error(json?.error?.message ?? t('stripe-checkout-fallback-error'));
    }
  };

  const bullets = (p: Overview['plans'][number]) => {
    const f = new Set(p.features);
    const out = [
      p.key === 'free' ? t('plan-b-portal', '1 portal') : null,
      `${show(p.limits.activeJobs)} ${t('plan-b-jobs', 'active jobs')}`,
      `${show(p.limits.seats)} ${t('plan-b-seats', 'team members')}`,
      f.has('ai.assist') && !f.has('ai.match')
        ? t('plan-b-parse', 'AI resume parsing')
        : null,
      f.has('ai.match') ? t('plan-b-match', 'AI matching & copilot') : null,
      f.has('automation')
        ? t('plan-b-auto', 'Automation, custom branding')
        : null,
      f.has('customDomain')
        ? t('plan-b-ent', 'Custom domains, SAML SSO, SCIM')
        : null,
      f.has('api') ? t('plan-b-api', 'API access, custom roles') : null,
      f.has('byoKey') ? t('plan-b-byo', 'Bring your own AI key') : null,
      p.key !== 'enterprise'
        ? `${show(p.limits.aiCreditsPerMonth)} ${t('plan-b-credits', 'AI credits / mo')}`
        : null,
    ];

    return out.filter(Boolean) as string[];
  };

  return (
    <div className="space-y-4">
      <SettingsNav slug={slug} />
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h2 className="font-display text-3xl font-bold">
            {t('plan-title', 'Plans & billing')}
          </h2>
          <p className="text-sm opacity-70">
            {[
              data.label,
              data.subscription &&
                t('plan-renews', 'renews {{date}}', {
                  date: new Date(
                    data.subscription.renewsAt
                  ).toLocaleDateString(),
                }),
              data.subscription?.cancelAt &&
                t('plan-cancels', 'cancels on {{date}}', {
                  date: new Date(
                    data.subscription.cancelAt
                  ).toLocaleDateString(),
                }),
              data.lifecycle.inGrace || data.lifecycle.readOnly
                ? t('payment-failed', 'payment failed')
                : data.subscription
                  ? t('payment-active', 'payment active')
                  : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div
          role="group"
          aria-label={t('billing-interval', 'Billing interval')}
          className="flex rounded-xl bg-base-300/50 p-1 text-sm"
        >
          {(
            [
              ['month', t('monthly', 'Monthly')],
              ['year', t('annual-save', 'Annual · save 2 months')],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              aria-pressed={interval === k}
              onClick={() => setInterval(k)}
              className={`rounded-lg px-4 py-2 ${
                interval === k
                  ? 'bg-base-100 font-semibold shadow'
                  : 'opacity-70'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {data.lifecycle.inGrace && (
        <div role="alert" className="alert alert-warning text-sm">
          {t(
            'plan-grace',
            'Your last payment failed. Features stay on until {{date}}, then the portal becomes read-only. Update your payment method.',
            {
              date: new Date(
                data.lifecycle.graceEndsAt as string
              ).toLocaleDateString(),
            }
          )}
        </div>
      )}
      {data.lifecycle.readOnly && (
        <div role="alert" className="alert alert-error text-sm">
          {t(
            'plan-readonly',
            'This portal is read-only because a payment failed. Update your payment method to continue.'
          )}
        </div>
      )}
      {!data.enforced && (
        <p className="text-xs opacity-60">
          {t(
            'plan-not-enforced',
            'Plan limits are not enforced on this server.'
          )}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {data.plans.map((p) => {
          const current = p.key === data.plan;
          const rank = ORDER.indexOf(p.key);
          const price = priceFor(p.key);

          return (
            <article
              key={p.key}
              className={`flex flex-col gap-3 rounded-2xl border bg-base-100 p-6 ${current ? 'border-2 border-primary' : ''}`}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold">
                  {p.label}
                </h3>
                {current && (
                  <span className="badge badge-primary badge-soft">
                    {t('plan-current', 'Current')}
                  </span>
                )}
              </div>
              <p className="font-display text-2xl font-bold">
                {p.key === 'enterprise'
                  ? t('contact-sales', 'Contact sales')
                  : p.key === 'free'
                    ? money(0, price?.currency ?? 'INR')
                    : price?.amount != null
                      ? `${money(price.amount, price.currency)} / ${interval === 'month' ? t('mo', 'mo') : t('yr', 'yr')}`
                      : '—'}
              </p>
              <ul className="flex-1 list-disc space-y-1 pl-5 text-sm">
                {bullets(p).map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              {current ? (
                <button type="button" className="btn" disabled>
                  {t('current-plan', 'Current plan')}
                </button>
              ) : p.key === 'enterprise' ? (
                data.salesUrl ? (
                  <a className="btn btn-primary" href={data.salesUrl}>
                    {t('talk-to-sales', 'Talk to sales')}
                  </a>
                ) : (
                  <button type="button" className="btn btn-primary" disabled>
                    {t('talk-to-sales', 'Talk to sales')}
                  </button>
                )
              ) : rank > currentRank ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!price}
                  title={
                    price ? undefined : t('no-price', 'No price configured')
                  }
                  onClick={() => price && checkout(price)}
                >
                  {t('upgrade', 'Upgrade')}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setTarget(p.key)}
                >
                  {t('downgrade', 'Downgrade')}
                </button>
              )}
            </article>
          );
        })}
      </div>

      {data.change && (
        <div
          className={`rounded-2xl border p-4 text-sm ${data.change.allowed ? 'border-primary' : 'border-warning'}`}
        >
          {data.change.allowed ? (
            <p>
              {t(
                'plan-change-ok',
                'You can move to {{plan}}: your usage fits its limits.',
                {
                  plan: data.plans.find((p) => p.key === data.change?.target)
                    ?.label,
                }
              )}
            </p>
          ) : (
            <>
              <p className="font-medium">
                {t(
                  'plan-change-blocked',
                  'Not yet: your usage is above the limits of that plan.'
                )}
              </p>
              <ul className="list-disc pl-5">
                {data.change.blockers.map((b) => (
                  <li key={b.limit}>
                    {b.used} {data.limitLabels[b.limit]}{' '}
                    {t('plan-in-use', 'in use,')} {b.allowed}{' '}
                    {t('plan-allowed', 'allowed')}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="mt-2 flex gap-3">
            {data.change.allowed && (
              <button type="button" className="btn btn-sm" onClick={openPortal}>
                {t('continue-portal', 'Continue in the billing portal')}
              </button>
            )}
            <button
              type="button"
              className="link"
              onClick={() => setTarget(null)}
            >
              {t('plan-dismiss', 'Dismiss')}
            </button>
          </div>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="space-y-3 rounded-2xl border bg-base-100 p-6">
          <h3 className="font-display text-lg font-semibold">
            {t('plan-usage', 'Usage & limits')}
          </h3>
          {keys.map((k) => {
            const limit = data.limits[k];
            const used = data.usage[k] ?? 0;
            const pct = limit ? Math.min(100, (used / limit) * 100) : 0;

            return (
              <div key={k} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{data.limitLabels[k]}</span>
                  <strong>
                    {used.toLocaleString()} / {show(limit)}
                  </strong>
                </div>
                {limit !== null && (
                  <progress
                    className={`progress w-full ${pct >= 80 ? 'progress-warning' : 'progress-primary'}`}
                    value={pct}
                    max={100}
                    aria-label={data.limitLabels[k]}
                  />
                )}
              </div>
            );
          })}
          <p className="text-xs opacity-60">
            {t(
              'plan-server-enforced',
              'Limits are enforced on the server: publishing over the limit is blocked with an upgrade prompt.'
            )}
          </p>
        </section>

        <section className="space-y-3 rounded-2xl border bg-base-100 p-6">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-lg font-semibold">
              {t('billing-history', 'Billing history')}
            </h3>
            <button
              type="button"
              className="btn btn-outline"
              onClick={openPortal}
            >
              {t('update-payment', 'Update payment method')}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr className="text-xs uppercase">
                  <th>{t('date', 'Date')}</th>
                  <th>{t('description', 'Description')}</th>
                  <th>{t('amount', 'Amount')}</th>
                  <th>{t('status', 'Status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(invoices.data ?? []).map((i) => (
                  <tr key={i.id}>
                    <td>{new Date(i.date).toLocaleDateString()}</td>
                    <td>{i.description}</td>
                    <td>{money(i.amount, i.currency)}</td>
                    <td>
                      <span
                        className={`badge ${i.status === 'paid' ? 'badge-success badge-soft' : 'badge-warning badge-soft'}`}
                      >
                        {i.status === 'paid' && i.retried
                          ? t('retried-paid', 'Retried · paid')
                          : i.status === 'paid'
                            ? t('paid', 'Paid')
                            : (i.status ?? '-')}
                      </span>
                    </td>
                    <td>
                      {i.url && (
                        <a
                          className="link"
                          href={i.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t('invoice', 'Invoice')}
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {invoices.data?.length === 0 && (
            <p className="text-sm opacity-70">
              {t('no-invoices', 'No invoices yet.')}
            </p>
          )}
          <p className="text-xs opacity-70">
            {t(
              'billing-grace',
              'Failed payments get a 7-day grace period before features are limited.'
            )}{' '}
            <button type="button" className="link" onClick={openPortal}>
              {t('cancel-subscription', 'Cancel subscription')}
            </button>
          </p>
        </section>
      </div>
    </div>
  );
};

export default PlanOverview;
