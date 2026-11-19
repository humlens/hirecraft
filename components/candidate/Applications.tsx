import { Panel } from '@/components/ui';
import { Error, Loading } from '@/components/shared';
import { defaultHeaders } from '@/lib/common';
import { useMyApplications, type MyApplication } from 'hooks/useCandidate';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import toast from 'react-hot-toast';
import type { ApiResponse } from 'types';

/** Horizontal tracker: the active path with the current stage highlighted. */
const Tracker = ({ app }: { app: MyApplication }) => {
  const path = app.stages.filter(
    (s) => s.kind === 'ACTIVE' || s.id === app.stage.id
  );
  const current = path.findIndex((s) => s.id === app.stage.id);

  return (
    <ol className="flex gap-1.5 text-xs" aria-label="progress">
      {path.map((s, i) => (
        <li
          key={s.id}
          aria-current={s.id === app.stage.id ? 'step' : undefined}
          className="min-w-0 flex-1"
        >
          <span
            className={`mb-1 block h-1.5 rounded-full ${
              i <= current ? 'bg-primary' : 'bg-base-300'
            }`}
          />
          <span
            className={`block truncate ${
              s.id === app.stage.id ? 'font-semibold' : 'opacity-60'
            }`}
          >
            {s.name}
          </span>
        </li>
      ))}
    </ol>
  );
};

const pill = (kind: string) =>
  kind === 'REJECTED'
    ? 'badge-error'
    : kind === 'HIRED'
      ? 'badge-success'
      : kind === 'WITHDRAWN'
        ? 'badge-ghost'
        : 'badge-primary badge-soft';

export const ApplicationList = ({ limit }: { limit?: number }) => {
  const { t } = useTranslation('common');
  const { data, isLoading, isError, refresh } = useMyApplications();

  if (isLoading) {
    return <Loading />;
  }

  if (isError) {
    return <Error message={isError.message} />;
  }

  const apps = (data ?? []).slice(0, limit);

  if (!apps.length) {
    return (
      <p className="text-sm opacity-70">
        {t('no-applications', 'You have not applied to any jobs yet.')}
      </p>
    );
  }

  const withdraw = async (id: string) => {
    if (!window.confirm(t('confirm-withdraw', 'Withdraw this application?'))) {
      return;
    }

    const r = await fetch(`/api/candidate/applications/${id}/withdraw`, {
      method: 'POST',
      headers: defaultHeaders,
    });

    if (!r.ok) {
      toast.error(((await r.json()) as ApiResponse).error.message);
      return;
    }

    toast.success(t('application-withdrawn', 'Application withdrawn.'));
    refresh();
  };

  return (
    <ul className="space-y-4">
      {apps.map((a) => (
        <Panel as="li" className="space-y-3" key={a.id}>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              className="font-display font-semibold hover:underline"
              href={`/p/${a.portal.slug}/jobs/${a.job.slug}`}
            >
              {a.job.title}
            </Link>
            <span className={`badge ml-auto ${pill(a.stage.kind)}`}>
              {a.stage.name}
            </span>
          </div>
          <p className="text-sm opacity-70">
            {`${a.portal.name} · ${t('applied-on', 'Applied on')} ${new Date(a.appliedAt).toLocaleDateString()}`}
          </p>
          <Tracker app={a} />
          {a.stage.kind !== 'WITHDRAWN' &&
            a.stage.kind !== 'HIRED' &&
            a.stage.kind !== 'REJECTED' && (
              <button
                type="button"
                className="btn btn-xs btn-outline"
                onClick={() => withdraw(a.id)}
              >
                {t('withdraw', 'Withdraw')}
              </button>
            )}
        </Panel>
      ))}
    </ul>
  );
};
