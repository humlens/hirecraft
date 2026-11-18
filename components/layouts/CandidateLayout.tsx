import { signOut, useSession } from 'next-auth/react';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { SWRConfig } from 'swr';

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
    { href: '/me/profile', label: t('my-profile', 'My profile') },
    { href: '/me/privacy', label: t('my-privacy', 'Privacy') },
  ];

  return (
    <SWRConfig value={{ revalidateOnFocus: false }}>
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="font-bold">{t('candidate-area', 'Job seeker')}</span>
          <nav
            className="flex flex-wrap gap-4 text-sm"
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
              onClick={() => signOut({ callbackUrl: '/auth/login' })}
            >
              {t('sign-out', 'Sign out')}
            </button>
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </SWRConfig>
  );
};

export default CandidateLayout;
