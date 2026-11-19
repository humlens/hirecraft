import { Error, Loading } from '@/components/shared';
import useApi from 'hooks/useApi';
import usePortalAccess from 'hooks/usePortalAccess';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useState } from 'react';
import { useJobs } from 'hooks/useJobs';

type Data = {
  kpis: {
    openJobs: number;
    applications: number;
    hires: number;
    rejected: number;
    withdrawn: number;
    inProgress: number;
    avgTimeToHireDays: number | null;
    avgTimeToFillDays: number | null;
    interviewToOfferRate: number | null;
    offerAcceptanceRate: number | null;
  };
  funnel: { stage: string; count: number }[];
  sources: { source: string; count: number }[];
  topJobs: { id: string; title: string; applications: number }[];
  offers: Record<string, number>;
  interviews: Record<string, number>;
  recruiters: {
    id: string;
    name: string;
    openJobs: number;
    activeCandidates: number;
    avgDaysInReview: number | null;
    hires: number;
  }[];
};

const SOURCE_LABELS: Record<string, string> = {
  portal: 'Portal',
  referral: 'Referral',
  linkedin: 'LinkedIn',
  import: 'Import',
  manual: 'Manual',
};

const Analytics = ({ slug }: { slug: string }) => {
  const { t } = useTranslation('common');
  const { can } = usePortalAccess(slug);
  const [days, setDays] = useState('90');
  const [jobId, setJobId] = useState('');
  const [recruiterId, setRecruiterId] = useState('');
  const [options, setOptions] = useState<{ id: string; name: string }[]>([]);
  const { jobs } = useJobs(slug);
  // The range is computed once per selection: a new Date() on every render
  // would change the SWR key each time and refetch forever.
  const qs = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - Number(days) * 86400_000);

    return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}${jobId ? `&jobId=${jobId}` : ''}${recruiterId ? `&recruiterId=${recruiterId}` : ''}`;
  }, [days, jobId, recruiterId]);
  const { data, isLoading, isError } = useApi<Data>(
    `/api/teams/${slug}/analytics?${qs}`
  );

  useEffect(() => {
    if (data && !recruiterId) {
      setOptions(data.recruiters.map((r) => ({ id: r.id, name: r.name })));
    }
  }, [data, recruiterId]);

  if (isLoading) return <Loading />;
  if (isError) return <Error message={isError.message} />;
  if (!data) return null;

  const k = data.kpis;
  const big = (label: string, value: string, hint: string) => (
    <div className="rounded-2xl border bg-base-100 p-5" key={label}>
      <div className="text-sm opacity-70">{label}</div>
      <div className="font-display text-4xl font-bold">{value}</div>
      <div className="text-sm opacity-70">{hint}</div>
    </div>
  );
  const small = (label: string, value: string | number) => (
    <div className="rounded-xl border bg-base-100 px-4 py-2" key={label}>
      <div className="text-xs opacity-60">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
  // Stage conversion: each step as a share of the one before it
  const steps = data.funnel
    .map((f, i) =>
      i === 0
        ? null
        : {
            label: `${data.funnel[i - 1].stage} → ${f.stage}`,
            pct: data.funnel[i - 1].count
              ? Math.min(
                  100,
                  Math.round((f.count / data.funnel[i - 1].count) * 100)
                )
              : 0,
          }
    )
    .filter(Boolean) as { label: string; pct: number }[];
  const maxSource = Math.max(1, ...data.sources.map((s) => s.count));
  const slowest = Math.max(
    0,
    ...data.recruiters.map((r) => r.avgDaysInReview ?? 0)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h2 className="font-display text-3xl font-bold">
            {t('recruitment-analytics', 'Recruitment analytics')}
          </h2>
          <p className="text-sm opacity-70">
            {t('analytics-scope', 'Scoped to jobs you can view')}
          </p>
        </div>
        <select
          className="select"
          aria-label={t('job', 'Job')}
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
        >
          <option value="">{t('all-jobs', 'All jobs')}</option>
          {(jobs ?? []).map((j) => (
            <option key={j.id} value={j.id}>
              {j.title}
            </option>
          ))}
        </select>
        <select
          className="select"
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
        <select
          className="select"
          aria-label={t('recruiter', 'Recruiter')}
          value={recruiterId}
          onChange={(e) => setRecruiterId(e.target.value)}
        >
          <option value="">{t('all-recruiters', 'All recruiters')}</option>
          {options.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {can('candidates.export') && (
          <a
            className="btn btn-outline"
            href={`/api/teams/${slug}/analytics/export?${qs}`}
          >
            {t('export-csv', 'Export CSV')}
          </a>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {big(
          t('time-to-hire-title', 'Time to hire'),
          k.avgTimeToHireDays == null ? '-' : `${k.avgTimeToHireDays} d`,
          t('time-to-hire-hint', 'Applied → hired, average')
        )}
        {big(
          t('time-to-fill', 'Time to fill'),
          k.avgTimeToFillDays == null ? '-' : `${k.avgTimeToFillDays} d`,
          t('time-to-fill-hint', 'Job opened → offer accepted')
        )}
        {big(
          t('offer-acceptance', 'Offer acceptance'),
          k.offerAcceptanceRate == null ? '-' : `${k.offerAcceptanceRate}%`,
          t('offer-acceptance-hint', 'Accepted ÷ answered')
        )}
        {big(
          t('interview-to-offer', 'Interview → offer'),
          k.interviewToOfferRate == null ? '-' : `${k.interviewToOfferRate}%`,
          t('conversion', 'Conversion')
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {small(t('open-jobs', 'Open jobs'), k.openJobs)}
        {small(t('applications', 'Applications'), k.applications)}
        {small(t('in-progress', 'In progress'), k.inProgress)}
        {small(t('hires', 'Hires'), k.hires)}
        {small(t('rejected', 'Rejected'), k.rejected)}
        {small(t('withdrawn', 'Withdrawn'), k.withdrawn)}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-2xl border bg-base-100 p-5">
          <h3 className="font-display text-lg font-semibold">
            {t('stage-conversion', 'Stage conversion')}
          </h3>
          {steps.map((st) => (
            <div key={st.label} className="flex items-center gap-3 text-sm">
              <span className="w-2/5 truncate">{st.label}</span>
              <progress
                className="progress progress-primary h-3 flex-1"
                value={st.pct}
                max={100}
                aria-label={st.label}
              />
              <span className="w-10 text-right font-semibold">{`${st.pct}%`}</span>
            </div>
          ))}
          {steps.length === 0 && (
            <p className="text-sm opacity-70">
              {t('no-data', 'No data for this period.')}
            </p>
          )}
        </section>

        <section className="rounded-2xl border bg-base-100 p-5">
          <h3 className="font-display text-lg font-semibold">
            {t('sources', 'Source of applications')}
          </h3>
          <div className="mt-4 flex h-44 items-end gap-4 border-b">
            {data.sources.map((s) => (
              <div
                key={s.source}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1"
              >
                <span className="text-xs font-semibold">{s.count}</span>
                <div
                  className="w-full max-w-24 rounded-t-lg bg-secondary"
                  style={{
                    height: `${Math.max(4, (s.count / maxSource) * 80)}%`,
                  }}
                  role="img"
                  aria-label={`${s.source}: ${s.count}`}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-4 text-xs opacity-70">
            {data.sources.map((s) => (
              <span key={s.source} className="flex-1 text-center">
                {SOURCE_LABELS[s.source] ?? s.source}
              </span>
            ))}
          </div>
          {data.sources.length === 0 && (
            <p className="text-sm opacity-70">
              {t('no-data', 'No data for this period.')}
            </p>
          )}
        </section>
      </div>

      <section className="rounded-2xl border bg-base-100 p-5">
        <h3 className="font-display text-lg font-semibold">
          {t('recruiter-workload', 'Recruiter workload')}
        </h3>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr className="text-xs uppercase">
                <th>{t('recruiter', 'Recruiter')}</th>
                <th>{t('open-jobs-upper', 'Open jobs')}</th>
                <th>{t('active-candidates', 'Active candidates')}</th>
                <th>{t('avg-days-review', 'Avg. days in review')}</th>
                <th>{t('placements-period', 'Placements')}</th>
              </tr>
            </thead>
            <tbody>
              {data.recruiters.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.openJobs}</td>
                  <td>{r.activeCandidates}</td>
                  <td
                    className={
                      r.avgDaysInReview != null &&
                      slowest > 5 &&
                      r.avgDaysInReview === slowest
                        ? 'font-semibold text-error'
                        : ''
                    }
                  >
                    {r.avgDaysInReview ?? '-'}
                  </td>
                  <td>{r.hires}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.recruiters.length === 0 && (
          <p className="text-sm opacity-70">
            {t('no-recruiters', 'No recruiters are assigned to jobs yet.')}
          </p>
        )}
      </section>
    </div>
  );
};

export default Analytics;
