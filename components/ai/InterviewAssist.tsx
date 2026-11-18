import { send } from 'hooks/useApi';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import toast from 'react-hot-toast';

type Questions = {
  competencies: {
    name: string;
    questions: { question: string; whatToLookFor: string }[];
  }[];
};
type Summary = {
  summary: string;
  strengths: { point: string; quote: string | null }[];
  concerns: { point: string; quote: string | null }[];
  consensus: string;
};

/** AI interview questions and an anonymised feedback summary. Suggestions only. */
const InterviewAssist = ({
  slug,
  interviewId,
  applicationId,
  canQuestions,
  canSummary,
}: {
  slug: string;
  interviewId: string;
  applicationId: string;
  canQuestions: boolean;
  canSummary: boolean;
}) => {
  const { t } = useTranslation('common');
  const [q, setQ] = useState<Questions | null>(null);
  const [s, setS] = useState<Summary | null>(null);
  const [busy, setBusy] = useState('');

  const questions = async () => {
    setBusy('q');

    const r = await send<Questions>(
      `/api/teams/${slug}/interviews/ai-questions`,
      'POST',
      {
        applicationId,
        competencies: [],
      }
    );

    setBusy('');
    if (r.ok) setQ(r.data!);
    else toast.error(r.error as string);
  };

  const summary = async () => {
    setBusy('s');

    const r = await send<Summary>(
      `/api/teams/${slug}/interviews/${interviewId}/ai-summary`,
      'POST'
    );

    setBusy('');
    if (r.ok) setS(r.data!);
    else toast.error(r.error as string);
  };

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h3 className="font-semibold">
        {t('ai-interview-assistant', 'AI interview assistant')}
      </h3>
      <div className="flex flex-wrap gap-2">
        {canQuestions && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={!!busy}
            onClick={questions}
          >
            {t('ai-gen-questions', 'Suggest questions')}
          </button>
        )}
        {canSummary && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={!!busy}
            onClick={summary}
          >
            {t('ai-summarize-feedback', 'Summarize feedback')}
          </button>
        )}
      </div>
      {busy && <span className="loading loading-dots" role="status" />}
      {q &&
        q.competencies.map((c) => (
          <div key={c.name}>
            <h4 className="text-sm font-medium">{c.name}</h4>
            <ol className="list-decimal pl-5 text-sm">
              {c.questions.map((x) => (
                <li key={x.question}>
                  {x.question}
                  <span className="block text-xs opacity-60">
                    {x.whatToLookFor}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      {s && (
        <div className="space-y-2 text-sm">
          <p>{s.summary}</p>
          {[
            [t('ai-strengths', 'Strengths'), s.strengths],
            [t('ai-concerns', 'Concerns'), s.concerns],
          ].map(([title, items]) => (
            <div key={title as string}>
              <h4 className="font-medium">{title as string}</h4>
              <ul className="list-disc pl-5">
                {(items as Summary['strengths']).map((i) => (
                  <li key={i.point}>
                    {i.point}
                    {i.quote && (
                      <blockquote className="border-l-2 pl-2 opacity-80">
                        “{i.quote}”
                      </blockquote>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="font-medium">{s.consensus}</p>
          <p className="text-xs opacity-60">
            {t(
              'ai-summary-note',
              'Interviewers are anonymised and quotes are verified against the notes. A human decides.'
            )}
          </p>
        </div>
      )}
    </section>
  );
};

export default InterviewAssist;
