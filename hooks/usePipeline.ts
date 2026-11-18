import fetcher from '@/lib/fetcher';
import type { getPipeline, getApplication } from 'models/application';
import useSWR from 'swr';
import type { ApiResponse } from 'types';

export type PipelineData = Awaited<ReturnType<typeof getPipeline>>;
export type ApplicationData = Awaited<ReturnType<typeof getApplication>>;

export const usePipeline = (slug: string, jobId?: string) => {
  const url = jobId ? `/api/teams/${slug}/jobs/${jobId}/pipeline` : null;
  const { data, error, isLoading, mutate } = useSWR<ApiResponse<PipelineData>>(
    url,
    fetcher
  );

  return {
    isLoading,
    isError: error,
    pipeline: data?.data,
    mutatePipeline: mutate,
  };
};

export const useApplication = (slug: string, applicationId?: string) => {
  const url = applicationId
    ? `/api/teams/${slug}/applications/${applicationId}`
    : null;
  const { data, error, isLoading, mutate } = useSWR<
    ApiResponse<ApplicationData>
  >(url, fetcher);

  return {
    isLoading,
    isError: error,
    application: data?.data,
    mutateApplication: mutate,
  };
};
