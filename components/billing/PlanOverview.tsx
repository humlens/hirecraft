import { Error, Loading } from '@/components/shared';
import useApi from 'hooks/useApi';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

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
  plans: ({ key: string; label: string } & Def)[];
  subscription: { renewsAt: string; cancelAt: string | null } | null;
  change?: {
    target: string;
    allowed: boolean;
    blockers: { limit: string; used: number; allowed: number }[];
  };
};

const show = (n: number | null) => (n === null ? '∞' : n.toLocaleString());

/** Plan, limits and live usage. Limits are enforced by the server, not by this page. */
const PlanOverview = ({ slug }: { slug: string }) => {
  const { t } = useTranslation('common');
  const [target, setTarget] = useState<string | null>(null);
  const { data, isLoading, isError } = useApi<Overview>(
    `/api/teams/${slug}/plan${target ? `?target=${target}` : ''}`
  );

  if (isLoading && !data) return <Loading />;
  if (isError) return <Error message={isError.message} />;
  if (!data) return null;

  const keys = Object.keys(data.limits);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-medium">
          {t('plan-title', 'Plans & usage')}
        </h2>
        <p className="text-sm opacity-70">
          {data.label}
          {data.subscription &&
            ` · ${t('plan-renews', 'renews {{date}}', { date: new Date(data.subscription.renewsAt).toLocaleDateString() })}`}
          {data.subscription?.cancelAt &&
            ` · ${t('plan-cancels', 'cancels on {{date}}', { date: new Date(data.subscription.cancelAt).toLocaleDateString() })}`}
        </p>
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.plans.map((p) => {
          const current = p.key === data.plan;

          return (
            <article
              key={p.key}
              className={`space-y-2 rounded-xl border p-4 ${current ? 'border-2 border-primary' : ''}`}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{p.label}</h3>
                {current && (
                  <span className="badge badge-primary badge-sm">
                    {t('plan-current', 'Current')}
                  </span>
                )}
              </div>
              <ul className="space-y-1 text-sm">
                {keys.map((k) => (
                  <li key={k}>
                    {show(p.limits[k])} {data.limitLabels[k]}
                  </li>
                ))}
              </ul>
              <p className="text-xs opacity-70">
                {p.features.length} {t('plan-features', 'premium features')}
              </p>
              {!current && (
                <button
                  type="button"
                  className="btn btn-sm min-h-10 w-full"
                  onClick={() => setTarget(p.key)}
                >
                  {t('plan-preview', 'Preview change')}
                </button>
              )}
            </article>
          );
        })}
      </div>

      {data.change && (
        <div
          className={`rounded-lg border p-3 text-sm ${data.change.allowed ? 'border-primary' : 'border-warning'}`}
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
          <button
            type="button"
            className="link mt-2"
            onClick={() => setTarget(null)}
          >
            {t('plan-dismiss', 'Dismiss')}
          </button>
        </div>
      )}

      <section className="space-y-3 rounded-xl border p-4">
        <h3 className="font-semibold">{t('plan-usage', 'Usage & limits')}</h3>
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
    </div>
  );
};

export default PlanOverview;
