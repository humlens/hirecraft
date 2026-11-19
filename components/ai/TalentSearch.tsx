import { Panel, Chip } from '@/components/ui';
import { send } from 'hooks/useApi';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import toast from 'react-hot-toast';

export type SearchFilters = {
  skills: string[];
  keywords: string[];
  location: string | null;
  minYears: number | null;
  maxYears: number | null;
  workMode: string | null;
};
export type SearchResult = {
  candidateId: string;
  name: string;
  headline: string | null;
  location: string | null;
  skills: string[];
  matchedSkills: number;
  years: number | null;
  score: number;
  scores?: {
    relevance: number;
    keyword: number | null;
    semantic: number | null;
    fit: number | null;
  };
  lastActiveAt?: string | null;
  why: { fullText: number | null; vector: number | null; filterBoost: number };
};

const chipsOf = (f: SearchFilters) => [
  ...f.skills.map((v) => ({ k: 'skills', v, label: `Skill: ${v}` })),
  ...f.keywords.map((v) => ({ k: 'keywords', v, label: `Concept: ${v}` })),
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

/**
 * Natural-language talent search bar. The model only produces filter chips the
 * user can edit; results are handed to the parent through `onResults`.
 */
const TalentSearch = ({
  slug,
  canAI,
  onResults,
}: {
  slug: string;
  canAI: boolean;
  onResults: (results: SearchResult[] | null) => void;
}) => {
  const { t } = useTranslation('common');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<SearchFilters | null>(null);
  const [parsedByAI, setParsedByAI] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (body: { query?: string; filters?: SearchFilters }) => {
    setBusy(true);

    const r = await send<{
      filters: SearchFilters;
      parsedByAI: boolean;
      results: SearchResult[];
    }>(`/api/teams/${slug}/talent/search`, 'POST', { ...body, limit: 25 });

    setBusy(false);

    if (!r.ok) {
      toast.error(r.error as string);
      return;
    }

    setFilters(r.data!.filters);
    setParsedByAI(r.data!.parsedByAI);
    onResults(r.data!.results);
  };

  const remove = (c: { k: string; v: string }) => {
    if (!filters) return;

    const next: SearchFilters = { ...filters };

    if (c.k === 'skills' || c.k === 'keywords') {
      next[c.k] = next[c.k].filter((x) => x !== c.v);
    } else {
      (next as Record<string, unknown>)[c.k] = null;
    }

    run({ filters: next }); // no model call: the user's edited chips are the query
  };

  const clear = () => {
    setQ('');
    setFilters(null);
    onResults(null);
  };

  return (
    <Panel className="space-y-3">
      <form
        className="flex items-center gap-2 rounded-xl border px-3 py-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) run({ query: q });
        }}
      >
        <span aria-hidden className="text-secondary">
          {'✦'}
        </span>
        <input
          type="search"
          className="input flex-1 border-0 bg-transparent focus:outline-none"
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
          onChange={(e) => {
            setQ(e.target.value);

            if (!e.target.value) clear();
          }}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !q.trim()}
        >
          {t('search', 'Search')}
        </button>
      </form>

      {filters && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm opacity-70">
            {parsedByAI
              ? t('talent-ai-read', 'AI read this as:')
              : t('talent-filters', 'Filters:')}
          </span>
          {chipsOf(filters).map((c) => (
            <Chip
              key={`${c.k}:${c.v}`}
              removeLabel={t('remove-filter', 'Remove filter {{label}}', {
                label: c.label,
              })}
              onRemove={() => remove(c)}
            >
              {c.label}
            </Chip>
          ))}
          <span className="ml-auto text-xs opacity-60">
            {t(
              'talent-fair',
              'Protected attributes are never filters or ranking signals'
            )}
          </span>
        </div>
      )}
    </Panel>
  );
};

export default TalentSearch;
