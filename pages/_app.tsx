import app from '@/lib/app';
import { SessionProvider } from 'next-auth/react';
import { appWithTranslation } from 'next-i18next';
import Head from 'next/head';
import { Toaster } from 'react-hot-toast';
import type { AppPropsWithLayout } from 'types';
import mixpanel from 'mixpanel-browser';

import '@boxyhq/react-ui/dist/react-ui.css';
import '../styles/globals.css';
import { useEffect } from 'react';
import env from '@/lib/env';
import { Theme, applyTheme } from '@/lib/theme';
import { Themer } from '@boxyhq/react-ui/shared';
import { AccountLayout } from '@/components/layouts';
import { TeamFeaturesContext } from 'hooks/usePortalNav';
import { registerServiceWorker } from '@/lib/pwa';

function MyApp({ Component, pageProps }: AppPropsWithLayout) {
  const { session, ...props } = pageProps;

  useEffect(() => {
    registerServiceWorker();
  }, []);

  // Add mixpanel
  useEffect(() => {
    if (env.mixpanel.token) {
      mixpanel.init(env.mixpanel.token, {
        debug: true,
        ignore_dnt: true,
        track_pageview: true,
      });
    }

    if (env.darkModeEnabled) {
      applyTheme(localStorage.getItem('theme') as Theme);
    }
  }, []);

  const getLayout =
    Component.getLayout || ((page) => <AccountLayout>{page}</AccountLayout>);

  return (
    <>
      <Head>
        <title>{app.name}</title>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link key="manifest" rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta key="theme-color" name="theme-color" content="#3346D3" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </Head>
      <SessionProvider session={session}>
        <Toaster toastOptions={{ duration: 4000 }} />
        <Themer
          overrideTheme={{
            '--primary-color': '#3346D3',
            '--primary-hover': '#2535A8',
            '--primary-color-50': '#EEF0FB',
            '--primary-color-100': '#E0E4F8',
            '--primary-color-200': '#C7CDF5',
            '--primary-color-300': '#9FA9EC',
            '--primary-color-500': '#3346D3',
            '--primary-color-600': '#2535A8',
            '--primary-color-700': '#1E2B87',
            '--primary-color-800': '#18226A',
            '--primary-color-900': '#121A50',
            '--primary-color-950': '#0B1033',
          }}
        >
          <TeamFeaturesContext.Provider value={props.teamFeatures ?? null}>
            {getLayout(<Component {...props} />)}
          </TeamFeaturesContext.Provider>
        </Themer>
      </SessionProvider>
    </>
  );
}

export default appWithTranslation<never>(MyApp);
