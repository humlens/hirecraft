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
      title={`${t('page-privacy', 'Privacy policy')} - ${portal.name}`}
      canonicalPath={`/p/${portal.slug}/privacy`}
    >
      <h1 className="mb-4 text-2xl font-bold">
        {t('page-privacy', 'Privacy policy')}
      </h1>
      {portal.branding.privacyPolicyHtml ? (
        <div
          className="prose max-w-none"
          dangerouslySetInnerHTML={{
            __html: sanitizeJobHtml(portal.branding.privacyPolicyHtml),
          }}
        />
      ) : (
        <p>
          {t(
            'no-privacy-policy',
            'This employer has not published a privacy policy yet.'
          )}
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
