import { signOut, useSession } from 'next-auth/react';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { SWRConfig } from 'swr';
import { clearPwaState } from '@/lib/pwa';

const CandidateLayout = ({ children }: { children: React.ReactNode }) => {
  const { t } = useTranslation('common');
  const { data: session } = useSession();
  const { pathname } = useRouter();

  const links = [
    { href: '/me', label: t('my-dashboard', 'Dashboard') },
    {
      href: '/me/applications',
      label: t('my-applications', 'My applications'),
    },
    { href: '/me/offers', label: t('my-offers', 'Offers') },
    { href: '/me/notifications', label: t('notifications', 'Notifications') },
    { href: '/me/profile', label: t('my-profile', 'My profile') },
    { href: '/me/privacy', label: t('my-privacy', 'Privacy') },
  ];

  return (
    <SWRConfig value={{ revalidateOnFocus: false }}>
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="font-bold">{t('candidate-area', 'Job seeker')}</span>
          <nav
            className="hidden flex-wrap gap-4 text-sm md:flex"
            aria-label={t('candidate-navigation', 'Candidate navigation')}
          >
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={pathname === l.href ? 'font-semibold underline' : ''}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <span className="ml-auto flex items-center gap-3 text-sm">
            {session?.user?.email}
            <button
              type="button"
              className="link"
              onClick={async () => {
                await clearPwaState();
                signOut({ callbackUrl: '/auth/login' });
              }}
            >
              {t('sign-out', 'Sign out')}
            </button>
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 pb-24 md:pb-8">
        {children}
      </main>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t bg-base-100 pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label={t('candidate-mobile-navigation', 'Quick navigation')}
      >
        {[links[0], links[1], links[3], links[4]].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`flex min-h-14 items-center justify-center px-1 text-center text-xs font-semibold ${pathname === l.href ? 'bg-primary/10 text-primary' : 'opacity-70'}`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </SWRConfig>
  );
};

export default CandidateLayout;
