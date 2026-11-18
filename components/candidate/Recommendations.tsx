import useApi from 'hooks/useApi';
import { useTranslation } from 'next-i18next';

type Rec = {
  id: string;
  title: string;
  slug: string;
  portal: { name: string; slug: string };
  why: { matchedSkills: string[]; missingSkills: string[] };
};

const Recommendations = () => {
  const { t } = useTranslation('common');
  const r = useApi<{ consented: boolean; jobs: Rec[] }>(
    '/api/candidate/recommendations'
  );

  if (!r.data?.consented || r.data.jobs.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">
        {t('ai-recommended', 'Recommended for you')}
      </h2>
      <ul className="space-y-2">
        {r.data.jobs.map((j) => (
          <li key={j.id} className="rounded-lg border p-3 text-sm">
            <a
              className="font-semibold"
              href={`/p/${j.portal.slug}/jobs/${j.slug}`}
            >
              {j.title}
            </a>
            <span className="ml-2 opacity-70">{j.portal.name}</span>
            <p className="text-xs opacity-70">
              {t('ai-reco-why', 'Why: matches {{skills}}', {
                skills: j.why.matchedSkills.join(', ') || '—',
              })}
              {j.why.missingSkills.length > 0 &&
                ` · ${t('ai-missing', 'Missing')}: ${j.why.missingSkills.join(', ')}`}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default Recommendations;
