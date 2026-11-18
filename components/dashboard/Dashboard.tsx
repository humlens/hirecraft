import { Error, Loading } from '@/components/shared';
import useApi from 'hooks/useApi';
import usePortalAccess from 'hooks/usePortalAccess';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import classNames from 'classnames';

type Data = {
  days: number;
  kpis: {
    activeJobs: number;
    applications: number;
    interviews: number;
    hires: number;
    medianDaysToHire: number | null;
  };
  funnel: { key: string; value: number }[];
  attention: {
    id: string;
    title: string;
    detail: string;
    tag: 'review' | 'low' | 'feedback';
  }[];
  notifications: {
    id: string;
    title: string;
    body: string | null;
    link: string | null;
    readAt: string | null;
  }[];
};

const greeting = (t: (k: string, d: string) => string) => {
  const h = new Date().getHours();

  return h < 12
    ? t('good-morning', 'Good morning')
    : h < 18
      ? t('good-afternoon', 'Good afternoon')
      : t('good-evening', 'Good evening');
};

const TAG: Record<string, string> = {
  review: 'bg-warning/15 text-warning',
  low: 'bg-error/10 text-error',
  feedback: 'bg-primary/10 text-primary',
};

const Dashboard = ({ slug, teamName }: { slug: string; teamName: string }) => {
  const { t } = useTranslation('common');
  const { data: session } = useSession();
  const { can } = usePortalAccess(slug);
  const router = useRouter();
  const [days, setDays] = useState(30);
  const [q, setQ] = useState('');
  const { data, isLoading, isError } = useApi<Data>(
    `/api/teams/${slug}/dashboard?days=${days}`
  );

  const ask = (text: string) => {
    if (text.trim())
      router.push({
        pathname: `/teams/${slug}/copilot`,
        query: { q: text.trim() },
      });
  };

  if (isError) return <Error message={isError.message} />;

  const max = Math.max(1, ...(data?.funnel.map((f) => f.value) ?? [1]));
  const stageLabel: Record<string, string> = {
    applied: t('funnel-applied', 'Applied'),
    screened: t('funnel-screened', 'Screened'),
    interviewed: t('funnel-interviewed', 'Interviewed'),
    offer: t('funnel-offer', 'Offer released'),
    hired: t('funnel-hired', 'Hired'),
  };
  const tagLabel: Record<string, string> = {
    review: t('tag-review', 'Review backlog'),
    low: t('tag-low', 'Low applications'),
    feedback: t('tag-feedback', 'Feedback due'),
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">
            {greeting(t)}, {session?.user?.name?.split(' ')[0]}
          </h1>
          <p className="text-sm text-base-content/70">{teamName}</p>
        </div>
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={t('dashboard-range', 'Date range')}
        >
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={classNames(
                'btn btn-sm min-h-10',
                days === d
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'btn-outline border-base-300'
              )}
            >
              {d === 7
                ? t('last-7-days', 'Last 7 days')
                : t('n-days', '{{n}} days', { n: d })}
            </button>
          ))}
          {can('jobs.create') && (
            <Link
              href={`/teams/${slug}/jobs/new`}
              className="btn btn-primary btn-sm min-h-10"
            >
              {t('new-job-short', '+ New job')}
            </Link>
          )}
        </div>
      </div>

      {isLoading && !data ? (
        <Loading />
      ) : (
        data && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                [
                  t('kpi-active-jobs', 'Active jobs'),
                  data.kpis.activeJobs,
                  null,
                ],
                [
                  t('kpi-applications', 'Applications'),
                  data.kpis.applications,
                  data.kpis.medianDaysToHire != null
                    ? t('kpi-median', 'Median time to hire: {{n}} days', {
                        n: data.kpis.medianDaysToHire,
                      })
                    : null,
                ],
                [
                  t('kpi-interviews', 'Interviews scheduled'),
                  data.kpis.interviews,
                  null,
                ],
                [t('kpi-hires', 'Hires'), data.kpis.hires, null],
              ].map(([label, value, note]) => (
                <div
                  key={label as string}
                  className="rounded-2xl border bg-base-100 p-4"
                >
                  <div className="text-sm text-base-content/70">{label}</div>
                  <div className="font-display mt-1 text-4xl font-semibold">
                    {value}
                  </div>
                  {note && (
                    <div className="mt-1 text-sm font-medium text-secondary">
                      {note}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <section className="rounded-2xl border bg-base-100 p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-lg font-semibold">
                      {t('hiring-funnel', 'Hiring funnel')}
                    </h2>
                    <span className="text-sm text-base-content/70">
                      {t('all-open-jobs', 'All open jobs')}
                    </span>
                  </div>
                  <ul className="space-y-3">
                    {data.funnel.map((f) => (
                      <li
                        key={f.key}
                        className="grid grid-cols-[7rem_1fr_3rem] items-center gap-3 text-sm sm:grid-cols-[9rem_1fr_3rem]"
                      >
                        <span>{stageLabel[f.key]}</span>
                        <span
                          className="h-2.5 overflow-hidden rounded-full bg-base-200"
                          aria-hidden="true"
                        >
                          <span
                            className={classNames(
                              'block h-full rounded-full',
                              f.key === 'hired' ? 'bg-secondary' : 'bg-primary'
                            )}
                            style={{
                              width: `${Math.max(f.value ? 2 : 0, Math.round((f.value / max) * 100))}%`,
                            }}
                          />
                        </span>
                        <span className="text-right font-semibold">
                          {f.value}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="rounded-2xl border bg-base-100">
                  <div className="flex items-center justify-between p-5 pb-3">
                    <h2 className="text-lg font-semibold">
                      {t('jobs-attention', 'Jobs needing attention')}
                    </h2>
                    <Link
                      className="link link-primary text-sm font-semibold"
                      href={`/teams/${slug}/jobs`}
                    >
                      {t('open-jobs', 'Open jobs')}
                    </Link>
                  </div>
                  {data.attention.length === 0 && (
                    <p className="px-5 pb-5 text-sm text-base-content/70">
                      {t(
                        'nothing-attention',
                        'Nothing needs your attention right now.'
                      )}
                    </p>
                  )}
                  <ul className="divide-y">
                    {data.attention.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center justify-between gap-3 px-5 py-3"
                      >
                        <Link
                          href={`/teams/${slug}/jobs/${a.id}/pipeline`}
                          className="min-w-0"
                        >
                          <strong className="block truncate">{a.title}</strong>
                          <span className="text-sm text-base-content/70">
                            {a.detail}
                          </span>
                        </Link>
                        <span
                          className={classNames(
                            'shrink-0 rounded-full px-3 py-1 text-xs font-semibold',
                            TAG[a.tag]
                          )}
                        >
                          {tagLabel[a.tag]}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>

              <div className="space-y-4">
                {can('ai.use') && (
                  <section className="space-y-3 rounded-2xl border bg-base-100 p-5">
                    <h2 className="flex items-center gap-2 text-lg font-semibold text-secondary">
                      <span aria-hidden="true">{'✦'}</span>
                      <span className="text-base-content">
                        {t('recruitment-assistant', 'Recruitment assistant')}
                      </span>
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {[
                        t('assist-shortlisted', 'Shortlisted this week'),
                        t('assist-react', 'React devs, 5+ yrs'),
                        t('assist-low', 'Jobs low on applicants'),
                      ].map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => ask(p)}
                          className="rounded-full border border-secondary/30 bg-secondary/10 px-3 py-1.5 text-sm font-medium text-secondary"
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        ask(q);
                      }}
                    >
                      <input
                        className="input min-w-0 flex-1"
                        aria-label={t(
                          'assistant-ask',
                          'Ask about candidates, jobs, interviews'
                        )}
                        placeholder={t(
                          'assistant-ph',
                          'Ask about candidates, jobs, interviews…'
                        )}
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        maxLength={500}
                      />
                      <button type="submit" className="btn">
                        {t('ask', 'Ask')}
                      </button>
                    </form>
                  </section>
                )}

                <section className="rounded-2xl border bg-base-100 p-5">
                  <h2 className="mb-3 text-lg font-semibold">
                    {t('notifications', 'Notifications')}
                  </h2>
                  {data.notifications.length === 0 && (
                    <p className="text-sm text-base-content/70">
                      {t('no-notifications', 'No notifications.')}
                    </p>
                  )}
                  <ul className="space-y-3 text-sm">
                    {data.notifications.map((n) => (
                      <li key={n.id} className="flex gap-2">
                        <span
                          className={classNames(
                            'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                            n.readAt ? 'bg-base-300' : 'bg-primary'
                          )}
                          aria-hidden="true"
                        />
                        {n.link ? (
                          <Link href={n.link} className="font-medium">
                            {n.title}
                          </Link>
                        ) : (
                          <span className="font-medium">{n.title}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
};

export default Dashboard;
