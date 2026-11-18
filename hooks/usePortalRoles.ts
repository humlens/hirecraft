import fetcher from '@/lib/fetcher';
import type { PortalRoleView } from 'models/portalRole';
import type { PERMISSIONS } from '@/lib/portal-roles';
import useSWR, { mutate } from 'swr';
import type { ApiResponse } from 'types';

export type PortalRolesPayload = {
  roles: PortalRoleView[];
  permissions: typeof PERMISSIONS;
  canManage: boolean;
};

const usePortalRoles = (slug: string) => {
  const url = `/api/teams/${slug}/roles`;

  const { data, error, isLoading } = useSWR<ApiResponse<PortalRolesPayload>>(
    url,
    fetcher
  );

  return {
    isLoading,
    isError: error,
    roles: data?.data?.roles,
    permissions: data?.data?.permissions,
    canManage: data?.data?.canManage ?? false,
    mutateRoles: () => mutate(url),
  };
};

export default usePortalRoles;
