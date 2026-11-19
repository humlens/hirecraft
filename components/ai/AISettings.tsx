import { Error, Loading } from '@/components/shared';
import SettingsNav from '@/components/shared/shell/SettingsNav';
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
  tierByFeature: Record<string, string>;
  features: {
    key: string;
    label: string;
    credits: number;
    defaultTier: string;
    tier: string;
    roles: string;
    prompt: string;
  }[];
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
  const [tiers, setTiers] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);

  const s = settings.data;

  useEffect(() => {
    if (s) {
      setProvider(s.provider ?? 'OPENAI');
      setBaseUrl(s.baseUrl ?? '');
      setRetention(s.logRetentionDays);
      setFeatures(s.enabledFeatures);
      setTiers(Object.fromEntries(s.features.map((f) => [f.key, f.tier])));
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
      tierByFeature: tiers,
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

  const label = (k: string) => s.features.find((f) => f.key === k)?.label ?? k;
  const TIER_LABELS: [string, string][] = [
    ['fast', t('tier-fast', 'Fast')],
    ['standard', t('tier-balanced', 'Balanced')],
    ['best', t('tier-best', 'Best quality')],
  ];
  const retentionOptions = Array.from(
    new Set([7, 30, 90, 180, 365, retention])
  ).sort((a, b) => a - b);

  return (
    <div className="space-y-4">
      <SettingsNav slug={slug} />
      <div>
        <h2 className="font-display text-3xl font-bold">
          {t('ai-settings-title', 'AI providers, usage & governance')}
        </h2>
        <p className="text-sm opacity-70">
          {t(
            'ai-keys-note',
            'Keys are stored encrypted on the server and never sent to browsers.'
          )}
        </p>
      </div>

      <section className="space-y-3 rounded-2xl border bg-base-100 p-6">
        <h3 className="font-display text-lg font-semibold">
          {t('ai-default-provider', 'Default provider')}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {s.providers.map((name) => {
            const p = name.toUpperCase();

            return (
              <button
                key={p}
                type="button"
                aria-pressed={provider === p}
                onClick={() => setProvider(p)}
                className={`rounded-xl border p-4 text-left ${provider === p ? 'border-2 border-primary bg-primary/10' : 'hover:bg-base-200'}`}
              >
                <strong className="block font-display">
                  {PROVIDERS[p]?.[0] ?? p}
                </strong>
                <span className="text-sm opacity-70">{PROVIDERS[p]?.[1]}</span>
              </button>
            );
          })}
        </div>
        {provider === 'OPENAI_COMPATIBLE' && (
          <label className="flex flex-col">
            <span className="pb-1 text-sm font-semibold">
              {t('ai-base-url', 'Base URL (https)')}
            </span>
            <input
              className="input w-full"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://llm.example.com/v1"
            />
          </label>
        )}
        <label className="block text-sm font-semibold">
          {t('ai-own-key', 'Your own API key (optional, Enterprise)')}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="password"
            autoComplete="off"
            aria-label={t('ai-own-key', 'Your own API key (optional)')}
            className="input min-w-64 flex-1"
            placeholder={s.hasOwnKey ? `Saved (${s.keyHint})` : 'sk-…'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-outline"
            disabled={testing}
            onClick={test}
          >
            {t('ai-test-connection', 'Test connection')}
          </button>
          {s.hasOwnKey && (
            <button
              type="button"
              className="btn btn-ghost text-error"
              onClick={() => save({ clearKey: true })}
            >
              {t('ai-remove-key', 'Remove key')}
            </button>
          )}
          <span className="text-sm opacity-70">
            {s.effective?.ownKey
              ? t(
                  'ai-using-own-key',
                  'Using your own key: no platform credits are charged.'
                )
              : t(
                  'ai-using-credits',
                  'Without a key, platform credits are used.'
                )}
          </span>
        </div>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="space-y-3 rounded-2xl border bg-base-100 p-6">
          <h3 className="font-display text-lg font-semibold">
            {t('ai-features', 'Features & routing')}
          </h3>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr className="text-xs uppercase">
                  <th>{t('ai-feature', 'Feature')}</th>
                  <th>{t('ai-model-tier', 'Model tier')}</th>
                  <th>{t('ai-prompt', 'Prompt')}</th>
                  <th>{t('ai-roles', 'Roles')}</th>
                  <th>{t('ai-on', 'On')}</th>
                </tr>
              </thead>
              <tbody>
                {s.features.map((f) => (
                  <tr key={f.key}>
                    <td>{f.label}</td>
                    <td>
                      <select
                        className="select select-sm"
                        aria-label={`${t('ai-model-tier', 'Model tier')}: ${f.key}`}
                        value={tiers[f.key] ?? f.tier}
                        onChange={(e) =>
                          setTiers({ ...tiers, [f.key]: e.target.value })
                        }
                      >
                        {TIER_LABELS.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="font-mono text-xs">{f.prompt}</td>
                    <td className="text-sm opacity-70">{f.roles}</td>
                    <td>
                      <input
                        type="checkbox"
                        role="switch"
                        className="toggle toggle-primary"
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
          <section className="space-y-3 rounded-2xl border bg-base-100 p-6">
            <h3 className="font-display text-lg font-semibold">
              {t('ai-usage', 'Usage this month')}
            </h3>
            {u && (
              <>
                <div className="flex justify-between">
                  <span>{t('ai-credits-label', 'AI credits')}</span>
                  <strong>
                    {u.creditsUsed.toLocaleString()}
                    {u.creditsLimit != null &&
                      ` / ${u.creditsLimit.toLocaleString()}`}
                  </strong>
                </div>
                {u.creditsLimit != null && (
                  <progress
                    className="progress progress-secondary w-full"
                    value={pct}
                    max={100}
                    aria-label={t('ai-usage', 'Usage this month')}
                  />
                )}
                <ul className="space-y-1 text-sm">
                  {u.byFeature.map((f) => (
                    <li key={f.feature} className="flex justify-between">
                      <span>{`${label(f.feature)} · ${f.calls}`}</span>
                      <span>{f.credits.toLocaleString()}</span>
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
                <p className="text-xs opacity-70">
                  {t(
                    'ai-limit-note',
                    'At 100% of your credits, AI pauses until the monthly reset or an upgrade.'
                  )}
                </p>
              </>
            )}
          </section>

          <section className="space-y-3 rounded-2xl border bg-base-100 p-6">
            <h3 className="font-display text-lg font-semibold">
              {t('ai-retention', 'Data & retention')}
            </h3>
            <label className="flex flex-col">
              <span className="pb-1 text-sm font-semibold">
                {t('ai-log-days', 'Delete AI prompt/response logs after')}
              </span>
              <select
                className="select w-full"
                aria-label={t(
                  'ai-log-days',
                  'Delete AI prompt/response logs after'
                )}
                value={retention}
                onChange={(e) => setRetention(Number(e.target.value))}
              >
                {retentionOptions.map((d) => (
                  <option
                    key={d}
                    value={d}
                  >{`${d} ${t('days', 'days')}`}</option>
                ))}
              </select>
            </label>
            <p className="rounded-xl bg-secondary/10 p-3 text-sm text-secondary">
              {'🔒 '}
              {t(
                'ai-no-training',
                'Candidate data is never used to train models. Logs are redacted before they are stored.'
              )}
            </p>
          </section>
        </div>
      </div>

      <button type="button" className="btn btn-primary" onClick={() => save()}>
        {t('save-changes')}
      </button>
    </div>
  );
};

export default AISettings;
