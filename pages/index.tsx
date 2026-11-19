import { type ReactElement } from 'react';
import { useTranslation } from 'next-i18next';
import type { NextPageWithLayout } from 'types';
import { GetServerSidePropsContext } from 'next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import {
  CtaBand,
  Faq,
  Features,
  Footer,
  Hero,
  HowItWorks,
  Navbar,
  Pricing,
  Solutions,
} from '@/components/landing/Sections';
import faqs from '@/components/defaultLanding/data/faq.json';
import useTheme from 'hooks/useTheme';
import env from '@/lib/env';
import Head from 'next/head';

const Home: NextPageWithLayout = () => {
  const { toggleTheme, selectedTheme } = useTheme();
  const { t } = useTranslation('common');

  return (
    <>
      <Head>
        <title>{t('homepage-title')}</title>
      </Head>

      <Navbar
        themeToggle={
          env.darkModeEnabled ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-square"
              aria-label={t('toggle-theme', 'Toggle theme')}
              onClick={toggleTheme}
            >
              <selectedTheme.icon className="h-5 w-5" />
            </button>
          ) : null
        }
      />
      <main>
        <Hero />
        <Solutions />
        <Features />
        <HowItWorks />
        <Pricing />
        <Faq items={faqs} />
        <CtaBand />
      </main>
      <Footer />
    </>
  );
};

export const getServerSideProps = async (
  context: GetServerSidePropsContext
) => {
  // Redirect to login page if landing page is disabled
  if (env.hideLandingPage) {
    return {
      redirect: {
        destination: '/auth/login',
        permanent: true,
      },
    };
  }

  const { locale } = context;

  return {
    props: {
      ...(locale ? await serverSideTranslations(locale, ['common']) : {}),
    },
  };
};

Home.getLayout = function getLayout(page: ReactElement) {
  return <>{page}</>;
};

export default Home;
