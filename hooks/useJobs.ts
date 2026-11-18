import fetcher from '@/lib/fetcher';
import type { JobView } from 'models/job';
import useSWR, { mutate } from 'swr';
import type { ApiResponse } from 'types';

export const useJobs = (slug: string, status?: string, q?: string) => {
  const params = new URLSearchParams();

  if (status) {
    params.set('status', status);
  }

  if (q) {
    params.set('q', q);
  }

  const url = `/api/teams/${slug}/jobs?${params.toString()}`;
  const { data, error, isLoading } = useSWR<
    ApiResponse<{ jobs: JobView[]; nextCursor: string | null }>
  >(url, fetcher);

  return {
    isLoading,
    isError: error,
    jobs: data?.data?.jobs,
    mutateJobs: () => mutate(url),
  };
};

export const useJob = (slug: string, jobId?: string) => {
  const url = jobId ? `/api/teams/${slug}/jobs/${jobId}` : null;
  const { data, error, isLoading } = useSWR<ApiResponse<JobView>>(url, fetcher);

  return {
    isLoading,
    isError: error,
    job: data?.data,
    mutateJob: () => (url ? mutate(url) : undefined),
  };
};
