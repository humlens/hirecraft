import { Switch } from '@/components/ui';
import useApi, { send } from 'hooks/useApi';
import { useTranslation } from 'next-i18next';
import toast from 'react-hot-toast';

type Row = { teamId: string; portal: string; slug: string; granted: boolean };

/** Per-portal opt-in for AI job recommendations. Off by default; the latest choice wins. */
const AiConsent = () => {
  const { t } = useTranslation('common');
  const list = useApi<Row[]>('/api/candidate/ai-consent');

  if (!list.data || list.data.length === 0) return null;

  const set = async (teamId: string, granted: boolean) => {
    const r = await send('/api/candidate/ai-consent', 'PUT', {
      teamId,
      granted,
    });

    if (r.ok) list.refresh();
    else toast.error(r.error as string);
  };

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">
        {t('ai-reco-consent', 'AI job recommendations')}
      </h2>
      <p className="text-sm opacity-70">
        {t(
          'ai-reco-consent-note',
          'Allow AI matching to recommend other jobs to you at companies you applied to. You can change this at any time.'
        )}
      </p>
      {list.data.map((r) => (
        <label key={r.teamId} className="flex items-center gap-3 text-sm">
          <Switch
            size="sm"
            label={r.portal}
            checked={r.granted}
            onChange={(e) => set(r.teamId, e.target.checked)}
          />
          {r.portal}
        </label>
      ))}
    </section>
  );
};

export default AiConsent;
