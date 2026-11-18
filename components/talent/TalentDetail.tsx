import { Error, Loading } from '@/components/shared';
import useApi, { send } from 'hooks/useApi';
import usePortalAccess from 'hooks/usePortalAccess';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

type Detail = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  source: string;
  tags: { id: string; name: string }[];
  pools: { id: string; name: string }[];
  profile: {
    headline: string | null;
    summary: string | null;
    location: string | null;
    skills: { skill: string }[];
  } | null;
  applications: {
    id: string;
    job: { id: string; title: string };
    stage: { name: string };
    appliedAt: string;
  }[];
  notes: {
    id: string;
    body: string;
    author: string | null;
    createdAt: string;
  }[];
};

const TalentDetail = ({
  slug,
  candidateId,
}: {
  slug: string;
  candidateId: string;
}) => {
  const { t } = useTranslation('common');
  const { can } = usePortalAccess(slug);
  const { data, isLoading, isError, refresh } = useApi<Detail>(
    `/api/teams/${slug}/talent/${candidateId}`
  );
  const pools = useApi<{ id: string; name: string }[]>(
    `/api/teams/${slug}/talent/pools`
  );
  const [tags, setTags] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (data) {
      setTags(data.tags.map((x) => x.name).join(', '));
    }
  }, [data]);

  if (isLoading) return <Loading />;
  if (isError) return <Error message={isError.message} />;
  if (!data) return null;

  const run = async (p: Promise<{ ok: boolean; error?: string }>) => {
    const r = await p;

    if (!r.ok) {
      toast.error(r.error as string);
      return;
    }

    refresh();
  };

  const inPool = (id: string) => data.pools.some((p) => p.id === id);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium">{data.name}</h2>
        <p className="text-sm opacity-70">
          {data.email} {data.phone && `| ${data.phone}`} | {data.source}
        </p>
      </div>

      {data.profile && (
        <section className="space-y-1 rounded border p-3 text-sm">
          <p className="font-medium">{data.profile.headline}</p>
          <p>{data.profile.location}</p>
          <p className="whitespace-pre-line">{data.profile.summary}</p>
          <p>{data.profile.skills.map((s) => s.skill).join(', ')}</p>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="font-semibold">{t('applications', 'Applications')}</h3>
        <ul className="space-y-1 text-sm">
          {data.applications.map((a) => (
            <li key={a.id}>
              <Link
                className="link"
                href={`/teams/${slug}/applications/${a.id}`}
              >
                {a.job.title}
              </Link>{' '}
              - {a.stage.name}
            </li>
          ))}
          {data.applications.length === 0 && (
            <li className="opacity-70">
              {t('no-applications-here', 'No applications.')}
            </li>
          )}
        </ul>
      </section>

      {can('candidates.update') && (
        <section className="space-y-2">
          <h3 className="font-semibold">{t('tags', 'Tags')}</h3>
          <div className="flex gap-2">
            <input
              className="input input-bordered input-sm flex-1"
              aria-label={t('tags-comma', 'Tags (comma separated)')}
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                run(
                  send(`/api/teams/${slug}/talent/${candidateId}/tags`, 'PUT', {
                    tags: tags
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                )
              }
            >
              {t('save-tags', 'Save tags')}
            </button>
          </div>
          <h3 className="pt-2 font-semibold">{t('pools', 'Pools')}</h3>
          <div className="flex flex-wrap gap-3 text-sm">
            {(pools.data ?? []).map((p) => (
              <label key={p.id} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={inPool(p.id)}
                  onChange={(e) =>
                    run(
                      send(
                        `/api/teams/${slug}/talent/pools/${p.id}/members`,
                        'PUT',
                        { candidateId, member: e.target.checked }
                      )
                    )
                  }
                />
                {p.name}
              </label>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="font-semibold">{t('notes', 'Notes')}</h3>
        {can('candidates.update') && (
          <div className="flex gap-2">
            <textarea
              className="textarea textarea-bordered flex-1"
              rows={2}
              aria-label={t('new-note', 'New note')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-sm"
              disabled={!note.trim()}
              onClick={async () => {
                await run(
                  send(
                    `/api/teams/${slug}/talent/${candidateId}/notes`,
                    'POST',
                    { body: note }
                  )
                );
                setNote('');
              }}
            >
              {t('add-note', 'Add note')}
            </button>
          </div>
        )}
        <ul className="space-y-2 text-sm">
          {data.notes.map((n) => (
            <li key={n.id} className="rounded border p-2">
              <p className="whitespace-pre-line">{n.body}</p>
              <p className="text-xs opacity-60">
                {n.author} - {new Date(n.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default TalentDetail;
