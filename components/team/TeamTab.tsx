import PlanBanner from '@/components/billing/PlanBanner';
import type { Team } from '@prisma/client';
import classNames from 'classnames';
import usePortalAccess from 'hooks/usePortalAccess';
import usePortalNav from 'hooks/usePortalNav';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import type { TeamFeature } from 'types';

interface TeamTabProps {
  /** kept for the pages that pass it; the active page now comes from the URL */
  activeTab?: string;
  team: Team;
  heading?: string;
  teamFeatures?: TeamFeature;
}

/**
 * What every portal page shows above its content: the payment banner, an
 * optional heading, and the phone bottom bar. The main navigation is the
 * portal header (PortalShell).
 */
const TeamTab = ({ team, heading }: TeamTabProps) => {
  const { t } = useTranslation('common');
  const { can } = usePortalAccess(team.slug);
  const { items } = usePortalNav(team.slug);
  const quick = items.filter((i) =>
    ['review', 'jobs', 'interviews', 'talent'].includes(i.key)
  );

  return (
    <div className="flex flex-col">
      <PlanBanner slug={team.slug} canBilling={can('billing.manage')} />
      {heading && <h1 className="mb-2 text-2xl font-semibold">{heading}</h1>}
      {quick.length > 0 && (
        <nav
          className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-base-100 pb-[env(safe-area-inset-bottom)] md:hidden"
          aria-label="Quick navigation"
        >
          {[
            ...quick,
            {
              key: 'alerts',
              name: 'Alerts',
              href: '/notifications',
              active: false,
            },
          ].map((menu) => (
            <Link
              key={menu.key}
              href={menu.href}
              className={classNames(
                'flex min-h-14 flex-1 items-center justify-center px-1 text-xs font-semibold',
                menu.active ? 'bg-primary/10 text-primary' : 'opacity-70'
              )}
            >
              {t(`nav-${menu.key}`, menu.name)}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
};

export default TeamTab;
