import useApi, { send } from 'hooks/useApi';
import { useTranslation } from 'next-i18next';
import toast from 'react-hot-toast';

type Assessment = {
  id: string;
  score: number;
  matchedSkills: string[];
  missingSkills: string[];
  explanation: string;
  evidence: { claim: string; quote: string }[];
  suggestedQuestions: string[];
  breakdown: {
    experienceYears?: number;
    components: { key: string; score: number | null; applicable: boolean }[];
  };
  createdAt: string;
  note: string;
};

/** AI match: a score computed in code plus an explanation. It never moves or rejects anyone. */
const MatchPanel = ({
  slug,
  applicationId,
}: {
  slug: string;
  applicationId: string;
}) => {
  const { t } = useTranslation('common');
  const list = useApi<Assessment[]>(
    `/api/teams/${slug}/applications/${applicationId}/match`
  );
  const a = list.data?.[0];

  const run = async () => {
    const r = await send(
      `/api/teams/${slug}/applications/${applicationId}/match`,
      'POST'
    );

    if (!r.ok) {
      toast.error(r.error as string);
      return;
    }

    list.refresh();
  };

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto font-semibold">{t('ai-match', 'AI match')}</h3>
        <button type="button" className="btn btn-sm" onClick={run}>
          {a ? t('ai-rerun', 'Run again') : t('ai-assess', 'Assess candidate')}
        </button>
      </div>
      {!a && (
        <p className="text-sm opacity-70">
          {t('ai-no-assessment', 'No assessment yet.')}
        </p>
      )}
      {a && (
        <>
          <div className="flex items-center gap-3">
            <div
              className="radial-progress text-primary"
              style={
                { '--value': a.score, '--size': '4rem' } as React.CSSProperties
              }
              role="img"
              aria-label={`${a.score}%`}
            >
              {a.score}%
            </div>
            <p className="text-sm">{a.explanation}</p>
          </div>
          <div className="flex flex-wrap gap-1">
            {a.matchedSkills.map((s) => (
              <span key={s} className="badge badge-success badge-sm">
                {s}
              </span>
            ))}
            {a.missingSkills.map((s) => (
              <span key={s} className="badge badge-warning badge-sm">
                {t('ai-missing', 'Missing')}: {s}
              </span>
            ))}
          </div>
          {a.breakdown.experienceYears != null && (
            <p className="text-xs opacity-70">
              {t(
                'ai-years-computed',
                'Experience computed from dates: {{y}} years',
                { y: a.breakdown.experienceYears }
              )}
            </p>
          )}
          {a.evidence.length > 0 && (
            <ul className="space-y-1 text-sm">
              {a.evidence.map((e, i) => (
                <li key={i}>
                  <strong>{e.claim}</strong>
                  <blockquote className="border-l-2 pl-2 opacity-80">
                    {e.quote}
                  </blockquote>
                </li>
              ))}
            </ul>
          )}
          {a.suggestedQuestions.length > 0 && (
            <div>
              <h4 className="text-sm font-medium">
                {t('ai-suggested-questions', 'Suggested questions')}
              </h4>
              <ul className="list-disc pl-5 text-sm">
                {a.suggestedQuestions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs opacity-60">{a.note}</p>
        </>
      )}
    </section>
  );
};

export default MatchPanel;
