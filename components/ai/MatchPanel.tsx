import { Panel, RadialScore, Notice } from '@/components/ui';
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
    components: {
      key: string;
      label?: string;
      score: number | null;
      applicable: boolean;
    }[];
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
    <Panel className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto font-display text-lg font-semibold">
          {t('ai-match-assessment', 'AI match assessment')}
        </h3>
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
          <div className="flex flex-wrap items-center gap-5">
            <RadialScore value={a.score} />
            <ul className="min-w-56 flex-1 space-y-2 text-sm">
              {a.breakdown.components
                .filter((c) => c.applicable && c.score != null)
                .map((c) => (
                  <li key={c.key}>
                    <div className="flex justify-between">
                      <span>{c.label ?? c.key}</span>
                      <span className="opacity-70">{`${Math.round(c.score as number)}%`}</span>
                    </div>
                    <progress
                      className="progress progress-primary h-1.5 w-full"
                      value={c.score as number}
                      max={100}
                    />
                  </li>
                ))}
            </ul>
          </div>
          <p className="text-sm">{a.explanation}</p>
          <div className="flex flex-wrap gap-1.5">
            {a.matchedSkills.map((s) => (
              <span key={s} className="badge badge-success badge-soft">
                {`✓ ${s}`}
              </span>
            ))}
            {a.missingSkills.map((s) => (
              <span key={s} className="badge badge-warning badge-soft">
                {`? ${t('ai-missing', 'Missing')}: ${s}`}
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
                {t(
                  'ai-suggested-questions-title',
                  'Suggested screening questions'
                )}
              </h4>
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {a.suggestedQuestions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ol>
            </div>
          )}
          <Notice tone="muted" className="text-xs opacity-80">
            {t(
              'ai-fairness-note',
              'Not used for scoring: age, gender, religion, ethnicity, disability, photo, marital status. Scores never trigger automatic rejection.'
            )}{' '}
            {a.note}
          </Notice>
        </>
      )}
    </Panel>
  );
};

export default MatchPanel;
