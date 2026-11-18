import fetcher from '@/lib/fetcher';
import type { getProfile, listResumes } from 'models/candidate';
import type { listMyApplications, listSavedJobs } from 'models/apply';
import useSWR, { mutate } from 'swr';
import type { ApiResponse } from 'types';

export type MyApplication = Awaited<
  ReturnType<typeof listMyApplications>
>[number];
export type MyProfile = Awaited<ReturnType<typeof getProfile>>;
export type MyResume = Awaited<ReturnType<typeof listResumes>>[number];
export type MySavedJob = Awaited<ReturnType<typeof listSavedJobs>>[number];

const use = <T>(url: string) => {
  const { data, error, isLoading } = useSWR<ApiResponse<T>>(url, fetcher);

  return {
    data: data?.data,
    isError: error,
    isLoading,
    refresh: () => mutate(url),
  };
};

export const useMyApplications = () =>
  use<MyApplication[]>('/api/candidate/applications');
export const useMyProfile = () =>
  use<MyProfile | null>('/api/candidate/profile');
export const useMyResumes = () => use<MyResume[]>('/api/candidate/resumes');
export const useMySavedJobs = () =>
  use<MySavedJob[]>('/api/candidate/saved-jobs');
