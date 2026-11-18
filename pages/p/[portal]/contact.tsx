import PortalLayout from '@/components/public/PortalLayout';
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
      title={`${t('page-contact', 'Contact')} - ${portal.name}`}
      canonicalPath={`/p/${portal.slug}/contact`}
    >
      <h1 className="mb-4 text-2xl font-bold">
        {t('page-contact', 'Contact')}
      </h1>
      <dl className="space-y-2">
        {portal.profile?.contactEmail && (
          <div>
            <dt className="text-sm opacity-60">{t('email')}</dt>
            <dd>
              <a
                className="link"
                href={`mailto:${portal.profile.contactEmail}`}
              >
                {portal.profile.contactEmail}
              </a>
            </dd>
          </div>
        )}
        {portal.profile?.website && (
          <div>
            <dt className="text-sm opacity-60">{t('portal-website')}</dt>
            <dd>
              <a
                className="link"
                href={portal.profile.website}
                rel="noopener noreferrer nofollow"
              >
                {portal.profile.website}
              </a>
            </dd>
          </div>
        )}
      </dl>
    </PortalLayout>
  );
};

Page.getLayout = (page) => page;

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  return getPortalProps(ctx);
}

export default Page;
