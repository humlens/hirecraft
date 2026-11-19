import JobActions from '@/components/public/JobActions';
import { formatLocation, formatSalary } from '@/components/public/JobCard';
import PortalLayout, {
  primaryButtonStyle,
} from '@/components/public/PortalLayout';
import { sanitizeJobHtml } from '@/lib/jobs';
import { getPortalProps, type PortalPageProps } from '@/lib/publicPage';
import type { GetServerSidePropsContext } from 'next';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import {
  getPublicJob,
  listPublicJobs,
  type PublicJob,
  type PublicJobSummary,
} from 'models/publicPortal';
import type { NextPageWithLayout } from 'types';

type Filters = {
  q: string;
  location: string;
  workMode: string;
  employmentType: string;
};
type Props = PortalPageProps & {
  jobs?: PublicJobSummary[];
  total?: number;
  page?: number;
  pages?: number;
  filters?: Filters;
  selected?: PublicJob | null;
};

const str = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? '';

const label = (v: string) =>
  v
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());

const ago = (d: string | Date | null, t: (k: string, d: string) => string) => {
  if (!d) {
    return '';
  }

  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);

  return days <= 0
    ? t('today', 'Today')
    : `${days}${t('days-ago-short', 'd ago')}`;
};

const JobsPage: NextPageWithLayout<Props> = ({
  jobs = [],
  total = 0,
  page = 1,
  pages = 1,
  filters = { q: '', location: '', workMode: '', employmentType: '' },
  selected,
  ...layout
}) => {
  const { t } = useTranslation('common');
  const { portal } = layout;
  const color = portal.branding.primaryColor;

  const href = (over: Record<string, string>) => {
    const sp = new URLSearchParams();

    Object.entries({ ...filters, ...over }).forEach(
      ([k, v]) => v && sp.set(k, v)
    );

    const qs = sp.toString();

    return `/p/${portal.slug}/jobs${qs ? `?${qs}` : ''}`;
  };

  const modes: [string, string][] = [
    ['', t('all', 'All')],
    ['REMOTE', t('opt-remote', 'Remote')],
    ['HYBRID', t('opt-hybrid', 'Hybrid')],
    ['ONSITE', t('opt-onsite', 'On-site')],
  ];

  const hero = (
    <div>
      <h1 className="font-display text-3xl font-bold md:text-4xl">
        {portal.branding.heroTitle ??
          t('hero-default-title', 'Build your career with us')}
      </h1>
      <p className="mt-2 max-w-2xl opacity-90">
        {`${total} ${t('open-roles-lower', 'open roles')}${
          portal.branding.heroSubtitle
            ? ` · ${portal.branding.heroSubtitle}`
            : ''
        }`}
      </p>
      <form
        method="GET"
        role="search"
        className="mt-5 flex flex-wrap gap-2 rounded-2xl bg-white p-2 text-base-content shadow-lg"
      >
        {filters.workMode && (
          <input type="hidden" name="workMode" value={filters.workMode} />
        )}
        <input
          name="q"
          defaultValue={filters.q}
          className="input min-w-48 flex-1 border-0 bg-transparent focus:outline-none"
          placeholder={t('title-skill-keyword', 'Title, skill or keyword')}
          aria-label={t('keyword', 'Keyword')}
        />
        <input
          name="location"
          defaultValue={filters.location}
          className="input min-w-40 border-0 bg-transparent focus:outline-none md:w-56"
          placeholder={t('location', 'Location')}
          aria-label={t('location', 'Location')}
        />
        <button type="submit" className="btn" style={primaryButtonStyle(color)}>
          {t('search', 'Search')}
        </button>
      </form>
    </div>
  );

  return (
    <PortalLayout
      {...layout}
      wide
      hero={hero}
      title={`${t('jobs', 'Jobs')} - ${portal.name}`}
      canonicalPath={`/p/${portal.slug}/jobs`}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {t('work-mode', 'Work mode')}
        </span>
        {modes.map(([v, l]) => (
          <Link
            key={v}
            href={href({ workMode: v, job: '', page: '' })}
            aria-current={filters.workMode === v ? 'true' : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${
              filters.workMode === v ? 'text-white' : 'hover:bg-base-200'
            }`}
            style={
              filters.workMode === v
                ? { backgroundColor: color, borderColor: color }
                : undefined
            }
          >
            {l}
          </Link>
        ))}
        <span className="ml-auto text-sm opacity-70">
          {`${total} ${t('jobs-found', 'jobs found')} · ${t('newest-first', 'newest first')}`}
        </span>
      </div>

      {jobs.length === 0 ? (
        <p>{t('no-matching-jobs', 'No jobs match your search.')}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <ul className="space-y-3">
            {jobs.map((j) => {
              const salary = formatSalary(j);
              const active = selected?.id === j.id;

              return (
                <li
                  key={j.id}
                  className={`rounded-2xl border bg-base-100 p-4 ${
                    active ? 'border-2' : ''
                  }`}
                  style={active ? { borderColor: color } : undefined}
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={href({ job: j.slug })}
                      className="font-display font-semibold hover:underline"
                    >
                      {j.title}
                    </Link>
                    <span className="shrink-0 text-xs opacity-60">
                      {ago(j.publishedAt ?? j.createdAt, t)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm opacity-70">
                    {[
                      j.department,
                      formatLocation(j.locations),
                      j.experienceMin != null
                        ? `${j.experienceMin}${j.experienceMax != null ? `-${j.experienceMax}` : '+'} ${t('yrs', 'yrs')}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="badge badge-outline">
                      {label(j.workMode)}
                    </span>
                    {salary && (
                      <span className="badge badge-outline">{salary}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {selected && (
            <section
              aria-label={t('job-details', 'Job details')}
              className="h-fit rounded-2xl border bg-base-100 p-6 lg:sticky lg:top-4"
            >
              <h2 className="font-display text-2xl font-bold">
                {selected.title}
              </h2>
              <p className="mt-1 text-sm opacity-70">
                {[
                  portal.name,
                  selected.department,
                  formatLocation(selected.locations),
                  label(selected.workMode),
                  label(selected.employmentType),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <div className="my-4">
                <JobActions
                  portalSlug={portal.slug}
                  jobId={selected.id}
                  jobSlug={selected.slug}
                  color={color}
                />
              </div>
              <p className="rounded-xl bg-secondary/10 p-3 text-sm text-secondary">
                {'✦ '}
                {t(
                  'portal-ai-note',
                  'Sign in to see how well your profile matches this role. Matches are advisory and never reject you automatically.'
                )}
              </p>
              <div
                className="prose mt-4 max-w-none"
                dangerouslySetInnerHTML={{
                  __html: sanitizeJobHtml(selected.descriptionHtml),
                }}
              />
              {selected.skills.length > 0 && (
                <>
                  <h3 className="mt-5 font-display font-semibold">
                    {t('skills', 'Skills')}
                  </h3>
                  <p className="mt-2 flex flex-wrap gap-2">
                    {selected.skills.map((s) => (
                      <span
                        key={s.skill}
                        className={`badge ${s.required ? 'badge-primary' : 'badge-outline'}`}
                      >
                        {s.skill}
                      </span>
                    ))}
                  </p>
                </>
              )}
              <p className="mt-5 text-sm opacity-70">
                {[
                  selected.closesAt
                    ? `${t('apply-by', 'Apply by')} ${new Date(selected.closesAt).toLocaleDateString()}`
                    : null,
                  `${selected.vacancies} ${selected.vacancies === 1 ? t('vacancy', 'vacancy') : t('vacancies', 'vacancies')}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </section>
          )}
        </div>
      )}

      {pages > 1 && (
        <nav
          className="mt-6 flex items-center gap-4"
          aria-label={t('pagination', 'Pagination')}
        >
          {page > 1 && (
            <Link href={href({ page: String(page - 1), job: '' })}>
              {t('previous', 'Previous')}
            </Link>
          )}
          <span className="text-sm">
            {page} / {pages}
          </span>
          {page < pages && (
            <Link href={href({ page: String(page + 1), job: '' })}>
              {t('next', 'Next')}
            </Link>
          )}
        </nav>
      )}
    </PortalLayout>
  );
};

JobsPage.getLayout = (page) => page;

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  const filters: Filters = {
    q: str(ctx.query.q).slice(0, 100),
    location: str(ctx.query.location).slice(0, 100),
    workMode: ['REMOTE', 'HYBRID', 'ONSITE'].includes(str(ctx.query.workMode))
      ? str(ctx.query.workMode)
      : '',
    employmentType: [
      'FULL_TIME',
      'PART_TIME',
      'CONTRACT',
      'INTERNSHIP',
      'TEMPORARY',
    ].includes(str(ctx.query.employmentType))
      ? str(ctx.query.employmentType)
      : '',
  };

  return getPortalProps(ctx, async (portal) => {
    const result = await listPublicJobs(portal.team.id, {
      ...filters,
      page: Number(str(ctx.query.page)) || 1,
      pageSize: 10,
    });

    return {
      jobs: result.jobs,
      total: result.total,
      page: result.page,
      pages: result.pages,
      filters,
      selected: result.jobs.length
        ? await getPublicJob(
            portal.team.id,
            result.jobs.find((j) => j.slug === str(ctx.query.job))?.slug ??
              result.jobs[0].slug
          )
        : null,
    };
  });
}

export default JobsPage;
