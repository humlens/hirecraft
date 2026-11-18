import { Error, Loading } from '@/components/shared';
import { defaultHeaders } from '@/lib/common';
import { useJobs } from 'hooks/useJobs';
import usePortalAccess from 'hooks/usePortalAccess';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/daisy';
import toast from 'react-hot-toast';
import type { ApiResponse } from 'types';

const STATUSES = ['DRAFT', 'SCHEDULED', 'PUBLISHED', 'CLOSED', 'ARCHIVED'];

const JobsList = ({ slug }: { slug: string }) => {
  const { t } = useTranslation('common');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const { isLoading, isError, jobs, mutateJobs } = useJobs(slug, status, q);
  const { can } = usePortalAccess(slug);

  const duplicate = async (id: string) => {
    const r = await fetch(`/api/teams/${slug}/jobs/${id}/actions`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'duplicate' }),
    });

    if (!r.ok) {
      toast.error(((await r.json()) as ApiResponse).error.message);
      return;
    }

    toast.success(t('job-duplicated', 'Job duplicated as a draft.'));
    mutateJobs();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-medium">{t('jobs', 'Jobs')}</h2>
        {can('jobs.create') && (
          <Link href={`/teams/${slug}/jobs/new`}>
            <Button color="primary" size="md">
              {t('new-job', 'New job')}
            </Button>
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          className="input  input-sm"
          placeholder="Search by title"
          aria-label={t('search-jobs', 'Search jobs')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="select  select-sm"
          aria-label={t('job-status', 'Status')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">{t('all-statuses', 'All statuses')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <Loading />}
      {isError && <Error message={isError.message} />}

      {jobs && jobs.length === 0 && (
        <p className="text-sm opacity-70">{t('no-jobs', 'No jobs yet.')}</p>
      )}

      {jobs && jobs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{t('title', 'Title')}</th>
                <th>{t('job-status', 'Status')}</th>
                <th>{t('applicants', 'Applicants')}</th>
                <th>{t('actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <Link
                      className="link font-medium"
                      href={`/teams/${slug}/jobs/${job.id}`}
                    >
                      {job.title}
                    </Link>
                    <div className="text-xs opacity-60">
                      {job.department} {job.workMode}
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-outline">
                      {job.effectiveStatus}
                    </span>
                  </td>
                  <td>{job.applicationCount}</td>
                  <td className="space-x-2">
                    <Link
                      className="btn btn-xs"
                      href={`/teams/${slug}/jobs/${job.id}/pipeline`}
                    >
                      {t('pipeline', 'Pipeline')}
                    </Link>
                    {can('jobs.create') && (
                      <button
                        type="button"
                        className="btn btn-xs btn-ghost"
                        onClick={() => duplicate(job.id)}
                      >
                        {t('duplicate', 'Duplicate')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default JobsList;
