import { send } from 'hooks/useApi';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import toast from 'react-hot-toast';

const TONES = ['professional', 'friendly', 'concise'] as const;

/** Generates a draft job description from the title; the author reviews and edits it. */
const JobDescriptionAI = ({
  slug,
  title,
  skills,
  workMode,
  onApply,
}: {
  slug: string;
  title: string;
  skills: string[];
  workMode?: string;
  onApply: (html: string) => void;
}) => {
  const { t } = useTranslation('common');
  const [tone, setTone] = useState<(typeof TONES)[number]>('professional');
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);

    const r = await send<{ descriptionHtml: string }>(
      `/api/teams/${slug}/jobs/ai-description`,
      'POST',
      {
        title,
        tone,
        skills,
        ...(workMode ? { workMode } : {}),
      }
    );

    setBusy(false);

    if (!r.ok) {
      toast.error(r.error as string);
      return;
    }

    onApply(r.data!.descriptionHtml);
    toast.success(
      t('ai-jd-ready', 'Draft written. Please review it before publishing.')
    );
  };

  return (
    <section className="space-y-4 rounded-2xl border bg-base-100 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <span className="text-secondary" aria-hidden="true">
            {'✦'}
          </span>
          {t('ai-job-description', 'AI job description')}
        </h3>
        <div
          className="flex gap-1"
          role="group"
          aria-label={t('ai-tone', 'Tone')}
        >
          {TONES.map((x) => (
            <button
              key={x}
              type="button"
              aria-pressed={tone === x}
              onClick={() => setTone(x)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold capitalize ${
                tone === x
                  ? 'border-secondary/40 bg-secondary/10 text-secondary'
                  : 'bg-base-100'
              }`}
            >
              {x}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-3 rounded-xl border border-dashed border-secondary/40 bg-secondary/5 p-4">
        <p className="text-sm leading-relaxed">
          {t(
            'ai-jd-explain',
            'Generate a structured, SEO-friendly description from the title, skills and your company profile. You can edit every line before publishing.'
          )}
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || title.trim().length < 3}
          onClick={generate}
        >
          {busy && (
            <span
              className="loading loading-spinner loading-sm"
              aria-hidden="true"
            />
          )}
          {t('ai-write-jd', 'Write with AI')}
        </button>
      </div>
    </section>
  );
};

export default JobDescriptionAI;
