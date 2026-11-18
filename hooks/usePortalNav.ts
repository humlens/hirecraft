import {
  AdjustmentsHorizontalIcon,
  BanknotesIcon,
  BuildingOffice2Icon,
  CalendarDaysIcon,
  ChartBarIcon,
  ClipboardDocumentCheckIcon,
  Cog6ToothIcon,
  CpuChipIcon,
  DocumentMagnifyingGlassIcon,
  EnvelopeIcon,
  GiftIcon,
  HomeIcon,
  KeyIcon,
  PaperAirplaneIcon,
  PuzzlePieceIcon,
  ShieldCheckIcon,
  ShieldExclamationIcon,
  SparklesIcon,
  BriefcaseIcon,
  UserPlusIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import useCanAccess from 'hooks/useCanAccess';
import usePortalAccess from 'hooks/usePortalAccess';
import { useRouter } from 'next/router';
import { createContext, useContext } from 'react';
import type { TeamFeature } from 'types';

export type PortalNavItem = {
  key: string;
  name: string;
  href: string;
  icon: typeof HomeIcon;
  /** shown in the main bar; the rest live under "More" */
  primary: boolean;
  /** extra path prefixes that keep this item highlighted */
  also?: string[];
  active?: boolean;
};

/** Page props (`teamFeatures`) made available to the shell, which sits outside the page. */
export const TeamFeaturesContext = createContext<TeamFeature | null>(null);
export const useTeamFeatures = () => useContext(TeamFeaturesContext);

const EMPTY: TeamFeature = {
  sso: false,
  dsync: false,
  auditLog: false,
  webhook: false,
  apiKey: false,
  payments: false,
  deleteTeam: false,
} as unknown as TeamFeature;

/** The portal's navigation: what this member may open, in one place for the header, "More" and the phone bar. */
const usePortalNav = (slug: string | undefined) => {
  const { asPath } = useRouter();
  const { canAccess } = useCanAccess();
  const { can, canAny } = usePortalAccess(slug);
  const features = useTeamFeatures() ?? EMPTY;

  if (!slug) {
    return { items: [] as PortalNavItem[], primary: [], more: [] };
  }

  const base = `/teams/${slug}`;
  const items: PortalNavItem[] = [
    {
      key: 'dashboard',
      name: 'Dashboard',
      href: `${base}/dashboard`,
      icon: HomeIcon,
      primary: true,
    },
  ];
  const add = (ok: boolean, item: PortalNavItem) => ok && items.push(item);

  add(can('jobs.read'), {
    key: 'jobs',
    name: 'Jobs',
    href: `${base}/jobs`,
    icon: BriefcaseIcon,
    primary: true,
  });
  add(canAny('candidates.read', 'candidates.search'), {
    key: 'talent',
    name: 'Candidates',
    href: `${base}/talent`,
    icon: UsersIcon,
    primary: true,
  });
  add(can('applications.read'), {
    key: 'review',
    name: 'Review',
    href: `${base}/review`,
    icon: ClipboardDocumentCheckIcon,
    primary: true,
  });
  add(canAny('interviews.manage', 'feedback.submit'), {
    key: 'interviews',
    name: 'Interviews',
    href: `${base}/interviews`,
    icon: CalendarDaysIcon,
    primary: true,
  });
  add(canAny('offers.manage', 'offers.approve'), {
    key: 'offers',
    name: 'Offers',
    href: `${base}/offers`,
    icon: GiftIcon,
    primary: true,
  });
  add(can('ai.use'), {
    key: 'copilot',
    name: 'Copilot',
    href: `${base}/copilot`,
    icon: SparklesIcon,
    primary: true,
  });
  add(canAny('members.invite', 'members.remove', 'roles.manage'), {
    key: 'team',
    name: 'Team',
    href: `${base}/members`,
    icon: UserPlusIcon,
    primary: true,
    also: [`${base}/roles`],
  });

  add(can('messages.send'), {
    key: 'messages',
    name: 'Messages',
    href: `${base}/messages`,
    icon: EnvelopeIcon,
    primary: false,
  });
  add(can('analytics.read'), {
    key: 'analytics',
    name: 'Analytics',
    href: `${base}/analytics`,
    icon: ChartBarIcon,
    primary: false,
  });
  add(can('automation.manage'), {
    key: 'pipeline',
    name: 'Pipeline & automation',
    href: `${base}/settings/pipeline`,
    icon: AdjustmentsHorizontalIcon,
    primary: false,
  });
  add(can('portal.update') || can('branding.update'), {
    key: 'portal',
    name: 'Portal & branding',
    href: `${base}/portal`,
    icon: BuildingOffice2Icon,
    primary: false,
  });
  add(can('ai.configure'), {
    key: 'ai',
    name: 'AI',
    href: `${base}/ai`,
    icon: CpuChipIcon,
    primary: false,
  });
  add(canAny('integrations.manage', 'domain.manage'), {
    key: 'integrations',
    name: 'Integrations & domain',
    href: `${base}/settings/integrations`,
    icon: PuzzlePieceIcon,
    primary: false,
  });
  add(
    !!features.sso &&
      canAccess('team_sso', ['create', 'update', 'read', 'delete']),
    {
      key: 'sso',
      name: 'Single Sign-On',
      href: `${base}/sso`,
      icon: ShieldExclamationIcon,
      primary: false,
    }
  );
  add(
    !!features.dsync &&
      canAccess('team_dsync', ['create', 'update', 'read', 'delete']),
    {
      key: 'dsync',
      name: 'Directory Sync',
      href: `${base}/directory-sync`,
      icon: UserPlusIcon,
      primary: false,
    }
  );
  add(
    !!features.auditLog &&
      canAccess('team_audit_log', ['create', 'update', 'read', 'delete']),
    {
      key: 'audit',
      name: 'Audit Logs',
      href: `${base}/audit-logs`,
      icon: DocumentMagnifyingGlassIcon,
      primary: false,
    }
  );
  add(
    !!features.payments &&
      canAccess('team_payments', ['create', 'update', 'read', 'delete']),
    {
      key: 'billing',
      name: 'Plans & billing',
      href: `${base}/billing`,
      icon: BanknotesIcon,
      primary: false,
    }
  );
  add(
    !!features.webhook &&
      canAccess('team_webhook', ['create', 'update', 'read', 'delete']),
    {
      key: 'webhooks',
      name: 'Webhooks',
      href: `${base}/webhooks`,
      icon: PaperAirplaneIcon,
      primary: false,
    }
  );
  add(
    !!features.apiKey &&
      canAccess('team_api_key', ['create', 'update', 'read', 'delete']),
    {
      key: 'apikeys',
      name: 'API Keys',
      href: `${base}/api-keys`,
      icon: KeyIcon,
      primary: false,
    }
  );
  add(true, {
    key: 'settings',
    name: 'Settings',
    href: `${base}/settings`,
    icon: Cog6ToothIcon,
    primary: false,
  });
  void ShieldCheckIcon;

  // the item whose path is the longest prefix of the current page is the active one
  const path = asPath.split('?')[0].split('#')[0];
  let best: PortalNavItem | undefined;
  let bestLen = -1;

  for (const it of items) {
    for (const p of [it.href, ...(it.also ?? [])]) {
      const hit = path === p || path.startsWith(`${p}/`);

      if (hit && p.length > bestLen) {
        best = it;
        bestLen = p.length;
      }
    }
  }

  const withActive = items.map((i) => ({ ...i, active: i === best }));

  return {
    items: withActive,
    primary: withActive.filter((i) => i.primary),
    more: withActive.filter((i) => !i.primary),
  };
};

export default usePortalNav;
