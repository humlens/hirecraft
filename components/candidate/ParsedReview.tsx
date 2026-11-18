import useApi, { send } from 'hooks/useApi';
import { useTranslation } from 'next-i18next';
import toast from 'react-hot-toast';

type Field = {
  id: string;
  field: string;
  value: unknown;
  note: string | null;
  confidence: number;
  confirmedAt: string | null;
};
type Parsed = { status: string; fields: Field[] };

const show = (v: unknown) =>
  typeof v === 'string'
    ? v
    : v && typeof v === 'object'
      ? Object.values(v as Record<string, unknown>)
          .filter((x) => x != null && x !== '')
          .join(' · ')
      : String(v);

/** Shows what the AI extracted from a resume; uncertain items wait for the candidate. */
const ParsedReview = ({
  resumeId,
  onChanged,
}: {
  resumeId: string;
  onChanged: () => void;
}) => {
  const { t } = useTranslation('common');
  const parsed = useApi<Parsed>(`/api/candidate/resumes/${resumeId}/parsed`);
  const p = parsed.data;

  if (!p) return null;

  if (p.status === 'FAILED') {
    return (
      <p className="text-xs opacity-70">
        {t(
          'parse-failed',
          'We could not read this file automatically. Please fill in your profile by hand.'
        )}
      </p>
    );
  }

  const pending = p.fields.filter((f) => !f.confirmedAt);

  if (p.status === 'PENDING' || pending.length === 0) {
    return p.status === 'PENDING' ? (
      <p className="text-xs opacity-70" role="status">
        {t('parse-pending', 'AI is extracting your profile…')}
      </p>
    ) : null;
  }

  const act = async (confirm: { id: string }[], reject: string[]) => {
    const r = await send(`/api/candidate/resumes/${resumeId}/parsed`, 'PUT', {
      confirm,
      reject,
    });

    if (!r.ok) {
      toast.error(r.error as string);
      return;
    }

    parsed.refresh();
    onChanged();
  };

  return (
    <div className="space-y-2 rounded-lg border border-warning/50 p-3 text-sm">
      <strong>{t('parse-check', 'Check what we extracted')}</strong>
      <p className="text-xs opacity-70">
        {t(
          'parse-pending-n',
          '{{n}} item(s) need your confirmation · original file kept',
          { n: pending.length }
        )}
      </p>
      <ul className="space-y-2">
        {pending.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-2">
            <span className="w-28 opacity-70">{f.field}</span>
            <span className="min-w-0 flex-1">
              {show(f.value)}
              {f.note && <em className="block text-xs opacity-60">{f.note}</em>}
            </span>
            <button
              type="button"
              className="btn btn-xs btn-primary"
              onClick={() => act([{ id: f.id }], [])}
            >
              {t('confirm', 'Confirm')}
            </button>
            <button
              type="button"
              className="btn btn-xs"
              onClick={() => act([], [f.id])}
            >
              {t('dismiss', 'Dismiss')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ParsedReview;
