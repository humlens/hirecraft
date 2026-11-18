import { Error, Loading } from '@/components/shared';
import useApi from 'hooks/useApi';
import usePortalAccess from 'hooks/usePortalAccess';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';

type Data = {
  kpis: {
    openJobs: number;
    applications: number;
    hires: number;
    rejected: number;
    withdrawn: number;
    inProgress: number;
    avgTimeToHireDays: number | null;
    offerAcceptanceRate: number | null;
  };
  funnel: { stage: string; count: number }[];
  sources: { source: string; count: number }[];
  topJobs: { id: string; title: string; applications: number }[];
  offers: Record<string, number>;
  interviews: Record<string, number>;
};

const Analytics = ({ slug }: { slug: string }) => {
  const { t } = useTranslation('common');
  const { can } = usePortalAccess(slug);
  const [days, setDays] = useState('30');
  // The range is computed once per selection: a new Date() on every render
  // would change the SWR key each time and refetch forever.
  const qs = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - Number(days) * 86400_000);

    return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
  }, [days]);
  const { data, isLoading, isError } = useApi<Data>(
    `/api/teams/${slug}/analytics?${qs}`
  );

  if (isLoading) return <Loading />;
  if (isError) return <Error message={isError.message} />;
  if (!data) return null;

  const max = Math.max(1, ...data.funnel.map((f) => f.count));
  const k = data.kpis;
  const tile = (label: string, value: string | number) => (
    <div className="rounded border p-3" key={label}>
      <div className="text-xs opacity-60">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-xl font-medium">
          {t('analytics', 'Analytics')}
        </h2>
        <select
          className="select select-bordered select-sm"
          aria-label={t('period', 'Period')}
          value={days}
          onChange={(e) => setDays(e.target.value)}
        >
          {['7', '30', '90', '365'].map((d) => (
            <option
              key={d}
              value={d}
            >{`${t('last', 'Last')} ${d} ${t('days', 'days')}`}</option>
          ))}
        </select>
        {can('candidates.export') && (
          <a
            className="btn btn-sm"
            href={`/api/teams/${slug}/analytics/export?${qs}`}
          >
            {t('export-csv', 'Export CSV')}
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tile(t('open-jobs', 'Open jobs'), k.openJobs)}
        {tile(t('applications', 'Applications'), k.applications)}
        {tile(t('in-progress', 'In progress'), k.inProgress)}
        {tile(t('hires', 'Hires'), k.hires)}
        {tile(t('rejected', 'Rejected'), k.rejected)}
        {tile(t('withdrawn', 'Withdrawn'), k.withdrawn)}
        {tile(
          t('time-to-hire', 'Avg days to hire'),
          k.avgTimeToHireDays ?? '-'
        )}
        {tile(
          t('offer-acceptance', 'Offer acceptance'),
          k.offerAcceptanceRate == null ? '-' : `${k.offerAcceptanceRate}%`
        )}
      </div>

      <section className="space-y-1">
        <h3 className="font-semibold">{t('funnel', 'Hiring funnel')}</h3>
        {data.funnel.map((f) => (
          <div key={f.stage} className="flex items-center gap-2 text-sm">
            <span className="w-44 truncate">{f.stage}</span>
            <div
              className="h-4 rounded bg-primary"
              style={{ width: `${Math.max(2, (f.count / max) * 60)}%` }}
              role="img"
              aria-label={`${f.stage}: ${f.count}`}
            />
            <span>{f.count}</span>
          </div>
        ))}
        {data.funnel.length === 0 && (
          <p className="text-sm opacity-70">
            {t('no-data', 'No data for this period.')}
          </p>
        )}
      </section>

      <div className="grid gap-6 sm:grid-cols-2">
        <section>
          <h3 className="font-semibold">{t('sources', 'Sources')}</h3>
          <ul className="text-sm">
            {data.sources.map((s) => (
              <li key={s.source}>
                {s.source}: {s.count}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="font-semibold">
            {t('top-jobs', 'Jobs by applications')}
          </h3>
          <ul className="text-sm">
            {data.topJobs.map((j) => (
              <li key={j.id}>
                {j.title}: {j.applications}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
};

export default Analytics;
