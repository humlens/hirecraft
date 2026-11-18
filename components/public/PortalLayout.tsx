import { signOut, useSession } from 'next-auth/react';
import { useTranslation } from 'next-i18next';
import Head from 'next/head';
import Link from 'next/link';
import type { PortalPageProps } from '@/lib/publicPage';
import { stripHtml } from '@/lib/jobs';

type Props = PortalPageProps & {
  children: React.ReactNode;
  title?: string;
  description?: string;
  noindex?: boolean;
  canonicalPath?: string;
  head?: React.ReactNode;
};

/** Branded shell for the public portal: colors, theme, nav, SEO tags. */
const PortalLayout = ({
  portal,
  appUrl,
  children,
  title,
  description,
  noindex,
  canonicalPath,
  head,
}: Props) => {
  const { t } = useTranslation('common');
  const { data: session } = useSession();
  const base = `/p/${portal.slug}`;
  const primary = portal.branding.primaryColor;
  const theme =
    portal.branding.theme === 'DARK'
      ? 'dark'
      : portal.branding.theme === 'LIGHT'
        ? 'light'
        : undefined;

  const pageTitle =
    title ??
    portal.branding.seoTitle ??
    `${portal.name} ${t('careers', 'Careers')}`;
  const pageDescription =
    description ??
    portal.branding.seoDescription ??
    (portal.profile?.description
      ? stripHtml(portal.profile.description).slice(0, 160)
      : undefined);

  return (
    <div
      data-theme={theme}
      className="min-h-screen bg-base-100"
      style={{ ['--portal-primary' as string]: primary }}
    >
      <Head>
        <title>{pageTitle}</title>
        {pageDescription && (
          <meta name="description" content={pageDescription} />
        )}
        <meta property="og:title" content={pageTitle} />
        {pageDescription && (
          <meta property="og:description" content={pageDescription} />
        )}
        <meta property="og:site_name" content={portal.name} />
        <meta
          name="robots"
          content={
            noindex || portal.suspended ? 'noindex,nofollow' : 'index,follow'
          }
        />
        {canonicalPath && (
          <link rel="canonical" href={`${appUrl}${canonicalPath}`} />
        )}
        <link
          key="manifest"
          rel="manifest"
          href={`/api/public/portals/${portal.slug}/manifest`}
        />
        <meta key="theme-color" name="theme-color" content={primary} />
        {head}
      </Head>

      <header className="border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3">
          <Link
            href={base}
            className="text-lg font-bold"
            style={{ color: primary }}
          >
            {portal.name}
          </Link>
          {!portal.suspended && (
            <nav
              className="flex flex-wrap gap-4 text-sm"
              aria-label={t('portal-navigation', 'Portal navigation')}
            >
              <Link href={`${base}/jobs`}>{t('jobs', 'Jobs')}</Link>
              <Link href={`${base}/about`}>{t('about', 'About')}</Link>
              <Link href={`${base}/contact`}>{t('contact', 'Contact')}</Link>
            </nav>
          )}
          <div className="ml-auto flex items-center gap-3 text-sm">
            {session ? (
              <>
                <Link href="/me/applications">
                  {t('my-applications', 'My applications')}
                </Link>
                <button
                  type="button"
                  className="link"
                  onClick={() => signOut({ callbackUrl: base })}
                >
                  {t('sign-out', 'Sign out')}
                </button>
              </>
            ) : (
              <Link href={`/auth/login`}>{t('sign-in', 'Sign in')}</Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        {portal.suspended ? (
          <div role="alert" className="alert alert-warning">
            {t(
              'portal-suspended-notice',
              'This careers portal is temporarily unavailable.'
            )}
          </div>
        ) : (
          children
        )}
      </main>

      <footer className="border-t py-6 text-center text-xs opacity-70">
        <Link href={`${base}/privacy`}>
          {t('privacy-policy', 'Privacy policy')}
        </Link>
        {' · '}
        {portal.name}
      </footer>
    </div>
  );
};

export default PortalLayout;

/** Primary-colored button class helper (inline style carries the color). */
export const primaryButtonStyle = (color: string) => ({
  backgroundColor: color,
  borderColor: color,
  color: '#fff',
});
