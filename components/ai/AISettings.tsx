import { Error, Loading } from '@/components/shared';
import useApi, { send } from 'hooks/useApi';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

type Settings = {
  configured: boolean;
  provider: string | null;
  baseUrl: string | null;
  hasOwnKey: boolean;
  keyHint: string | null;
  modelByTier: Record<string, string>;
  enabledFeatures: Record<string, boolean>;
  logRetentionDays: number;
  effective: { provider: string; ownKey: boolean } | null;
  providers: string[];
  defaultModels: Record<string, Record<string, string>>;
  features: { key: string; label: string; credits: number }[];
};

type Usage = {
  month: string;
  creditsUsed: number;
  creditsLimit: number | null;
  ownKey: boolean;
  byFeature: { feature: string; calls: number; credits: number }[];
  recentProblems: {
    feature: string;
    error: string | null;
    createdAt: string;
  }[];
};

const PROVIDERS: Record<string, [string, string]> = {
  OPENAI: ['OpenAI', 'GPT models'],
  ANTHROPIC: ['Anthropic Claude', 'Claude models'],
  GEMINI: ['Google Gemini', 'Gemini models'],
  OPENAI_COMPATIBLE: ['OpenAI-compatible', 'Self-hosted or other'],
};

const AISettings = ({ slug }: { slug: string }) => {
  const { t } = useTranslation('common');
  const settings = useApi<Settings>(`/api/teams/${slug}/ai/settings`);
  const usage = useApi<{ usage: Usage }>(`/api/teams/${slug}/ai/usage`);
  const [provider, setProvider] = useState('OPENAI');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [retention, setRetention] = useState(30);
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState(false);

  const s = settings.data;

  useEffect(() => {
    if (s) {
      setProvider(s.provider ?? 'OPENAI');
      setBaseUrl(s.baseUrl ?? '');
      setRetention(s.logRetentionDays);
      setFeatures(s.enabledFeatures);
    }
  }, [s]);

  if (settings.isLoading) return <Loading />;
  if (settings.isError) return <Error message={settings.isError.message} />;
  if (!s) return null;

  const save = async (extra: Record<string, unknown> = {}) => {
    const r = await send(`/api/teams/${slug}/ai/settings`, 'PUT', {
      provider,
      ...(provider === 'OPENAI_COMPATIBLE' ? { baseUrl } : {}),
      ...(apiKey ? { apiKey } : {}),
      logRetentionDays: retention,
      enabledFeatures: features,
      ...extra,
    });

    if (!r.ok) {
      toast.error(r.error as string);
      return;
    }

    setApiKey('');
    toast.success(t('saved', 'Saved.'));
    settings.refresh();
    usage.refresh();
  };

  const test = async () => {
    setTesting(true);
    const r = await send<{ ok: boolean; provider: string; error?: string }>(
      `/api/teams/${slug}/ai/test`,
      'POST'
    );

    setTesting(false);

    if (r.ok && r.data?.ok) {
      toast.success(t('ai-connection-ok', 'Connection works.'));
    } else {
      toast.error(r.data?.error ?? (r.error as string));
    }
  };

  const u = usage.data?.usage;
  const pct =
    u && u.creditsLimit
      ? Math.min(100, (u.creditsUsed / u.creditsLimit) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium">
          {t('ai-settings-title', 'AI providers, usage & governance')}
        </h2>
        <p className="text-sm opacity-70">
          {t(
            'ai-keys-note',
            'Keys are stored encrypted on the server and never sent to browsers.'
          )}
        </p>
      </div>

      <section className="space-y-3 rounded-lg border p-4">
        <h3 className="font-semibold">
          {t('ai-default-provider', 'Provider')}
        </h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {s.providers.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={provider === p}
              onClick={() => setProvider(p)}
              className={`rounded-lg border p-3 text-left ${provider === p ? 'border-primary bg-primary/10' : ''}`}
            >
              <strong className="block">{PROVIDERS[p]?.[0] ?? p}</strong>
              <span className="text-xs opacity-70">{PROVIDERS[p]?.[1]}</span>
            </button>
          ))}
        </div>
        {provider === 'OPENAI_COMPATIBLE' && (
          <label className="form-control">
            <span className="label-text pb-1">
              {t('ai-base-url', 'Base URL (https)')}
            </span>
            <input
              className="input input-bordered input-sm"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://llm.example.com/v1"
            />
          </label>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className="form-control min-w-64 flex-1">
            <span className="label-text pb-1">
              {t('ai-own-key', 'Your own API key (optional)')}
            </span>
            <input
              type="password"
              autoComplete="off"
              className="input input-bordered input-sm"
              placeholder={s.hasOwnKey ? `Saved (${s.keyHint})` : 'sk-…'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-sm"
            disabled={testing}
            onClick={test}
          >
            {t('ai-test-connection', 'Test connection')}
          </button>
          {s.hasOwnKey && (
            <button
              type="button"
              className="btn btn-sm btn-ghost text-error"
              onClick={() => save({ clearKey: true })}
            >
              {t('ai-remove-key', 'Remove key')}
            </button>
          )}
        </div>
        <p className="text-xs opacity-70">
          {s.effective?.ownKey
            ? t(
                'ai-using-own-key',
                'Using your own key: no platform credits are charged.'
              )
            : t(
                'ai-using-credits',
                'Without a key, platform credits are used.'
              )}
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="space-y-3 rounded-lg border p-4 lg:col-span-2">
          <h3 className="font-semibold">
            {t('ai-features', 'Features & routing')}
          </h3>
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>{t('ai-feature', 'Feature')}</th>
                  <th>{t('ai-credits', 'Credits')}</th>
                  <th>{t('ai-on', 'On')}</th>
                </tr>
              </thead>
              <tbody>
                {s.features.map((f) => (
                  <tr key={f.key}>
                    <td>
                      {f.label}
                      <span className="ml-2 font-mono text-xs opacity-60">
                        {f.key}
                      </span>
                    </td>
                    <td>{f.credits}</td>
                    <td>
                      <input
                        type="checkbox"
                        className="toggle toggle-primary toggle-sm"
                        aria-label={f.label}
                        checked={features[f.key] !== false}
                        onChange={(e) =>
                          setFeatures({
                            ...features,
                            [f.key]: e.target.checked,
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="space-y-4">
          <section className="space-y-2 rounded-lg border p-4">
            <h3 className="font-semibold">
              {t('ai-usage', 'Usage this month')}
            </h3>
            {u && (
              <>
                <div className="flex justify-between text-sm">
                  <span>{t('ai-credits', 'Credits')}</span>
                  <strong>
                    {u.creditsUsed.toLocaleString()}
                    {u.creditsLimit != null &&
                      ` / ${u.creditsLimit.toLocaleString()}`}
                  </strong>
                </div>
                {u.creditsLimit != null && (
                  <progress
                    className="progress progress-primary w-full"
                    value={pct}
                    max={100}
                    aria-label={t('ai-usage', 'Usage this month')}
                  />
                )}
                <ul className="space-y-1 text-sm">
                  {u.byFeature.map((f) => (
                    <li key={f.feature} className="flex justify-between">
                      <span>
                        {f.feature} · {f.calls}
                      </span>
                      <span>{f.credits}</span>
                    </li>
                  ))}
                </ul>
                {u.recentProblems.length > 0 && (
                  <p className="text-xs text-warning">
                    {t('ai-recent-problems', '{{n}} recent failed call(s)', {
                      n: u.recentProblems.length,
                    })}
                  </p>
                )}
              </>
            )}
          </section>

          <section className="space-y-2 rounded-lg border p-4">
            <h3 className="font-semibold">
              {t('ai-retention', 'Data & retention')}
            </h3>
            <label className="form-control">
              <span className="label-text pb-1">
                {t(
                  'ai-log-days',
                  'Delete AI prompt/response logs after (days)'
                )}
              </span>
              <input
                type="number"
                min={1}
                max={365}
                className="input input-bordered input-sm"
                value={retention}
                onChange={(e) => setRetention(Number(e.target.value))}
              />
            </label>
            <p className="text-xs opacity-70">
              {t(
                'ai-no-training',
                'Candidate data is never used to train models. Logs are redacted before they are stored.'
              )}
            </p>
          </section>
        </div>
      </div>

      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={() => save()}
      >
        {t('save-changes')}
      </button>
    </div>
  );
};

export default AISettings;
