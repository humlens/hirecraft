import fetcher from '@/lib/fetcher';
import type { PortalBranding, PortalProfile } from '@prisma/client';
import useSWR, { mutate } from 'swr';
import type { ApiResponse } from 'types';

export type PortalPayload = {
  team: { name: string; slug: string };
  profile: PortalProfile | null;
  branding: PortalBranding | null;
  canUpdateProfile: boolean;
  canUpdateBranding: boolean;
};

const usePortal = (slug: string) => {
  const url = `/api/teams/${slug}/portal`;

  const { data, error, isLoading } = useSWR<ApiResponse<PortalPayload>>(
    url,
    fetcher
  );

  return {
    isLoading,
    isError: error,
    portal: data?.data,
    mutatePortal: () => mutate(url),
  };
};

export default usePortal;
