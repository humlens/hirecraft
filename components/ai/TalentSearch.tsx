import { send } from 'hooks/useApi';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useState } from 'react';
import toast from 'react-hot-toast';

type Filters = {
  skills: string[];
  keywords: string[];
  location: string | null;
  minYears: number | null;
  maxYears: number | null;
  workMode: string | null;
};
type Result = {
  candidateId: string;
  name: string;
  headline: string | null;
  location: string | null;
  skills: string[];
  matchedSkills: number;
  years: number | null;
  score: number;
  why: { fullText: number | null; vector: number | null; filterBoost: number };
};

const chipsOf = (f: Filters) => [
  ...f.skills.map((v) => ({ k: 'skills', v, label: `Skill: ${v}` })),
  ...f.keywords.map((v) => ({ k: 'keywords', v, label: `Keyword: ${v}` })),
  ...(f.location
    ? [{ k: 'location', v: f.location, label: `Location: ${f.location}` }]
    : []),
  ...(f.minYears != null
    ? [{ k: 'minYears', v: '', label: `Experience ≥ ${f.minYears} yrs` }]
    : []),
  ...(f.maxYears != null
    ? [{ k: 'maxYears', v: '', label: `Experience ≤ ${f.maxYears} yrs` }]
    : []),
  ...(f.workMode
    ? [{ k: 'workMode', v: '', label: `Work mode: ${f.workMode}` }]
    : []),
];

/** Natural-language talent search: the model only produces filter chips the user can edit. */
const TalentSearch = ({ slug, canAI }: { slug: string; canAI: boolean }) => {
  const { t } = useTranslation('common');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Filters | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [info, setInfo] = useState<{ ai: boolean; vector: boolean }>({
    ai: false,
    vector: false,
  });
  const [busy, setBusy] = useState(false);

  const run = async (body: { query?: string; filters?: Filters }) => {
    setBusy(true);

    const r = await send<{
      filters: Filters;
      parsedByAI: boolean;
      vectorUsed: boolean;
      results: Result[];
    }>(`/api/teams/${slug}/talent/search`, 'POST', { ...body, limit: 25 });

    setBusy(false);

    if (!r.ok) {
      toast.error(r.error as string);
      return;
    }

    setFilters(r.data!.filters);
    setResults(r.data!.results);
    setInfo({ ai: r.data!.parsedByAI, vector: r.data!.vectorUsed });
  };

  const remove = (c: { k: string; v: string }) => {
    if (!filters) return;

    const next: Filters = { ...filters };

    if (c.k === 'skills' || c.k === 'keywords') {
      next[c.k] = next[c.k].filter((x) => x !== c.v);
    } else {
      (next as Record<string, unknown>)[c.k] = null;
    }

    run({ filters: next }); // no model call: the user's edited chips are the query
  };

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) run({ query: q });
        }}
      >
        <input
          type="search"
          className="input  input-sm flex-1"
          aria-label={t('talent-search-nl', 'Search in plain language')}
          placeholder={
            canAI
              ? t(
                  'talent-search-ph',
                  "React devs with 5+ years who've built design systems"
                )
              : t('talent-search-ph-plain', 'Skills, role or keywords')
          }
          value={q}
          maxLength={300}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={busy || !q.trim()}
        >
          {t('search', 'Search')}
        </button>
      </form>

      {filters && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs opacity-70">
            {info.ai
              ? t('talent-ai-read', 'AI read this as:')
              : t('talent-filters', 'Filters:')}
          </span>
          {chipsOf(filters).map((c) => (
            <button
              key={`${c.k}:${c.v}`}
              type="button"
              className="badge badge-outline gap-1"
              aria-label={t('remove-filter', 'Remove filter {{label}}', {
                label: c.label,
              })}
              onClick={() => remove(c)}
            >
              {c.label} ×
            </button>
          ))}
          <span className="ml-auto text-xs opacity-60">
            {t(
              'talent-fair',
              'Protected attributes are never filters or ranking signals'
            )}
          </span>
        </div>
      )}

      {results && (
        <ul className="space-y-2">
          {results.length === 0 && (
            <li className="text-sm opacity-70">
              {t('no-candidates', 'No candidates found.')}
            </li>
          )}
          {results.map((r) => (
            <li key={r.candidateId} className="space-y-1 rounded-lg border p-3">
              <div className="flex flex-wrap justify-between gap-2">
                <Link
                  className="font-semibold"
                  href={`/teams/${slug}/talent/${r.candidateId}`}
                >
                  {r.name}
                </Link>
                <span className="text-xs opacity-70">
                  {[r.location, r.years != null ? `${r.years} yrs` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <p className="text-sm">{r.headline}</p>
              <div className="flex flex-wrap gap-1 text-xs">
                <span className="badge badge-sm badge-success">
                  {t('relevance', 'Relevance')}{' '}
                  {Math.round(r.score * 1000) / 10}
                </span>
                {r.why.fullText && (
                  <span className="badge badge-sm">
                    {t('keyword', 'Keyword')} #{r.why.fullText}
                  </span>
                )}
                {r.why.vector && info.vector && (
                  <span className="badge badge-sm">
                    {t('semantic', 'Semantic')} #{r.why.vector}
                  </span>
                )}
                {r.matchedSkills > 0 && (
                  <span className="badge badge-sm">
                    {r.matchedSkills} {t('skills-matched', 'skills matched')}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default TalentSearch;
