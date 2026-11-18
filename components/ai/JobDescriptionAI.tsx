import { send } from 'hooks/useApi';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import toast from 'react-hot-toast';

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
  const [tone, setTone] = useState('professional');
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
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="select select-bordered select-xs"
        aria-label={t('ai-tone', 'Tone')}
        value={tone}
        onChange={(e) => setTone(e.target.value)}
      >
        {['professional', 'friendly', 'concise'].map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-xs"
        disabled={busy || title.trim().length < 3}
        onClick={generate}
      >
        {t('ai-write-jd', 'Write with AI')}
      </button>
    </div>
  );
};

export default JobDescriptionAI;
