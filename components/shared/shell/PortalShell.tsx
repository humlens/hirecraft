import { Loading } from '@/components/shared';
import {
  ArrowRightOnRectangleIcon,
  BellIcon,
  EllipsisHorizontalIcon,
  RectangleStackIcon,
  SunIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline';
import { useCustomSignOut } from 'hooks/useCustomSignout';
import usePortalNav, { type PortalNavItem } from 'hooks/usePortalNav';
import useTeam from 'hooks/useTeam';
import useTheme from 'hooks/useTheme';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import classNames from 'classnames';
import fetcher from '@/lib/fetcher';
import env from '@/lib/env';

const initial = (name?: string) => (name?.trim()[0] ?? 'H').toUpperCase();

const closeMenu = () => (document.activeElement as HTMLElement | null)?.blur();

/**
 * The shell of every portal page: brand + the portal's own name on the left, the
 * pages this member may open as pills, a "More" menu for the rest, and the bell.
 */
const PortalShell = ({ children }: { children: React.ReactNode }) => {
  const router = useRouter();
  const { t } = useTranslation('common');
  const { status, data: session } = useSession();
  const slug = router.isReady ? (router.query.slug as string) : undefined;
  const { team } = useTeam(slug);
  const { primary, more } = usePortalNav(slug);
  const { toggleTheme } = useTheme();
  const signOut = useCustomSignOut();
  const { data: notif } = useSWR<{ data: { unread: number } }>(
    '/api/notifications?limit=1',
    fetcher,
    { refreshInterval: 60000 }
  );

  if (status === 'loading') return <Loading />;

  if (status === 'unauthenticated') {
    router.push('/auth/login');

    return null;
  }

  const label = (i: PortalNavItem) => t(`nav-${i.key}`, i.name);
  const moreActive = more.some((m) => m.active);

  return (
    <div className="min-h-screen bg-base-200">
      <header className="sticky top-0 z-40 border-b bg-base-100">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 sm:px-6 lg:px-8">
          <Link
            href={slug ? `/teams/${slug}/dashboard` : '/teams'}
            className="mr-3 flex items-center gap-2"
            aria-label={team?.name ?? t('portal', 'Portal')}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-content">
              {initial(team?.name)}
            </span>
            <strong className="font-display text-[15px]">
              {team?.name ?? ''}
            </strong>
          </Link>

          <nav
            aria-label={t('portal-navigation', 'Portal')}
            className="order-last -mx-1 flex w-full flex-nowrap items-center gap-1 overflow-x-auto px-1 md:order-none md:mx-0 md:w-auto md:flex-1 md:overflow-visible md:px-0"
          >
            {primary.map((i) => (
              <Link
                key={i.key}
                href={i.href}
                aria-current={i.active ? 'page' : undefined}
                className={classNames(
                  'whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  i.active
                    ? 'bg-primary/10 text-primary'
                    : 'text-base-content/80 hover:bg-base-200 hover:text-base-content'
                )}
              >
                {label(i)}
              </Link>
            ))}

            <div className="dropdown">
              <button
                type="button"
                tabIndex={0}
                aria-label={t('more', 'More')}
                className={classNames(
                  'flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium',
                  moreActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-base-content/80 hover:bg-base-200'
                )}
              >
                <EllipsisHorizontalIcon
                  className="h-5 w-5"
                  aria-hidden="true"
                />
                {t('more', 'More')}
              </button>
              <ul
                tabIndex={0}
                className="dropdown-content menu z-50 mt-1 w-64 rounded-box border bg-base-100 p-2 shadow-lg"
              >
                {more.map((i) => (
                  <li key={i.key} onClick={closeMenu}>
                    <Link
                      href={i.href}
                      className={classNames(i.active && 'menu-active')}
                    >
                      <i.icon className="h-4 w-4" aria-hidden="true" />
                      {label(i)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </nav>

          <div className="ml-auto flex items-center gap-1 md:ml-0">
            <Link
              href="/notifications"
              className="btn btn-ghost btn-circle btn-sm relative"
              aria-label={t('notifications', 'Notifications')}
            >
              <BellIcon className="h-5 w-5" aria-hidden="true" />
              {!!notif?.data?.unread && (
                <span className="badge badge-primary badge-xs absolute -right-0.5 -top-0.5">
                  {notif.data.unread > 99 ? '99+' : notif.data.unread}
                </span>
              )}
            </Link>
            <div className="dropdown dropdown-end">
              <button
                type="button"
                tabIndex={0}
                className="btn btn-ghost btn-sm font-semibold"
              >
                {session?.user?.name}
              </button>
              <ul
                tabIndex={0}
                className="dropdown-content menu z-50 mt-1 w-52 rounded-box border bg-base-100 p-2 shadow-lg"
              >
                <li onClick={closeMenu}>
                  <Link href="/teams">
                    <RectangleStackIcon
                      className="h-4 w-4"
                      aria-hidden="true"
                    />{' '}
                    {t('all-portals', 'All portals')}
                  </Link>
                </li>
                <li onClick={closeMenu}>
                  <Link href="/settings/account">
                    <UserCircleIcon className="h-4 w-4" aria-hidden="true" />{' '}
                    {t('account')}
                  </Link>
                </li>
                {env.darkModeEnabled && (
                  <li>
                    <button type="button" onClick={toggleTheme}>
                      <SunIcon className="h-4 w-4" aria-hidden="true" />{' '}
                      {t('switch-theme')}
                    </button>
                  </li>
                )}
                <li>
                  <button type="button" onClick={signOut}>
                    <ArrowRightOnRectangleIcon
                      className="h-4 w-4"
                      aria-hidden="true"
                    />{' '}
                    {t('logout')}
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </header>
      <main className="py-6">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
};

export default PortalShell;
