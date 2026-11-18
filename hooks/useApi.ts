import fetcher from '@/lib/fetcher';
import useSWR from 'swr';
import type { ApiResponse } from 'types';

/** GET `url` (null = skip) with SWR; returns the unwrapped `data`. */
const useApi = <T>(url: string | null) => {
  const { data, error, isLoading, mutate } = useSWR<ApiResponse<T>>(
    url,
    fetcher
  );

  return {
    data: data?.data,
    isError: error,
    isLoading,
    refresh: () => mutate(),
  };
};

export default useApi;

/** Calls an API and toasts nothing: returns { ok, data, error }. */
export async function send<T = unknown>(
  url: string,
  method: string,
  body?: unknown
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));

  return r.ok
    ? { ok: true, data: json.data as T }
    : { ok: false, error: json.error?.message ?? 'Error' };
}
