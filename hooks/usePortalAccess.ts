import fetcher from '@/lib/fetcher';
import type { PermissionKey } from '@/lib/portal-roles';
import { useRouter } from 'next/router';
import useSWR from 'swr';

type PortalAccess = {
  keys: PermissionKey[];
  role: { id: string; name: string } | null;
  baseRole: 'OWNER' | 'ADMIN' | 'MEMBER';
  scope: 'all' | 'assigned';
};

/**
 * Portal permission keys of the signed-in member for the current team.
 * UI only: the server re-checks every permission.
 */
const usePortalAccess = (slug?: string) => {
  const { query, isReady } = useRouter();
  const teamSlug = slug || (isReady ? (query.slug as string) : undefined);

  const { data, error, isLoading } = useSWR<{ portal: PortalAccess }>(
    teamSlug ? `/api/teams/${teamSlug}/permissions` : null,
    fetcher
  );

  const keys = data?.portal?.keys ?? [];

  return {
    isLoading,
    isError: error,
    access: data?.portal,
    can: (key: PermissionKey) => keys.includes(key),
    canAny: (...list: PermissionKey[]) => list.some((k) => keys.includes(k)),
  };
};

export default usePortalAccess;
