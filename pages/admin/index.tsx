import PlatformAdmin from '@/components/admin/PlatformAdmin';
import type { GetServerSidePropsContext } from 'next';
import type { NextPageWithLayout } from 'types';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';

const Page: NextPageWithLayout = () => <PlatformAdmin />;

// the admin area has its own dark header instead of the portal shell
Page.getLayout = (page) => page;

export async function getServerSideProps({
  locale,
}: GetServerSidePropsContext) {
  return {
    props: {
      ...(locale ? await serverSideTranslations(locale, ['common']) : {}),
    },
  };
}

export default Page;
