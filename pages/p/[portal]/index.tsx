import JobCard from '@/components/public/JobCard';
import PortalLayout, {
  primaryButtonStyle,
} from '@/components/public/PortalLayout';
import { getPortalProps, type PortalPageProps } from '@/lib/publicPage';
import { sanitizeJobHtml } from '@/lib/jobs';
import type { GetServerSidePropsContext } from 'next';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { listPublicJobs, type PublicJobSummary } from 'models/publicPortal';
import type { NextPageWithLayout } from 'types';

type Props = PortalPageProps & { jobs?: PublicJobSummary[]; total?: number };

const PortalHome: NextPageWithLayout<Props> = ({
  jobs = [],
  total = 0,
  ...layout
}) => {
  const { t } = useTranslation('common');
  const { portal } = layout;
  const hero =
    portal.branding.heroTitle ??
    `${t('careers-at', 'Careers at')} ${portal.name}`;

  return (
    <PortalLayout {...layout} canonicalPath={`/p/${portal.slug}`}>
      <section className="mb-10 text-center">
        <h1 className="text-3xl font-bold sm:text-4xl">{hero}</h1>
        {portal.branding.heroSubtitle && (
          <p className="mt-3 text-lg opacity-80">
            {portal.branding.heroSubtitle}
          </p>
        )}
        <Link
          href={`/p/${portal.slug}/jobs`}
          className="btn mt-6"
          style={primaryButtonStyle(portal.branding.primaryColor)}
        >
          {t('view-open-roles', 'View open roles')} ({total})
        </Link>
      </section>

      {portal.profile?.description && (
        <section className="mb-10">
          <p className="whitespace-pre-line opacity-90">
            {portal.profile.description}
          </p>
        </section>
      )}

      {portal.branding.aboutHtml && (
        <section
          className="prose mb-10 max-w-none"
          dangerouslySetInnerHTML={{
            __html: sanitizeJobHtml(portal.branding.aboutHtml),
          }}
        />
      )}

      <section>
        <h2 className="mb-3 text-xl font-semibold">
          {t('latest-jobs', 'Latest jobs')}
        </h2>
        {jobs.length === 0 ? (
          <p className="opacity-70">
            {t('no-open-roles', 'There are no open roles right now.')}
          </p>
        ) : (
          <ul className="space-y-3">
            {jobs.map((j) => (
              <JobCard key={j.id} slug={portal.slug} job={j} />
            ))}
          </ul>
        )}
      </section>
    </PortalLayout>
  );
};

PortalHome.getLayout = (page) => page;

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  return getPortalProps(ctx, async (portal) => {
    const { jobs, total } = await listPublicJobs(portal.team.id, {
      pageSize: 6,
    });

    return { jobs, total };
  });
}

export default PortalHome;
