import CandidateLayout from '@/components/layouts/CandidateLayout';
import Dashboard from '@/components/candidate/Dashboard';
import type { GetStaticPropsContext } from 'next';
import { useTranslation } from 'next-i18next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import type { NextPageWithLayout } from 'types';

const Page: NextPageWithLayout = () => {
  const { t } = useTranslation('common');

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">
        {t('my-dashboard-title', 'My dashboard')}
      </h1>
      <Dashboard />
    </>
  );
};

Page.getLayout = (page) => <CandidateLayout>{page}</CandidateLayout>;

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  return {
    props: {
      ...(locale ? await serverSideTranslations(locale, ['common']) : {}),
    },
  };
}

export default Page;
