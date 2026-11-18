import TalentSearch from '@/components/ai/TalentSearch';
import { Error, Loading } from '@/components/shared';
import useApi, { send } from 'hooks/useApi';
import usePortalAccess from 'hooks/usePortalAccess';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useState } from 'react';
import toast from 'react-hot-toast';

type Candidate = {
  id: string;
  name: string;
  email: string;
  source: string;
  tags: { id: string; name: string }[];
  pools: { id: string; name: string }[];
  applicationCount: number;
};
type Pool = { id: string; name: string; _count: { members: number } };
type Tag = { id: string; name: string };
type Dup = {
  reason: string;
  candidates: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
  }[];
};

const TalentList = ({ slug }: { slug: string }) => {
  const { t } = useTranslation('common');
  const { can } = usePortalAccess(slug);
  const [q, setQ] = useState('');
  const [tagId, setTagId] = useState('');
  const [poolId, setPoolId] = useState('');
  const params = new URLSearchParams();

  if (q) params.set('q', q);
  if (tagId) params.set('tagId', tagId);
  if (poolId) params.set('poolId', poolId);

  const list = useApi<{ candidates: Candidate[] }>(
    `/api/teams/${slug}/talent?${params}`
  );
  const pools = useApi<Pool[]>(`/api/teams/${slug}/talent/pools`);
  const tags = useApi<Tag[]>(`/api/teams/${slug}/talent/tags`);
  const [csv, setCsv] = useState('');
  const [dups, setDups] = useState<Dup[] | null>(null);
  const [newPool, setNewPool] = useState('');

  const importCsv = async () => {
    const r = await send<{
      created: number;
      skipped: number;
      errors: { row: number }[];
    }>(`/api/teams/${slug}/talent/import`, 'POST', {
      csv,
      ...(poolId ? { poolId } : {}),
    });

    if (!r.ok) {
      toast.error(r.error as string);
      return;
    }

    toast.success(
      `${r.data!.created} ${t('imported', 'imported')}, ${r.data!.skipped} ${t('skipped', 'skipped')}, ${r.data!.errors.length} ${t('errors', 'errors')}`
    );
    setCsv('');
    list.refresh();
    tags.refresh();
  };

  const findDups = async () => {
    const r = await send<Dup[]>(`/api/teams/${slug}/talent/duplicates`, 'GET');

    if (r.ok) {
      setDups(r.data!);
    }
  };

  const merge = async (sourceId: string, targetId: string) => {
    const r = await send(`/api/teams/${slug}/talent/merge`, 'POST', {
      sourceId,
      targetId,
    });

    if (!r.ok) {
      toast.error(r.error as string);
      return;
    }

    toast.success(t('merged', 'Merged.'));
    setDups(null);
    list.refresh();
  };

  const createPool = async () => {
    const r = await send(`/api/teams/${slug}/talent/pools`, 'POST', {
      name: newPool,
    });

    if (!r.ok) {
      toast.error(r.error as string);
      return;
    }

    setNewPool('');
    pools.refresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-medium">{t('talent', 'Talent')}</h2>
        {can('candidates.export') && (
          <a className="btn btn-sm" href={`/api/teams/${slug}/talent/export`}>
            {t('export-csv', 'Export CSV')}
          </a>
        )}
        {can('candidates.update') && (
          <button type="button" className="btn btn-sm" onClick={findDups}>
            {t('find-duplicates', 'Find duplicates')}
          </button>
        )}
      </div>

      {can('candidates.search') && (
        <TalentSearch slug={slug} canAI={can('ai.use')} />
      )}

      <div className="flex flex-wrap gap-2">
        <input
          className="input  input-sm"
          placeholder="Name or email"
          aria-label={t('search', 'Search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="select  select-sm"
          aria-label={t('tag', 'Tag')}
          value={tagId}
          onChange={(e) => setTagId(e.target.value)}
        >
          <option value="">{t('all-tags', 'All tags')}</option>
          {(tags.data ?? []).map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <select
          className="select  select-sm"
          aria-label={t('pool', 'Pool')}
          value={poolId}
          onChange={(e) => setPoolId(e.target.value)}
        >
          <option value="">{t('all-pools', 'All pools')}</option>
          {(pools.data ?? []).map((x) => (
            <option
              key={x.id}
              value={x.id}
            >{`${x.name} (${x._count.members})`}</option>
          ))}
        </select>
      </div>

      {list.isLoading && <Loading />}
      {list.isError && <Error message={list.isError.message} />}
      {list.data && (
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>{t('name')}</th>
                <th>{t('email')}</th>
                <th>{t('source', 'Source')}</th>
                <th>{t('tags', 'Tags')}</th>
                <th>{t('applications', 'Applications')}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.candidates.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link
                      className="link"
                      href={`/teams/${slug}/talent/${c.id}`}
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td>{c.email}</td>
                  <td>{c.source}</td>
                  <td>{c.tags.map((x) => x.name).join(', ')}</td>
                  <td>{c.applicationCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data.candidates.length === 0 && (
            <p className="py-4 text-sm opacity-70">
              {t('no-candidates', 'No candidates found.')}
            </p>
          )}
        </div>
      )}

      {dups && (
        <section className="space-y-2 rounded border p-3">
          <h3 className="font-semibold">
            {t('possible-duplicates', 'Possible duplicates')}
          </h3>
          {dups.length === 0 && (
            <p className="text-sm opacity-70">
              {t('no-duplicates', 'No duplicates found.')}
            </p>
          )}
          {dups.map((g, i) => (
            <div key={i} className="text-sm">
              <span className="badge badge-sm mr-2">{g.reason}</span>
              {g.candidates.map((c) => (
                <span key={c.id} className="mr-3">
                  {c.name} ({c.email}){' '}
                  {g.candidates
                    .filter((o) => o.id !== c.id)
                    .map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        className="link text-xs"
                        onClick={() => merge(o.id, c.id)}
                      >
                        {t('merge-into-this', 'merge {{name}} into this', {
                          name: o.name,
                        })}
                      </button>
                    ))}
                </span>
              ))}
            </div>
          ))}
        </section>
      )}

      {can('candidates.import') && (
        <section className="space-y-2 rounded border p-3">
          <h3 className="font-semibold">
            {t('import-csv', 'Import candidates (CSV)')}
          </h3>
          <p className="text-xs opacity-70">
            {t(
              'import-hint',
              'Header: name,email,phone,tags. Tags separated by ; (max 1000 rows). The selected pool receives the imported candidates.'
            )}
          </p>
          <textarea
            className="textarea  w-full font-mono text-xs"
            rows={4}
            aria-label={t('csv-content', 'CSV content')}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label={t('csv-file', 'CSV file')}
            className="file-input  file-input-sm"
            onChange={async (e) =>
              e.target.files?.[0] && setCsv(await e.target.files[0].text())
            }
          />
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!csv.trim()}
            onClick={importCsv}
          >
            {t('import', 'Import')}
          </button>
        </section>
      )}

      {can('candidates.update') && (
        <section className="space-y-2 rounded border p-3">
          <h3 className="font-semibold">{t('talent-pools', 'Talent pools')}</h3>
          <div className="flex gap-2">
            <input
              className="input  input-sm"
              placeholder="New pool name"
              aria-label={t('new-pool', 'New pool name')}
              value={newPool}
              onChange={(e) => setNewPool(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-sm"
              disabled={newPool.trim().length < 2}
              onClick={createPool}
            >
              {t('create', 'Create')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
};

export default TalentList;
