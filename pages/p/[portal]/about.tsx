import PortalLayout from '@/components/public/PortalLayout';
import { sanitizeJobHtml } from '@/lib/jobs';
import { getPortalProps, type PortalPageProps } from '@/lib/publicPage';
import type { GetServerSidePropsContext } from 'next';
import { useTranslation } from 'next-i18next';
import type { NextPageWithLayout } from 'types';

const Page: NextPageWithLayout<PortalPageProps> = (props) => {
  const { t } = useTranslation('common');
  const { portal } = props;

  return (
    <PortalLayout
      {...props}
      title={`${t('page-about', 'About')} - ${portal.name}`}
      canonicalPath={`/p/${portal.slug}/about`}
    >
      <h1 className="mb-4 text-2xl font-bold">{t('page-about', 'About')}</h1>
      {portal.branding.aboutHtml ? (
        <div
          className="prose max-w-none"
          dangerouslySetInnerHTML={{
            __html: sanitizeJobHtml(portal.branding.aboutHtml),
          }}
        />
      ) : (
        <p className="whitespace-pre-line">
          {portal.profile?.description ?? ''}
        </p>
      )}
    </PortalLayout>
  );
};

Page.getLayout = (page) => page;

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  return getPortalProps(ctx);
}

export default Page;
