import {
  Cog6ToothIcon,
  DocumentMagnifyingGlassIcon,
  KeyIcon,
  PaperAirplaneIcon,
  ShieldExclamationIcon,
  UserPlusIcon,
  BanknotesIcon,
  BuildingOffice2Icon,
  ShieldCheckIcon,
  BriefcaseIcon,
  UsersIcon,
  CalendarDaysIcon,
  GiftIcon,
  EnvelopeIcon,
  ChartBarIcon,
  AdjustmentsHorizontalIcon,
  SparklesIcon,
  CpuChipIcon,
} from '@heroicons/react/24/outline';
import type { Team } from '@prisma/client';
import classNames from 'classnames';
import useCanAccess from 'hooks/useCanAccess';
import usePortalAccess from 'hooks/usePortalAccess';
import Link from 'next/link';
import { TeamFeature } from 'types';

interface TeamTabProps {
  activeTab: string;
  team: Team;
  heading?: string;
  teamFeatures: TeamFeature;
}

const TeamTab = ({ activeTab, team, heading, teamFeatures }: TeamTabProps) => {
  const { canAccess } = useCanAccess();
  const { can, canAny } = usePortalAccess(team.slug);

  const navigations = [
    {
      name: 'Settings',
      href: `/teams/${team.slug}/settings`,
      active: activeTab === 'settings',
      icon: Cog6ToothIcon,
    },
  ];

  if (can('jobs.read')) {
    navigations.push({
      name: 'Jobs',
      href: `/teams/${team.slug}/jobs`,
      active: activeTab === 'jobs',
      icon: BriefcaseIcon,
    });
  }

  if (canAny('candidates.read', 'candidates.search')) {
    navigations.push({
      name: 'Talent',
      href: `/teams/${team.slug}/talent`,
      active: activeTab === 'talent',
      icon: UsersIcon,
    });
  }

  if (canAny('interviews.manage', 'feedback.submit')) {
    navigations.push({
      name: 'Interviews',
      href: `/teams/${team.slug}/interviews`,
      active: activeTab === 'interviews',
      icon: CalendarDaysIcon,
    });
  }

  if (canAny('offers.manage', 'offers.approve')) {
    navigations.push({
      name: 'Offers',
      href: `/teams/${team.slug}/offers`,
      active: activeTab === 'offers',
      icon: GiftIcon,
    });
  }

  if (can('messages.send')) {
    navigations.push({
      name: 'Messages',
      href: `/teams/${team.slug}/messages`,
      active: activeTab === 'messages',
      icon: EnvelopeIcon,
    });
  }

  if (can('analytics.read')) {
    navigations.push({
      name: 'Analytics',
      href: `/teams/${team.slug}/analytics`,
      active: activeTab === 'analytics',
      icon: ChartBarIcon,
    });
  }

  if (can('ai.use')) {
    navigations.push({
      name: 'Copilot',
      href: `/teams/${team.slug}/copilot`,
      active: activeTab === 'copilot',
      icon: SparklesIcon,
    });
  }

  if (can('ai.configure')) {
    navigations.push({
      name: 'AI',
      href: `/teams/${team.slug}/ai`,
      active: activeTab === 'ai',
      icon: CpuChipIcon,
    });
  }

  if (can('automation.manage')) {
    navigations.push({
      name: 'Pipeline',
      href: `/teams/${team.slug}/settings/pipeline`,
      active: activeTab === 'pipeline',
      icon: AdjustmentsHorizontalIcon,
    });
  }

  if (can('portal.update') || can('branding.update')) {
    navigations.push({
      name: 'Portal',
      href: `/teams/${team.slug}/portal`,
      active: activeTab === 'portal',
      icon: BuildingOffice2Icon,
    });
  }

  if (canAny('members.invite', 'members.remove')) {
    navigations.push({
      name: 'Members',
      href: `/teams/${team.slug}/members`,
      active: activeTab === 'members',
      icon: UserPlusIcon,
    });
  }

  if (canAny('roles.manage', 'members.invite')) {
    navigations.push({
      name: 'Roles',
      href: `/teams/${team.slug}/roles`,
      active: activeTab === 'roles',
      icon: ShieldCheckIcon,
    });
  }

  if (
    teamFeatures.sso &&
    canAccess('team_sso', ['create', 'update', 'read', 'delete'])
  ) {
    navigations.push({
      name: 'Single Sign-On',
      href: `/teams/${team.slug}/sso`,
      active: activeTab === 'sso',
      icon: ShieldExclamationIcon,
    });
  }

  if (
    teamFeatures.dsync &&
    canAccess('team_dsync', ['create', 'update', 'read', 'delete'])
  ) {
    navigations.push({
      name: 'Directory Sync',
      href: `/teams/${team.slug}/directory-sync`,
      active: activeTab === 'directory-sync',
      icon: UserPlusIcon,
    });
  }

  if (
    teamFeatures.auditLog &&
    canAccess('team_audit_log', ['create', 'update', 'read', 'delete'])
  ) {
    navigations.push({
      name: 'Audit Logs',
      href: `/teams/${team.slug}/audit-logs`,
      active: activeTab === 'audit-logs',
      icon: DocumentMagnifyingGlassIcon,
    });
  }

  if (
    teamFeatures.payments &&
    canAccess('team_payments', ['create', 'update', 'read', 'delete'])
  ) {
    navigations.push({
      name: 'Billing',
      href: `/teams/${team.slug}/billing`,
      active: activeTab === 'payments',
      icon: BanknotesIcon,
    });
  }

  if (
    teamFeatures.webhook &&
    canAccess('team_webhook', ['create', 'update', 'read', 'delete'])
  ) {
    navigations.push({
      name: 'Webhooks',
      href: `/teams/${team.slug}/webhooks`,
      active: activeTab === 'webhooks',
      icon: PaperAirplaneIcon,
    });
  }

  if (
    teamFeatures.apiKey &&
    canAccess('team_api_key', ['create', 'update', 'read', 'delete'])
  ) {
    navigations.push({
      name: 'API Keys',
      href: `/teams/${team.slug}/api-keys`,
      active: activeTab === 'api-keys',
      icon: KeyIcon,
    });
  }

  return (
    <div className="flex flex-col pb-6">
      <h2 className="text-xl font-semibold mb-2">
        {heading ? heading : team.name}
      </h2>
      <nav
        className=" flex flex-wrap border-b border-gray-300"
        aria-label="Tabs"
      >
        {navigations.map((menu) => {
          return (
            <Link
              href={menu.href}
              key={menu.href}
              className={classNames(
                'inline-flex items-center border-b-2 py-2 md-py-4 mr-5 text-sm font-medium',
                menu.active
                  ? 'border-gray-900 text-gray-700 dark:text-gray-100'
                  : 'border-transparent text-gray-500 hover:border-gray-300  hover:text-gray-700 hover:dark:text-gray-100'
              )}
            >
              {menu.name}
            </Link>
          );
        })}
      </nav>
    </div>
  );
};

export default TeamTab;
