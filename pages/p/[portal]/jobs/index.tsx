import JobCard from '@/components/public/JobCard';
import PortalLayout, {
  primaryButtonStyle,
} from '@/components/public/PortalLayout';
import { getPortalProps, type PortalPageProps } from '@/lib/publicPage';
import type { GetServerSidePropsContext } from 'next';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { listPublicJobs, type PublicJobSummary } from 'models/publicPortal';
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
};

const str = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? '';

const JobsPage: NextPageWithLayout<Props> = ({
  jobs = [],
  total = 0,
  page = 1,
  pages = 1,
  filters = { q: '', location: '', workMode: '', employmentType: '' },
  ...layout
}) => {
  const { t } = useTranslation('common');
  const { portal } = layout;

  const pageHref = (p: number) => {
    const sp = new URLSearchParams();

    Object.entries(filters).forEach(([k, v]) => v && sp.set(k, v));
    sp.set('page', String(p));

    return `/p/${portal.slug}/jobs?${sp.toString()}`;
  };

  return (
    <PortalLayout
      {...layout}
      title={`${t('jobs', 'Jobs')} - ${portal.name}`}
      canonicalPath={`/p/${portal.slug}/jobs`}
    >
      <h1 className="mb-4 text-2xl font-bold">
        {t('open-roles', 'Open roles')}
      </h1>

      <form method="GET" className="mb-6 flex flex-wrap gap-2" role="search">
        <input
          name="q"
          defaultValue={filters.q}
          className="input input-bordered input-sm"
          placeholder="Keyword"
          aria-label={t('keyword', 'Keyword')}
        />
        <input
          name="location"
          defaultValue={filters.location}
          className="input input-bordered input-sm"
          placeholder="Location"
          aria-label={t('location', 'Location')}
        />
        <select
          name="workMode"
          defaultValue={filters.workMode}
          className="select select-bordered select-sm"
          aria-label={t('work-mode', 'Work mode')}
        >
          <option value="">{t('any-work-mode', 'Any work mode')}</option>
          <option value="REMOTE">{t('opt-remote', 'Remote')}</option>
          <option value="HYBRID">{t('opt-hybrid', 'Hybrid')}</option>
          <option value="ONSITE">{t('opt-onsite', 'On-site')}</option>
        </select>
        <select
          name="employmentType"
          defaultValue={filters.employmentType}
          className="select select-bordered select-sm"
          aria-label={t('employment-type', 'Employment type')}
        >
          <option value="">{t('any-type', 'Any type')}</option>
          <option value="FULL_TIME">{t('opt-full-time', 'Full time')}</option>
          <option value="PART_TIME">{t('opt-part-time', 'Part time')}</option>
          <option value="CONTRACT">{t('opt-contract', 'Contract')}</option>
          <option value="INTERNSHIP">
            {t('opt-internship', 'Internship')}
          </option>
          <option value="TEMPORARY">{t('opt-temporary', 'Temporary')}</option>
        </select>
        <button
          type="submit"
          className="btn btn-sm"
          style={primaryButtonStyle(portal.branding.primaryColor)}
        >
          {t('search', 'Search')}
        </button>
      </form>

      <p className="mb-3 text-sm opacity-70">
        {total} {t('jobs-found', 'jobs found')}
      </p>

      {jobs.length === 0 ? (
        <p>{t('no-matching-jobs', 'No jobs match your search.')}</p>
      ) : (
        <ul className="space-y-3">
          {jobs.map((j) => (
            <JobCard key={j.id} slug={portal.slug} job={j} />
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav
          className="mt-6 flex items-center gap-4"
          aria-label={t('pagination', 'Pagination')}
        >
          {page > 1 && (
            <Link href={pageHref(page - 1)}>{t('previous', 'Previous')}</Link>
          )}
          <span className="text-sm">
            {page} / {pages}
          </span>
          {page < pages && (
            <Link href={pageHref(page + 1)}>{t('next', 'Next')}</Link>
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
    };
  });
}

export default JobsPage;
