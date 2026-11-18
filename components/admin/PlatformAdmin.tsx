import { Error, Loading } from '@/components/shared';
import useApi, { send } from 'hooks/useApi';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

type Tenant = {
  id: string;
  name: string;
  slug: string;
  owner: { name: string; email: string } | null;
  plan: string;
  planLabel: string;
  planOverride: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  suspendedReason: string | null;
  paymentIssue: boolean;
  readOnly: boolean;
  usage: Record<string, number>;
};
type Tenants = {
  total: number;
  stats: {
    activePortals: number;
    paidPlans: number;
    paymentIssues: number;
    aiCreditsThisMonth: number;
  };
  tenants: Tenant[];
};
type Plans = {
  limitKeys: string[];
  featureKeys: string[];
  plans: {
    key: string;
    label: string;
    current: { limits: Record<string, number | null>; features: string[] };
  }[];
};
type AiCfg = {
  provider: string | null;
  baseUrl: string | null;
  hasKey: boolean;
  keyHint: string | null;
  providers: string[];
};
type Audit = {
  id: string;
  actorEmail: string;
  action: string;
  targetTeamId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}[];

const TenantsTab = () => {
  const { t } = useTranslation('common');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const { data, isError, isLoading, refresh } = useApi<Tenants>(
    `/api/admin/tenants${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}`
  );

  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 300);

    return () => clearTimeout(h);
  }, [q]);

  if (isError) return <Error message={isError.message} />;
  if (isLoading && !data) return <Loading />;
  if (!data) return null;

  const patch = async (id: string, body: Record<string, unknown>) => {
    const r = await send(`/api/admin/tenants/${id}`, 'PATCH', body);

    if (!r.ok) toast.error(r.error as string);

    refresh();
  };

  const suspend = (tn: Tenant) => {
    const reason =
      window.prompt(
        t('admin-suspend-reason', 'Reason for suspending (shown to the portal)')
      ) ?? undefined;

    if (reason !== undefined) patch(tn.id, { status: 'SUSPENDED', reason });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          [data.stats.activePortals, t('admin-active', 'Active portals')],
          [data.stats.paidPlans, t('admin-paid', 'Paid plans')],
          [
            data.stats.aiCreditsThisMonth.toLocaleString(),
            t('admin-credits', 'AI credits (month)'),
          ],
          [data.stats.paymentIssues, t('admin-issues', 'Payment issues')],
        ].map(([n, label]) => (
          <div key={label as string} className="rounded-xl border p-3">
            <div className="text-2xl font-semibold">{n}</div>
            <div className="text-xs opacity-70">{label}</div>
          </div>
        ))}
      </div>
      <input
        type="search"
        className="input input-bordered input-sm w-full max-w-xs"
        aria-label={t('admin-search', 'Search tenants')}
        placeholder={t('admin-search-ph', 'Search name or slug')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="overflow-x-auto">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>{t('admin-portal', 'Portal')}</th>
              <th>{t('admin-owner', 'Owner')}</th>
              <th>{t('admin-plan', 'Plan')}</th>
              <th>{t('admin-usage', 'Jobs / seats')}</th>
              <th>{t('admin-status', 'Status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.tenants.map((tn) => (
              <tr key={tn.id}>
                <td>
                  <strong>{tn.name}</strong>
                  <div className="text-xs opacity-60">{tn.slug}</div>
                </td>
                <td>{tn.owner?.email ?? '-'}</td>
                <td>
                  <select
                    className="select select-bordered select-xs"
                    aria-label={`${tn.name} plan`}
                    value={tn.planOverride ?? ''}
                    onChange={(e) =>
                      patch(tn.id, { planOverride: e.target.value || null })
                    }
                  >
                    <option value="">
                      {tn.planOverride
                        ? t('admin-no-override', 'No override')
                        : `${tn.planLabel} (billing)`}
                    </option>
                    {['free', 'starter', 'professional', 'enterprise'].map(
                      (p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      )
                    )}
                  </select>
                </td>
                <td>
                  {tn.usage.activeJobs} / {tn.usage.seats}
                </td>
                <td>
                  <span
                    className={`badge badge-sm ${tn.status === 'SUSPENDED' ? 'badge-error' : tn.paymentIssue ? 'badge-warning' : 'badge-success'}`}
                  >
                    {tn.status === 'SUSPENDED'
                      ? 'Suspended'
                      : tn.paymentIssue
                        ? 'Payment overdue'
                        : 'Active'}
                  </span>
                </td>
                <td className="text-right">
                  {tn.status === 'SUSPENDED' ? (
                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() => patch(tn.id, { status: 'ACTIVE' })}
                    >
                      {t('admin-activate', 'Activate')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-xs btn-outline btn-error"
                      onClick={() => suspend(tn)}
                    >
                      {t('admin-suspend', 'Suspend')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const PlansTab = () => {
  const { t } = useTranslation('common');
  const { data, isError, refresh } = useApi<Plans>('/api/admin/plans');
  const [draft, setDraft] = useState<
    Record<string, { limits: Record<string, string>; features: string[] }>
  >({});

  useEffect(() => {
    if (data) {
      setDraft(
        Object.fromEntries(
          data.plans.map((p) => [
            p.key,
            {
              limits: Object.fromEntries(
                Object.entries(p.current.limits).map(([k, v]) => [
                  k,
                  v === null ? '' : String(v),
                ])
              ),
              features: p.current.features,
            },
          ])
        )
      );
    }
  }, [data]);

  if (isError) return <Error message={isError.message} />;
  if (!data) return <Loading />;

  const save = async (plan: string) => {
    const d = draft[plan];
    const r = await send('/api/admin/plans', 'PUT', {
      plan,
      limits: Object.fromEntries(
        Object.entries(d.limits).map(([k, v]) => [
          k,
          v === '' ? null : Number(v),
        ])
      ),
      features: d.features,
    });

    if (!r.ok) toast.error(r.error as string);
    else toast.success(t('saved', 'Saved.'));

    refresh();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {data.plans.map((p) => (
        <section key={p.key} className="space-y-2 rounded-xl border p-4">
          <h3 className="font-semibold">{p.label}</h3>
          {data.limitKeys.map((k) => (
            <label
              key={k}
              className="flex items-center justify-between gap-2 text-sm"
            >
              {k}
              <input
                className="input input-bordered input-xs w-32"
                aria-label={`${p.label} ${k}`}
                placeholder="unlimited"
                inputMode="numeric"
                value={draft[p.key]?.limits[k] ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    [p.key]: {
                      ...draft[p.key],
                      limits: { ...draft[p.key].limits, [k]: e.target.value },
                    },
                  })
                }
              />
            </label>
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            {data.featureKeys.map((f) => (
              <label key={f} className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={draft[p.key]?.features.includes(f) ?? false}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      [p.key]: {
                        ...draft[p.key],
                        features: e.target.checked
                          ? [...draft[p.key].features, f]
                          : draft[p.key].features.filter((x) => x !== f),
                      },
                    })
                  }
                />
                {f}
              </label>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => save(p.key)}
          >
            {t('save-changes')}
          </button>
        </section>
      ))}
    </div>
  );
};

const AiTab = () => {
  const { t } = useTranslation('common');
  const { data, isError, refresh } = useApi<AiCfg>('/api/admin/ai');
  const [provider, setProvider] = useState('OPENAI');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    if (data) {
      setProvider(data.provider ?? 'OPENAI');
      setBaseUrl(data.baseUrl ?? '');
    }
  }, [data]);

  if (isError) return <Error message={isError.message} />;
  if (!data) return <Loading />;

  const save = async () => {
    const r = await send('/api/admin/ai', 'PUT', {
      provider,
      baseUrl,
      ...(apiKey ? { apiKey } : {}),
    });

    if (!r.ok) toast.error(r.error as string);
    else {
      toast.success(t('saved', 'Saved.'));
      setApiKey('');
    }

    refresh();
  };

  return (
    <section className="max-w-xl space-y-3 rounded-xl border p-4">
      <h3 className="font-semibold">
        {t('admin-ai-default', 'Platform default AI provider')}
      </h3>
      <p className="text-sm opacity-70">
        {t(
          'admin-ai-note',
          'Used by portals without their own key. Keys are encrypted and never shown again.'
        )}
      </p>
      <select
        className="select select-bordered select-sm w-full"
        aria-label={t('ai-default-provider', 'Provider')}
        value={provider}
        onChange={(e) => setProvider(e.target.value)}
      >
        {['OPENAI', 'ANTHROPIC', 'GEMINI', 'OPENAI_COMPATIBLE'].map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>
      {provider === 'OPENAI_COMPATIBLE' && (
        <input
          className="input input-bordered input-sm w-full"
          aria-label={t('ai-base-url', 'Base URL (https)')}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      )}
      <input
        type="password"
        autoComplete="off"
        className="input input-bordered input-sm w-full"
        aria-label={t('admin-ai-key', 'Platform API key')}
        placeholder={data.hasKey ? `Saved (${data.keyHint})` : 'sk-…'}
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
      />
      <button type="button" className="btn btn-primary btn-sm" onClick={save}>
        {t('save-changes')}
      </button>
    </section>
  );
};

const AuditTab = () => {
  const { t } = useTranslation('common');
  const { data, isError } = useApi<Audit>('/api/admin/audit');

  if (isError) return <Error message={isError.message} />;
  if (!data) return <Loading />;

  return (
    <ul className="space-y-2 text-sm">
      {data.length === 0 && (
        <li className="opacity-70">{t('admin-no-audit', 'No events yet.')}</li>
      )}
      {data.map((l) => (
        <li key={l.id} className="flex flex-wrap gap-3">
          <span className="font-mono text-xs opacity-60">
            {new Date(l.createdAt).toLocaleString()}
          </span>
          <strong>{l.action}</strong>
          <span>{l.actorEmail}</span>
          <span className="opacity-70">{JSON.stringify(l.details)}</span>
        </li>
      ))}
    </ul>
  );
};

const TABS = [
  ['tenants', 'Tenants'],
  ['plans', 'Plans'],
  ['ai', 'AI providers'],
  ['audit', 'Audit log'],
] as const;

const PlatformAdmin = () => {
  const { t } = useTranslation('common');
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('tenants');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">
          {t('admin-title', 'Platform admin')}
        </h1>
        <p className="text-sm opacity-70">
          {t(
            'admin-note',
            'Every action here is written to the platform audit log.'
          )}
        </p>
      </div>
      <div
        role="tablist"
        className="flex flex-nowrap gap-1 overflow-x-auto border-b"
      >
        {TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-primary' : 'border-transparent opacity-70'}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'tenants' && <TenantsTab />}
      {tab === 'plans' && <PlansTab />}
      {tab === 'ai' && <AiTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
};

export default PlatformAdmin;
