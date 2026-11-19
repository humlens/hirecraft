import TalentSearch, { type SearchResult } from '@/components/ai/TalentSearch';
import { Error, Loading } from '@/components/shared';
import useApi, { send } from 'hooks/useApi';
import usePortalAccess from 'hooks/usePortalAccess';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

type Candidate = {
  // list summary
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

  const list = useApi<{ candidates: Candidate[]; total: number }>(
    `/api/teams/${slug}/talent?${params}`
  );
  const pools = useApi<Pool[]>(`/api/teams/${slug}/talent/pools`);
  const tags = useApi<Tag[]>(`/api/teams/${slug}/talent/tags`);
  const [csv, setCsv] = useState('');
  const [dups, setDups] = useState<Dup[] | null>(null);
  const [dupCount, setDupCount] = useState(0);
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
    setDupCount((n) => Math.max(0, n - 1));
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

  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [now] = useState(() => Date.now());
  const [showImport, setShowImport] = useState(false);
  const [showPoolInput, setShowPoolInput] = useState(false);
  const canMerge = can('candidates.update');

  useEffect(() => {
    if (canMerge) {
      send<Dup[]>(`/api/teams/${slug}/talent/duplicates`, 'GET').then((r) => {
        if (r.ok) setDupCount(r.data!.length);
      });
    }
  }, [slug, canMerge]);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const ago = (d?: string | null) => {
    if (!d) return null;

    const days = Math.floor((now - new Date(d).getTime()) / 86400000);

    return days < 1
      ? t('today', 'Today')
      : days < 14
        ? `${days}d`
        : days < 60
          ? `${Math.floor(days / 7)}w`
          : `${Math.floor(days / 30)}mo`;
  };

  const check = (id: string, name: string) => (
    <input
      type="checkbox"
      className="checkbox mt-1"
      aria-label={`${t('select', 'Select')} ${name}`}
      checked={picked.includes(id)}
      onChange={() => toggle(id)}
    />
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h2 className="font-display text-3xl font-bold">
            {t('talent-search', 'Talent search')}
          </h2>
          <p className="text-sm opacity-70">
            {`${(list.data?.total ?? 0).toLocaleString()} ${t('talent-visible', "candidates you're allowed to see")} · ${t('talent-modes', 'keyword + semantic + filters')}`}
          </p>
        </div>
        {can('candidates.import') && (
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => setShowImport((v) => !v)}
          >
            {t('import-csv-short', 'Import CSV')}
          </button>
        )}
        {can('candidates.export') && (
          <a
            className={`btn btn-outline ${picked.length ? '' : 'btn-disabled'}`}
            aria-disabled={!picked.length}
            href={`/api/teams/${slug}/talent/export?ids=${picked.join(',')}`}
          >
            {t('export-selected', 'Export selected')}
          </a>
        )}
      </div>

      {can('candidates.search') && (
        <TalentSearch
          slug={slug}
          canAI={can('ai.use')}
          onResults={(r) => {
            setResults(r);
            setPicked([]);
          }}
        />
      )}

      {showImport && can('candidates.import') && (
        <section className="space-y-2 rounded-2xl border bg-base-100 p-5">
          <h3 className="font-display font-semibold">
            {t('import-csv', 'Import candidates (CSV)')}
          </h3>
          <p className="text-xs opacity-70">
            {t(
              'import-hint',
              'Header: name,email,phone,tags. Tags separated by ; (max 1000 rows). The selected pool receives the imported candidates.'
            )}
          </p>
          <textarea
            className="textarea w-full font-mono text-xs"
            rows={4}
            aria-label={t('csv-content', 'CSV content')}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label={t('csv-file', 'CSV file')}
            className="file-input file-input-sm"
            onChange={async (e) => {
              const f = e.target.files?.[0];

              if (f) setCsv(await f.text());
            }}
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
        <aside className="space-y-4">
          <section className="space-y-2 rounded-2xl border bg-base-100 p-5">
            <h3 className="font-display font-semibold">
              {t('talent-pools', 'Talent pools')}
            </h3>
            <ul className="space-y-1 text-sm">
              {(pools.data ?? []).map((x) => (
                <li key={x.id}>
                  <button
                    type="button"
                    aria-pressed={poolId === x.id}
                    className={`flex w-full justify-between rounded-lg px-2 py-1 text-left hover:bg-base-200 ${
                      poolId === x.id ? 'bg-primary/10 font-semibold' : ''
                    }`}
                    onClick={() => setPoolId(poolId === x.id ? '' : x.id)}
                  >
                    <span>{x.name}</span>
                    <span className="opacity-60">{x._count.members}</span>
                  </button>
                </li>
              ))}
              {pools.data?.length === 0 && (
                <li className="opacity-60">{t('no-pools', 'No pools yet.')}</li>
              )}
            </ul>
            {can('candidates.update') &&
              (showPoolInput ? (
                <div className="flex gap-2">
                  <input
                    className="input input-sm min-w-0 flex-1"
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
              ) : (
                <button
                  type="button"
                  className="btn btn-outline w-full"
                  onClick={() => setShowPoolInput(true)}
                >
                  {`+ ${t('new-pool-btn', 'New pool')}`}
                </button>
              ))}
          </section>

          {dupCount > 0 && (
            <section className="space-y-2 rounded-2xl border border-warning/50 bg-warning/10 p-5">
              <h3 className="font-display font-semibold">
                {`${dupCount} ${t('possible-duplicates-lower', 'possible duplicates')}`}
              </h3>
              <p className="text-sm opacity-80">
                {t(
                  'duplicates-note',
                  'Same email or phone across imports. Merging keeps all applications and notes.'
                )}
              </p>
              <button
                type="button"
                className="btn btn-outline"
                onClick={findDups}
              >
                {t('review-merge', 'Review & merge')}
              </button>
            </section>
          )}
        </aside>

        <div className="space-y-3">
          {!results && (
            <div className="flex flex-wrap gap-2">
              <input
                className="input input-sm"
                placeholder="Name or email"
                aria-label={t('filter-name', 'Filter by name or email')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <select
                className="select select-sm"
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
            </div>
          )}

          {results ? (
            <>
              {results.length === 0 && (
                <p className="text-sm opacity-70">
                  {t('no-candidates', 'No candidates found.')}
                </p>
              )}
              <ul className="space-y-3">
                {results.map((r) => (
                  <li
                    key={r.candidateId}
                    className="flex gap-3 rounded-2xl border bg-base-100 p-4"
                  >
                    {check(r.candidateId, r.name)}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap justify-between gap-2">
                        <Link
                          className="font-display font-semibold hover:underline"
                          href={`/teams/${slug}/talent/${r.candidateId}`}
                        >
                          {r.name}
                        </Link>
                        <span className="text-sm opacity-70">
                          {[
                            r.years != null ? `${r.years} yrs` : null,
                            r.location,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </div>
                      <p className="text-sm">{r.headline}</p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-success/15 px-2.5 py-1 font-semibold text-success">
                          {`${t('relevance', 'Relevance')} ${r.scores?.relevance ?? Math.round(r.score * 1000) / 10}`}
                        </span>
                        {r.scores?.keyword != null && (
                          <span className="rounded-full bg-base-200 px-2.5 py-1">
                            {`${t('keyword', 'Keyword')} ${r.scores.keyword}`}
                          </span>
                        )}
                        {r.scores?.semantic != null && (
                          <span className="rounded-full bg-base-200 px-2.5 py-1">
                            {`${t('semantic', 'Semantic')} ${r.scores.semantic}`}
                          </span>
                        )}
                        {ago(r.lastActiveAt) && (
                          <span className="rounded-full bg-base-200 px-2.5 py-1">
                            {`${t('last-active', 'Last active')} ${ago(r.lastActiveAt)}`}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              {list.isLoading && <Loading />}
              {list.isError && <Error message={list.isError.message} />}
              <ul className="space-y-3">
                {(list.data?.candidates ?? []).map((c) => (
                  <li
                    key={c.id}
                    className="flex gap-3 rounded-2xl border bg-base-100 p-4"
                  >
                    {check(c.id, c.name)}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap justify-between gap-2">
                        <Link
                          className="font-display font-semibold hover:underline"
                          href={`/teams/${slug}/talent/${c.id}`}
                        >
                          {c.name}
                        </Link>
                        <span className="text-sm opacity-70">
                          {`${c.applicationCount} ${t('applications', 'Applications').toLowerCase()}`}
                        </span>
                      </div>
                      <p className="text-sm opacity-70">
                        {`${c.email} · ${c.source}`}
                      </p>
                      {c.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                          {c.tags.map((x) => (
                            <span
                              key={x.id}
                              className="rounded-full bg-base-200 px-2.5 py-1"
                            >
                              {x.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {list.data?.candidates.length === 0 && (
                <p className="py-4 text-sm opacity-70">
                  {t('no-candidates', 'No candidates found.')}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {dups && (
        <section className="space-y-2 rounded-2xl border bg-base-100 p-5">
          <h3 className="font-display font-semibold">
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
    </div>
  );
};

export default TalentList;
